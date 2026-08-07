#!/usr/bin/env python3
"""Render deterministic multi-view URDF visuals with Blender.

The script intentionally supports the small URDF subset used by the bundled
G1/H2 assets: fixed/revolute joints at their zero pose, STL visual meshes,
visual origins, and mesh scales. Run it through Blender:

  blender --background --factory-startup \
    --python scripts/render_urdf_visuals.py -- \
    --robot-dir assets/g1 --output-dir /tmp/g1-renders --label current

Use the same --bounds-file for every simplification candidate so silhouette
comparisons use identical cameras.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

import bpy
from mathutils import Euler, Matrix, Vector


def parse_args() -> argparse.Namespace:
    separator = sys.argv.index("--") if "--" in sys.argv else len(sys.argv)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--robot-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--label", default="render")
    parser.add_argument("--bounds-file", type=Path)
    parser.add_argument("--resolution", type=int, default=720)
    return parser.parse_args(sys.argv[separator + 1 :])


def parse_vector(value: str | None, default: tuple[float, float, float]) -> Vector:
    if not value:
        return Vector(default)
    components = [float(component) for component in value.split()]
    if len(components) != 3 or not all(math.isfinite(value) for value in components):
        raise ValueError(f"Expected three finite values, received {value!r}")
    return Vector(components)


def origin_matrix(element: ET.Element | None) -> Matrix:
    if element is None:
        return Matrix.Identity(4)
    translation = Matrix.Translation(parse_vector(element.get("xyz"), (0.0, 0.0, 0.0)))
    rpy = parse_vector(element.get("rpy"), (0.0, 0.0, 0.0))
    rotation = Euler((rpy.x, rpy.y, rpy.z), "XYZ").to_matrix().to_4x4()
    return translation @ rotation


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for item in list(collection):
            collection.remove(item)


def find_urdf(robot_dir: Path) -> Path:
    urdfs = sorted(robot_dir.glob("*.urdf"))
    if len(urdfs) != 1:
        raise RuntimeError(f"{robot_dir} must contain one top-level URDF, found {len(urdfs)}")
    return urdfs[0]


def link_poses(root: ET.Element) -> dict[str, Matrix]:
    parent_by_child: dict[str, tuple[str, Matrix]] = {}
    for joint in root.findall("joint"):
        parent = joint.find("parent")
        child = joint.find("child")
        if parent is None or child is None:
            continue
        parent_by_child[child.get("link", "")] = (
            parent.get("link", ""),
            origin_matrix(joint.find("origin")),
        )

    cache: dict[str, Matrix] = {}

    def resolve(link_name: str, stack: tuple[str, ...] = ()) -> Matrix:
        if link_name in cache:
            return cache[link_name]
        if link_name in stack:
            raise RuntimeError(f"Joint cycle detected: {' -> '.join(stack + (link_name,))}")
        if link_name not in parent_by_child:
            cache[link_name] = Matrix.Identity(4)
        else:
            parent, local = parent_by_child[link_name]
            cache[link_name] = resolve(parent, stack + (link_name,)) @ local
        return cache[link_name]

    for link in root.findall("link"):
        resolve(link.get("name", ""))
    return cache


def material_for_link(link_name: str):
    lowered = link_name.lower()
    if any(token in lowered for token in ("hand", "wrist")):
        color = (0.12, 0.23, 0.34, 1.0)
    elif any(token in lowered for token in ("head", "torso", "pelvis", "waist")):
        color = (0.30, 0.39, 0.48, 1.0)
    elif "left" in lowered:
        color = (0.23, 0.48, 0.69, 1.0)
    elif "right" in lowered:
        color = (0.23, 0.61, 0.52, 1.0)
    else:
        color = (0.42, 0.47, 0.52, 1.0)
    material = bpy.data.materials.new(name=f"material_{link_name}")
    material.diffuse_color = color
    return material


def import_visuals(robot_dir: Path, root: ET.Element) -> list:
    poses = link_poses(root)
    objects = []
    for link in root.findall("link"):
        link_name = link.get("name", "unnamed")
        material = material_for_link(link_name)
        for visual_index, visual in enumerate(link.findall("visual")):
            mesh = visual.find("geometry/mesh")
            if mesh is None or not mesh.get("filename"):
                continue
            reference = mesh.get("filename", "").replace("\\", "/")
            if reference.startswith(("package://", "file://")):
                raise RuntimeError(f"Unsupported mesh path: {reference}")
            path = (robot_dir / reference).resolve()
            if not path.is_file() or path.suffix.lower() != ".stl":
                raise FileNotFoundError(f"Missing STL visual: {path}")
            bpy.ops.wm.stl_import(
                filepath=str(path),
                global_scale=1.0,
                use_scene_unit=False,
                use_facet_normal=True,
                forward_axis="Y",
                up_axis="Z",
                use_mesh_validate=True,
            )
            imported = [obj for obj in bpy.context.selected_objects if obj.type == "MESH"]
            if len(imported) != 1:
                raise RuntimeError(f"Expected one imported mesh for {path}, got {len(imported)}")
            obj = imported[0]
            obj.name = f"{link_name}__visual_{visual_index}"
            scale = parse_vector(mesh.get("scale"), (1.0, 1.0, 1.0))
            scale_matrix = Matrix.Diagonal((scale.x, scale.y, scale.z, 1.0))
            obj.matrix_world = poses[link_name] @ origin_matrix(visual.find("origin")) @ scale_matrix
            obj.data.materials.clear()
            obj.data.materials.append(material)
            for polygon in obj.data.polygons:
                polygon.use_smooth = False
            objects.append(obj)
    if not objects:
        raise RuntimeError(f"No STL visual objects found in {robot_dir}")
    return objects


def object_bounds(objects: list) -> tuple[Vector, Vector]:
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    for obj in objects:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                minimum[axis] = min(minimum[axis], world[axis])
                maximum[axis] = max(maximum[axis], world[axis])
    return minimum, maximum


def load_or_save_bounds(path: Path | None, objects: list) -> tuple[Vector, Vector]:
    if path and path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        return Vector(data["minimum"]), Vector(data["maximum"])
    minimum, maximum = object_bounds(objects)
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"minimum": list(minimum), "maximum": list(maximum)}, indent=2) + "\n",
            encoding="utf-8",
        )
    return minimum, maximum


def configure_scene(resolution: int):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = resolution
    scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.curvature_ridge_factor = 1.5
    scene.display.shading.curvature_valley_factor = 1.0
    scene.display.shading.show_specular_highlight = True
    # Blender 5.x prefixes AgX look names; older releases used the shorter
    # spelling. Prefer the current enum while retaining script portability.
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        scene.view_settings.look = "Medium High Contrast"
    return scene


def point_camera(camera, target: Vector, direction: Vector) -> None:
    camera.location = target + direction
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def render_views(
    scene,
    objects: list,
    minimum: Vector,
    maximum: Vector,
    output_dir: Path,
    label: str,
) -> None:
    center = (minimum + maximum) * 0.5
    extent = maximum - minimum
    height = max(extent.z, 1e-3)
    diameter = max(extent.length, height)

    camera_data = bpy.data.cameras.new("comparison_camera")
    camera = bpy.data.objects.new("comparison_camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera_data.type = "ORTHO"
    scene.camera = camera

    views = {
        "three_quarter": (center, Vector((diameter, -diameter, diameter * 0.55)), height * 1.16),
        "front": (center, Vector((diameter * 1.7, 0.0, diameter * 0.05)), height * 1.16),
        "side": (center, Vector((0.0, -diameter * 1.7, diameter * 0.05)), height * 1.16),
        "upper": (
            Vector((center.x, center.y, minimum.z + height * 0.72)),
            Vector((diameter, -diameter, diameter * 0.35)),
            height * 0.62,
        ),
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    for view_name, (target, direction, ortho_scale) in views.items():
        camera_data.ortho_scale = ortho_scale
        point_camera(camera, target, direction)
        scene.render.filepath = str(output_dir / f"{label}__{view_name}.png")
        bpy.ops.render.render(write_still=True)


def main() -> int:
    args = parse_args()
    if args.resolution < 128:
        raise ValueError("--resolution must be at least 128")
    robot_dir = args.robot_dir.resolve()
    clear_scene()
    root = ET.parse(find_urdf(robot_dir)).getroot()
    objects = import_visuals(robot_dir, root)
    minimum, maximum = load_or_save_bounds(args.bounds_file, objects)
    scene = configure_scene(args.resolution)
    render_views(scene, objects, minimum, maximum, args.output_dir, args.label)
    print(json.dumps({
        "robot": root.get("name", robot_dir.name),
        "visualMeshes": len(objects),
        "bounds": {"minimum": list(minimum), "maximum": list(maximum)},
        "outputDir": str(args.output_dir),
        "label": args.label,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
