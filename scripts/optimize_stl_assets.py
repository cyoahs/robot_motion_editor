#!/usr/bin/env python3
"""Reproducibly simplify URDF visual STL assets with Blender.

Run this script through Blender, not the system Python. Example:

  backup_dir="$(mktemp -d /tmp/robot-mesh-backup.XXXXXX)"
  cp -a assets/g1 assets/h2 "$backup_dir/"
  /snap/blender/current/blender --background --factory-startup \
    --python scripts/optimize_stl_assets.py -- \
    --robot-dir assets/g1 --robot-dir assets/h2 \
    --in-place --backup-dir "$backup_dir" \
    --report /tmp/robot-mesh-optimization.json

Only STL files referenced by URDF <visual> elements are candidates. Each output
is written to a temporary file, validated, and atomically moved into place. An
in-place run requires --backup-dir; an existing backup file is never overwritten.

The default ``visualization`` profile was calibrated against fixed-camera renders
of the bundled G1 and H2 robots. It uses a 6k general cap while preserving more
geometry for silhouettes and visually dominant parts such as the H2 torso/head.
Pass ``--max-faces`` to deliberately replace the profile with one uniform cap.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

import bmesh
import bpy


PROFILE_PATH = Path(__file__).with_name("mesh_optimization_profile.json")
PROFILE_DATA = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
DEFAULT_PROFILE = PROFILE_DATA["name"]
GENERIC_FACE_CAP = PROFILE_DATA["genericFaceCap"]
VISUALIZATION_DEFAULT_FACE_CAP = PROFILE_DATA["defaultFaceCap"]

# Exact per-asset budgets are intentional. A semantic rule such as "all torso
# meshes get 50k" over-preserves the already-light G1 torso, while mirroring the
# asymmetric H2 shoulders loses a visibly different outer shell. Names in the
# shared profile are case-folded because the H2 source uses mixed-case paths.
VISUALIZATION_FACE_CAPS = PROFILE_DATA["robots"]


def parse_args() -> argparse.Namespace:
    blender_separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    script_args = sys.argv[blender_separator + 1 :]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--robot-dir",
        action="append",
        required=True,
        type=Path,
        help="Robot directory containing exactly one URDF (repeatable)",
    )
    parser.add_argument(
        "--profile",
        choices=(DEFAULT_PROFILE,),
        default=DEFAULT_PROFILE,
        help="Named adaptive face-budget profile used when --max-faces is omitted",
    )
    parser.add_argument(
        "--max-faces",
        type=int,
        help="Replace the adaptive profile with one uniform face cap",
    )
    parser.add_argument(
        "--bbox-relative-tolerance",
        type=float,
        default=0.01,
        help="Maximum changed STL bound coordinate divided by original bbox diagonal",
    )
    parser.add_argument("--degenerate-area-epsilon", type=float, default=1e-14)
    parser.add_argument("--weld-tolerance", type=float, default=1e-9)
    destination = parser.add_mutually_exclusive_group()
    destination.add_argument("--in-place", action="store_true")
    destination.add_argument("--output-root", type=Path)
    parser.add_argument(
        "--backup-dir",
        type=Path,
        help="Required for --in-place. Original files are copied here once.",
    )
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(script_args)

    if args.max_faces is not None and args.max_faces < 4:
        parser.error("--max-faces must be at least 4")
    if not math.isfinite(args.bbox_relative_tolerance) or args.bbox_relative_tolerance < 0:
        parser.error("--bbox-relative-tolerance must be finite and non-negative")
    if not math.isfinite(args.degenerate_area_epsilon) or args.degenerate_area_epsilon < 0:
        parser.error("--degenerate-area-epsilon must be finite and non-negative")
    if not math.isfinite(args.weld_tolerance) or args.weld_tolerance < 0:
        parser.error("--weld-tolerance must be finite and non-negative")
    if args.in_place and not args.backup_dir:
        parser.error("--in-place requires --backup-dir")
    return args


def find_urdf(robot_dir: Path) -> Path:
    urdfs = sorted(robot_dir.glob("*.urdf"))
    if len(urdfs) != 1:
        raise RuntimeError(f"{robot_dir} must contain exactly one top-level URDF; found {len(urdfs)}")
    return urdfs[0]


def collect_visual_stls(robot_dir: Path, urdf_path: Path) -> list[tuple[str, Path]]:
    root = ET.parse(urdf_path).getroot()
    references = {
        mesh.attrib["filename"]
        for mesh in root.findall(".//visual/geometry/mesh")
        if "filename" in mesh.attrib
    }
    results: list[tuple[str, Path]] = []
    robot_root = robot_dir.resolve()
    for reference in sorted(references):
        if reference.startswith(("package://", "file://")):
            raise RuntimeError(f"Unsupported non-relative mesh reference in {urdf_path}: {reference}")
        resolved = (robot_dir / reference).resolve()
        try:
            resolved.relative_to(robot_root)
        except ValueError as error:
            raise RuntimeError(f"Mesh reference escapes robot directory: {reference}") from error
        if not resolved.is_file():
            raise FileNotFoundError(f"Missing visual mesh: {resolved}")
        if resolved.suffix.lower() == ".stl":
            results.append((reference, resolved))
    return results


def robot_profile_key(robot_dir: Path) -> str | None:
    directory_name = robot_dir.name.casefold()
    if directory_name == "g1" or directory_name.startswith("g1-"):
        return "g1"
    if directory_name == "h2" or directory_name.startswith("h2-"):
        return "h2"
    return None


def face_cap_for(args: argparse.Namespace, robot_dir: Path, reference: str) -> int:
    if args.max_faces is not None:
        return args.max_faces
    robot_key = robot_profile_key(robot_dir)
    if robot_key is None:
        return GENERIC_FACE_CAP
    filename = Path(reference).name.casefold()
    return VISUALIZATION_FACE_CAPS[robot_key].get(
        filename,
        VISUALIZATION_DEFAULT_FACE_CAP,
    )


def analyze_binary_stl(path: Path, area_epsilon: float) -> dict:
    data = path.read_bytes()
    if len(data) < 84:
        raise RuntimeError(f"STL is too short: {path}")
    face_count = struct.unpack_from("<I", data, 80)[0]
    expected_size = 84 + face_count * 50
    if len(data) != expected_size:
        raise RuntimeError(
            f"STL is not a valid binary triangle stream: {path} "
            f"({len(data)} bytes, expected {expected_size})"
        )

    minimum = [math.inf, math.inf, math.inf]
    maximum = [-math.inf, -math.inf, -math.inf]
    degenerate_faces = 0
    record = struct.Struct("<12fH")
    offset = 84
    for _ in range(face_count):
        values = record.unpack_from(data, offset)
        offset += record.size
        vertices = (values[3:6], values[6:9], values[9:12])
        if not all(math.isfinite(value) for vertex in vertices for value in vertex):
            raise RuntimeError(f"STL contains non-finite coordinates: {path}")
        for vertex in vertices:
            for axis in range(3):
                minimum[axis] = min(minimum[axis], vertex[axis])
                maximum[axis] = max(maximum[axis], vertex[axis])

        ab = tuple(vertices[1][axis] - vertices[0][axis] for axis in range(3))
        ac = tuple(vertices[2][axis] - vertices[0][axis] for axis in range(3))
        cross = (
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
        )
        doubled_area = math.sqrt(sum(component * component for component in cross))
        if doubled_area <= area_epsilon:
            degenerate_faces += 1

    return {
        "bytes": len(data),
        "faces": face_count,
        "degenerateFaces": degenerate_faces,
        "bboxMin": minimum,
        "bboxMax": maximum,
    }


def filter_binary_stl(path: Path, area_epsilon: float) -> int:
    """Remove degenerate output records at the binary STL boundary.

    Blender can recreate a numerically zero-area triangle while triangulating
    during STL export even after its in-memory BMesh validates cleanly. Filtering
    the temporary binary stream itself makes the final invariant deterministic.
    """
    data = path.read_bytes()
    if len(data) < 84:
        raise RuntimeError(f"STL is too short: {path}")
    face_count = struct.unpack_from("<I", data, 80)[0]
    expected_size = 84 + face_count * 50
    if len(data) != expected_size:
        raise RuntimeError(f"Cannot filter malformed binary STL: {path}")

    record = struct.Struct("<12fH")
    valid_records: list[bytes] = []
    removed = 0
    offset = 84
    for _ in range(face_count):
        raw_record = data[offset : offset + record.size]
        values = record.unpack(raw_record)
        offset += record.size
        vertices = (values[3:6], values[6:9], values[9:12])
        if not all(math.isfinite(value) for vertex in vertices for value in vertex):
            raise RuntimeError(f"Blender exported non-finite coordinates: {path}")
        ab = tuple(vertices[1][axis] - vertices[0][axis] for axis in range(3))
        ac = tuple(vertices[2][axis] - vertices[0][axis] for axis in range(3))
        cross = (
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
        )
        doubled_area = math.sqrt(sum(component * component for component in cross))
        if doubled_area <= area_epsilon:
            removed += 1
        else:
            valid_records.append(raw_record)

    if removed:
        path.write_bytes(
            data[:80]
            + struct.pack("<I", len(valid_records))
            + b"".join(valid_records)
        )
    return removed


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def import_stl(path: Path):
    clear_scene()
    bpy.ops.wm.stl_import(
        filepath=str(path),
        global_scale=1.0,
        use_scene_unit=False,
        use_facet_normal=False,
        forward_axis="Y",
        up_axis="Z",
        use_mesh_validate=True,
    )
    meshes = [obj for obj in bpy.context.selected_objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"Blender imported no mesh object from {path}")
    if len(meshes) > 1:
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active or meshes[0]


def clean_mesh(obj, weld_tolerance: float, area_epsilon: float) -> int:
    mesh = obj.data
    working = bmesh.new()
    working.from_mesh(mesh)
    if weld_tolerance > 0:
        bmesh.ops.remove_doubles(working, verts=list(working.verts), dist=weld_tolerance)
    invalid_faces = [face for face in working.faces if face.calc_area() <= area_epsilon]
    if invalid_faces:
        bmesh.ops.delete(working, geom=invalid_faces, context="FACES")
    if working.faces:
        bmesh.ops.recalc_face_normals(working, faces=list(working.faces))
    working.to_mesh(mesh)
    working.free()
    mesh.validate(clean_customdata=True)
    mesh.update()
    return len(invalid_faces)


def decimate_mesh(obj, max_faces: int) -> tuple[int, int, float]:
    before = len(obj.data.polygons)
    if before <= max_faces:
        return before, before, 0.0
    modifier = obj.modifiers.new(name="robot_motion_editor_decimate", type="DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = max_faces / before
    modifier.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    started = time.perf_counter()
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    elapsed = time.perf_counter() - started
    return before, len(obj.data.polygons), elapsed


def export_binary_stl(obj, path: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.wm.stl_export(
        filepath=str(path),
        ascii_format=False,
        export_selected_objects=True,
        global_scale=1.0,
        use_scene_unit=False,
        forward_axis="Y",
        up_axis="Z",
        apply_modifiers=True,
    )


def bbox_relative_delta(before: dict, after: dict) -> float:
    extents = [
        before["bboxMax"][axis] - before["bboxMin"][axis]
        for axis in range(3)
    ]
    diagonal = math.sqrt(sum(extent * extent for extent in extents))
    changed_bound = max(
        abs(before[key][axis] - after[key][axis])
        for key in ("bboxMin", "bboxMax")
        for axis in range(3)
    )
    return changed_bound / max(diagonal, 1e-12)


def destination_for(args: argparse.Namespace, robot_dir: Path, reference: str) -> Path:
    if args.in_place:
        return robot_dir / reference
    if args.output_root:
        return args.output_root / robot_dir.name / reference
    raise RuntimeError("No output destination requested")


def back_up_once(args: argparse.Namespace, robot_dir: Path, reference: str, source: Path) -> None:
    if not args.backup_dir:
        return
    destination = args.backup_dir / robot_dir.name / reference
    if destination.exists():
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def optimize_one(
    args: argparse.Namespace,
    robot_dir: Path,
    reference: str,
    source: Path,
    face_cap: int,
) -> dict:
    before = analyze_binary_stl(source, args.degenerate_area_epsilon)
    needs_write = before["faces"] > face_cap or before["degenerateFaces"] > 0
    base_result = {
        "robot": robot_dir.name,
        "mesh": reference,
        "faceCap": face_cap,
        "before": before,
        "after": before,
        "changed": False,
        "bboxRelativeDelta": 0.0,
        "decimateSeconds": 0.0,
    }
    if not needs_write or (not args.in_place and not args.output_root):
        return base_result

    obj = import_stl(source)
    removed_by_cleanup = clean_mesh(
        obj,
        weld_tolerance=args.weld_tolerance,
        area_epsilon=args.degenerate_area_epsilon,
    )
    _, blender_faces, elapsed = decimate_mesh(obj, face_cap)
    clean_mesh(obj, weld_tolerance=0.0, area_epsilon=args.degenerate_area_epsilon)

    destination = destination_for(args, robot_dir, reference)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_handle = tempfile.NamedTemporaryFile(
        prefix=f".{destination.stem}.optimizing-",
        suffix=destination.suffix,
        dir=destination.parent,
        delete=False,
    )
    temp_path = Path(temp_handle.name)
    temp_handle.close()
    try:
        export_binary_stl(obj, temp_path)
        removed_after_export = filter_binary_stl(temp_path, args.degenerate_area_epsilon)
        after = analyze_binary_stl(temp_path, args.degenerate_area_epsilon)
        relative_delta = bbox_relative_delta(before, after)
        if after["faces"] > face_cap:
            raise RuntimeError(
                f"Simplifier did not reach face cap for {source}: "
                f"{after['faces']} > {face_cap} (Blender reported {blender_faces})"
            )
        if after["degenerateFaces"]:
            raise RuntimeError(
                f"Optimized STL still contains {after['degenerateFaces']} degenerate faces: {source}"
            )
        if relative_delta > args.bbox_relative_tolerance:
            raise RuntimeError(
                f"Bounding-box delta for {source} is {relative_delta:.6f}, "
                f"above {args.bbox_relative_tolerance:.6f}"
            )
        back_up_once(args, robot_dir, reference, source)
        os.replace(temp_path, destination)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise

    return {
        **base_result,
        "after": after,
        "changed": True,
        "bboxRelativeDelta": relative_delta,
        "removedByCleanup": removed_by_cleanup,
        "removedAfterExport": removed_after_export,
        "decimateSeconds": elapsed,
    }


def summarize(results: list[dict]) -> dict:
    return {
        "meshCount": len(results),
        "changedMeshes": sum(1 for result in results if result["changed"]),
        "beforeFaces": sum(result["before"]["faces"] for result in results),
        "afterFaces": sum(result["after"]["faces"] for result in results),
        "beforeBytes": sum(result["before"]["bytes"] for result in results),
        "afterBytes": sum(result["after"]["bytes"] for result in results),
        "beforeDegenerateFaces": sum(
            result["before"]["degenerateFaces"] for result in results
        ),
        "afterDegenerateFaces": sum(
            result["after"]["degenerateFaces"] for result in results
        ),
    }


def main() -> int:
    args = parse_args()
    results: list[dict] = []
    seen_directories: set[Path] = set()
    for requested_robot_dir in args.robot_dir:
        robot_dir = requested_robot_dir.resolve()
        if robot_dir in seen_directories:
            raise RuntimeError(f"Duplicate --robot-dir: {robot_dir}")
        seen_directories.add(robot_dir)
        if not robot_dir.is_dir():
            raise FileNotFoundError(f"Robot directory does not exist: {robot_dir}")
        urdf_path = find_urdf(robot_dir)
        visual_stls = collect_visual_stls(robot_dir, urdf_path)
        if not visual_stls:
            raise RuntimeError(f"No visual STL references found in {urdf_path}")
        print(f"[{robot_dir.name}] {len(visual_stls)} unique visual STL files", flush=True)
        for reference, source in visual_stls:
            face_cap = face_cap_for(args, robot_dir, reference)
            result = optimize_one(args, robot_dir, reference, source, face_cap)
            results.append(result)
            before_faces = result["before"]["faces"]
            after_faces = result["after"]["faces"]
            state = "optimized" if result["changed"] else "unchanged"
            print(
                f"  {state:9} {before_faces:8d} -> {after_faces:8d}  "
                f"cap={face_cap:6d}  {reference}",
                flush=True,
            )

    report = {
        "profile": None if args.max_faces is not None else args.profile,
        "maxFaces": args.max_faces,
        "bboxRelativeTolerance": args.bbox_relative_tolerance,
        "summary": summarize(results),
        "meshes": results,
    }
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(rendered + "\n", encoding="utf-8")
    print(rendered, flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr, flush=True)
        raise
