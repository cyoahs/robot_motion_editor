import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';

export const DEFAULT_MESH_OPTIMIZATION_OPTIONS = Object.freeze({
  enabled: true,
  thresholdTriangles: 30000,
  maxTriangles: 20000,
  targetError: 0.0005,
  weldTolerance: 1e-6,
  degenerateAreaEpsilon: 1e-20,
  lockMaterialBoundaries: true,
  simplifierFlags: [],
  yieldBetweenMeshes: true
});

function assertNonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}

function normalizeOptions(options = {}) {
  const normalized = { ...DEFAULT_MESH_OPTIMIZATION_OPTIONS, ...options };
  assertNonNegativeInteger(normalized.thresholdTriangles, 'thresholdTriangles');
  if (!Number.isInteger(normalized.maxTriangles) || normalized.maxTriangles < 1) {
    throw new RangeError('maxTriangles must be a positive integer');
  }
  if (!Number.isFinite(normalized.targetError) || normalized.targetError < 0) {
    throw new RangeError('targetError must be a finite non-negative number');
  }
  if (!Number.isFinite(normalized.weldTolerance) || normalized.weldTolerance <= 0) {
    throw new RangeError('weldTolerance must be a finite positive number');
  }
  if (!Number.isFinite(normalized.degenerateAreaEpsilon) || normalized.degenerateAreaEpsilon < 0) {
    throw new RangeError('degenerateAreaEpsilon must be a finite non-negative number');
  }
  if (!Array.isArray(normalized.simplifierFlags)) {
    throw new TypeError('simplifierFlags must be an array');
  }
  return normalized;
}

export function getGeometryTriangleCount(geometry) {
  if (!geometry?.isBufferGeometry) return 0;
  const elementCount = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
  return Math.floor(elementCount / 3);
}

export function shouldOptimizeGeometry(geometry, options = {}) {
  const normalized = normalizeOptions(options);
  const triangles = getGeometryTriangleCount(geometry);
  return normalized.enabled
    && hasDefaultDrawRange(geometry)
    && triangles > normalized.thresholdTriangles
    && triangles > normalized.maxTriangles;
}

function hasDefaultDrawRange(geometry) {
  return geometry.drawRange?.start === 0
    && geometry.drawRange?.count === Infinity;
}

function isFlatNormalTriangleSoup(geometry) {
  if (geometry.index || !geometry.getAttribute('normal')) return false;
  const attributeNames = Object.keys(geometry.attributes);
  const hasOnlySTLAttributes = attributeNames.every(
    name => name === 'position' || name === 'normal'
  );
  const hasMorphAttributes = Object.values(geometry.morphAttributes || {})
    .some(attributes => attributes?.length > 0);
  return hasOnlySTLAttributes && !hasMorphAttributes;
}

function ensureIndexedGeometry(geometry, weldTolerance) {
  const working = geometry.clone();
  const rebuildFlatNormals = isFlatNormalTriangleSoup(geometry);

  // STL is normally a non-indexed triangle soup whose per-face normals prevent
  // otherwise identical positions from being welded. Build a position-only
  // topology for simplification, then expand the result back to flat-shaded
  // triangles. Other attributes (including tangents and custom attributes) are
  // never discarded merely to make a mesh easier to simplify.
  if (rebuildFlatNormals) {
    working.deleteAttribute('normal');
  }

  let indexed;
  if (rebuildFlatNormals) {
    indexed = mergeVertices(working, weldTolerance);
  } else {
    // Keep the original vertex streams byte-for-byte. In particular, welding a
    // generic triangle soup can merge intentional UV, tangent, color, skinning,
    // or application-specific seams. An identity index is conservative: the
    // simplifier may decide that such a soup cannot be reduced, in which case
    // optimizeObject3DMeshes leaves the source geometry untouched.
    indexed = working;
  }

  if (!indexed.index) {
    const position = indexed.getAttribute('position');
    if (!position) throw new Error('Geometry has no position attribute');
    const IndexArray = position.count > 65535 ? Uint32Array : Uint16Array;
    const indices = new IndexArray(position.count);
    for (let index = 0; index < indices.length; index += 1) indices[index] = index;
    indexed.setIndex(new THREE.BufferAttribute(indices, 1));
  }

  return { geometry: indexed, rebuildFlatNormals };
}

function getPackedPositions(position) {
  if (!position || position.itemSize < 3) {
    throw new Error('Geometry position attribute must contain xyz values');
  }
  const packed = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const offset = index * 3;
    packed[offset] = position.getX(index);
    packed[offset + 1] = position.getY(index);
    packed[offset + 2] = position.getZ(index);
  }
  return packed;
}

function normalizeGroups(geometry, indexCount) {
  if (!geometry.groups.length) {
    return [{ start: 0, count: indexCount, materialIndex: 0 }];
  }

  const groups = geometry.groups
    .map(group => ({
      start: Math.max(0, group.start),
      count: Math.min(group.count, indexCount - Math.max(0, group.start)),
      materialIndex: group.materialIndex ?? 0
    }))
    .filter(group => group.count > 0)
    .sort((left, right) => left.start - right.start);

  let cursor = 0;
  const normalized = [];
  for (const group of groups) {
    if (group.start % 3 !== 0 || group.count % 3 !== 0) {
      throw new Error('Geometry material groups must align to complete triangles');
    }
    if (group.start < cursor) {
      throw new Error('Overlapping geometry material groups are not supported');
    }
    if (group.start > cursor) {
      normalized.push({ start: cursor, count: group.start - cursor, materialIndex: 0 });
    }
    normalized.push(group);
    cursor = group.start + group.count;
  }
  if (cursor < indexCount) {
    normalized.push({ start: cursor, count: indexCount - cursor, materialIndex: 0 });
  }
  return normalized;
}

function filterDegenerateTriangles(indices, positions, areaEpsilon) {
  const clean = [];
  let removed = 0;

  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset];
    const b = indices[offset + 1];
    const c = indices[offset + 2];
    if (a === b || b === c || c === a) {
      removed += 1;
      continue;
    }

    const ai = a * 3;
    const bi = b * 3;
    const ci = c * 3;
    if (ai + 2 >= positions.length
      || bi + 2 >= positions.length
      || ci + 2 >= positions.length
      || ai < 0
      || bi < 0
      || ci < 0) {
      throw new RangeError('Geometry index references a missing vertex');
    }

    const abx = positions[bi] - positions[ai];
    const aby = positions[bi + 1] - positions[ai + 1];
    const abz = positions[bi + 2] - positions[ai + 2];
    const acx = positions[ci] - positions[ai];
    const acy = positions[ci + 1] - positions[ai + 1];
    const acz = positions[ci + 2] - positions[ai + 2];
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;
    const doubledAreaSquared = crossX * crossX + crossY * crossY + crossZ * crossZ;

    if (!Number.isFinite(doubledAreaSquared) || doubledAreaSquared <= areaEpsilon) {
      removed += 1;
      continue;
    }
    clean.push(a, b, c);
  }

  return { indices: new Uint32Array(clean), removed };
}

function allocateTriangleTargets(groupTriangleCounts, maxTriangles) {
  const total = groupTriangleCounts.reduce((sum, count) => sum + count, 0);
  if (total <= maxTriangles) return [...groupTriangleCounts];

  const targets = [];
  let remainingFaces = total;
  let remainingTarget = maxTriangles;
  for (let index = 0; index < groupTriangleCounts.length; index += 1) {
    const faces = groupTriangleCounts[index];
    const groupsLeft = groupTriangleCounts.length - index - 1;
    if (index === groupTriangleCounts.length - 1) {
      targets.push(Math.min(faces, Math.max(1, remainingTarget)));
      break;
    }
    const proportional = Math.floor((faces / remainingFaces) * remainingTarget);
    const target = Math.min(faces, Math.max(1, Math.min(proportional, remainingTarget - groupsLeft)));
    targets.push(target);
    remainingFaces -= faces;
    remainingTarget -= target;
  }
  return targets;
}

function makeIndexAttribute(indices, vertexCount) {
  const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
  return new THREE.BufferAttribute(new IndexArray(indices), 1);
}

function compactAttribute(attribute, remap, uniqueVertexCount) {
  if (!attribute?.array || attribute.count < remap.length) {
    throw new Error('Geometry attribute cannot be safely remapped');
  }

  const values = new attribute.array.constructor(uniqueVertexCount * attribute.itemSize);
  for (let sourceIndex = 0; sourceIndex < remap.length; sourceIndex += 1) {
    const targetIndex = remap[sourceIndex];
    if (targetIndex === 0xffffffff || targetIndex >= uniqueVertexCount) continue;

    const sourceOffset = attribute.isInterleavedBufferAttribute
      ? sourceIndex * attribute.data.stride + attribute.offset
      : sourceIndex * attribute.itemSize;
    const targetOffset = targetIndex * attribute.itemSize;
    for (let component = 0; component < attribute.itemSize; component += 1) {
      values[targetOffset + component] = attribute.array[sourceOffset + component];
    }
  }

  let compacted;
  if (attribute.isInterleavedBufferAttribute) {
    compacted = new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized);
  } else if (attribute.isInstancedBufferAttribute) {
    compacted = new attribute.constructor(
      values,
      attribute.itemSize,
      attribute.normalized,
      attribute.meshPerAttribute
    );
  } else {
    try {
      compacted = new attribute.constructor(values, attribute.itemSize, attribute.normalized);
    } catch (_error) {
      compacted = new THREE.BufferAttribute(values, attribute.itemSize, attribute.normalized);
    }
  }

  compacted.name = attribute.name;
  const usage = attribute.usage ?? attribute.data?.usage;
  if (usage !== undefined && typeof compacted.setUsage === 'function') compacted.setUsage(usage);
  if (attribute.gpuType !== undefined) compacted.gpuType = attribute.gpuType;
  return compacted;
}

function compactGeometryVertices(geometry, indices) {
  const compactIndices = new Uint32Array(indices);
  const [remap, uniqueVertexCount] = MeshoptSimplifier.compactMesh(compactIndices);

  Object.entries(geometry.attributes).forEach(([name, attribute]) => {
    geometry.setAttribute(name, compactAttribute(attribute, remap, uniqueVertexCount));
  });
  Object.entries(geometry.morphAttributes || {}).forEach(([name, attributes]) => {
    geometry.morphAttributes[name] = attributes.map(
      attribute => compactAttribute(attribute, remap, uniqueVertexCount)
    );
  });
  geometry.setIndex(makeIndexAttribute(compactIndices, uniqueVertexCount));
  return uniqueVertexCount;
}

function expandFlatShadedGeometry(indexedGeometry, indices) {
  indexedGeometry.setIndex(makeIndexAttribute(
    indices,
    indexedGeometry.getAttribute('position').count
  ));
  const flatGeometry = indexedGeometry.toNonIndexed();
  flatGeometry.name = indexedGeometry.name;
  flatGeometry.userData = { ...indexedGeometry.userData };
  flatGeometry.computeVertexNormals();
  return flatGeometry;
}

/**
 * Simplify one BufferGeometry. The source geometry is never mutated.
 */
export async function simplifyBufferGeometry(sourceGeometry, options = {}) {
  const normalized = normalizeOptions(options);
  if (!sourceGeometry?.isBufferGeometry) throw new TypeError('Expected a THREE.BufferGeometry');
  if (!hasDefaultDrawRange(sourceGeometry)) {
    throw new Error('Geometry with a non-default drawRange cannot be safely simplified');
  }
  if (!MeshoptSimplifier.supported) throw new Error('meshoptimizer WebAssembly is not supported');
  await MeshoptSimplifier.ready;

  const beforeTriangles = getGeometryTriangleCount(sourceGeometry);
  let { geometry, rebuildFlatNormals } = ensureIndexedGeometry(
    sourceGeometry,
    normalized.weldTolerance
  );
  const position = geometry.getAttribute('position');
  const positions = getPackedPositions(position);
  const sourceIndices = geometry.index.array;
  if (sourceIndices.length % 3 !== 0) {
    throw new Error('Geometry index count must be divisible by three');
  }
  const groups = normalizeGroups(geometry, sourceIndices.length);

  const cleanGroups = groups.map(group => {
    const source = new Uint32Array(group.count);
    for (let index = 0; index < group.count; index += 1) {
      source[index] = sourceIndices[group.start + index];
    }
    const clean = filterDegenerateTriangles(
      source,
      positions,
      normalized.degenerateAreaEpsilon
    );
    return { ...group, ...clean };
  }).filter(group => group.indices.length > 0);

  const cleanedTriangles = cleanGroups.reduce(
    (sum, group) => sum + group.indices.length / 3,
    0
  );
  if (cleanedTriangles === 0) throw new Error('Geometry contains no valid triangles');

  const targets = allocateTriangleTargets(
    cleanGroups.map(group => group.indices.length / 3),
    normalized.maxTriangles
  );
  const outputIndices = [];
  const outputGroups = [];
  let simplificationError = 0;
  let removedDegenerateTriangles = 0;

  for (let groupIndex = 0; groupIndex < cleanGroups.length; groupIndex += 1) {
    const group = cleanGroups[groupIndex];
    const targetIndices = targets[groupIndex] * 3;
    let simplified = group.indices;
    let groupError = 0;
    if (group.indices.length > targetIndices) {
      const flags = [...normalized.simplifierFlags];
      if (normalized.lockMaterialBoundaries && cleanGroups.length > 1 && !flags.includes('LockBorder')) {
        flags.push('LockBorder');
      }
      [simplified, groupError] = MeshoptSimplifier.simplify(
        group.indices,
        positions,
        3,
        targetIndices,
        normalized.targetError,
        flags
      );
    }

    const start = outputIndices.length;
    for (const vertexIndex of simplified) outputIndices.push(vertexIndex);
    outputGroups.push({
      start,
      count: simplified.length,
      materialIndex: group.materialIndex
    });
    simplificationError = Math.max(simplificationError, groupError);
    removedDegenerateTriangles += group.removed;
  }

  geometry.clearGroups();
  if (sourceGeometry.groups.length) {
    outputGroups.forEach(group => geometry.addGroup(group.start, group.count, group.materialIndex));
  }
  const beforeVertices = sourceGeometry.getAttribute('position')?.count ?? 0;
  if (rebuildFlatNormals) {
    geometry = expandFlatShadedGeometry(geometry, outputIndices);
  } else {
    compactGeometryVertices(geometry, outputIndices);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const afterTriangles = getGeometryTriangleCount(geometry);
  const afterVertices = geometry.getAttribute('position')?.count ?? 0;
  const result = {
    geometry,
    beforeTriangles,
    cleanedTriangles,
    afterTriangles,
    beforeVertices,
    afterVertices,
    removedDegenerateTriangles,
    simplificationError,
    reachedTarget: afterTriangles <= normalized.maxTriangles
  };
  geometry.userData = {
    ...geometry.userData,
    meshOptimization: {
      beforeTriangles,
      afterTriangles,
      beforeVertices,
      afterVertices,
      removedDegenerateTriangles,
      simplificationError,
      reachedTarget: result.reachedTarget
    }
  };
  return result;
}

function abortIfRequested(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
  throw new Error('Mesh optimization aborted');
}

async function defaultYieldControl() {
  if (globalThis.scheduler?.yield) {
    await globalThis.scheduler.yield();
  } else {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

function emitProgress(callback, detail, stats) {
  if (typeof callback !== 'function') return;
  try {
    callback(detail, stats);
  } catch (error) {
    console.warn('Mesh optimization progress callback failed:', error);
  }
}

function disposeUnusedCachedGeometries(root, geometryCache) {
  const geometriesInUse = new Set();
  root.traverse(object => {
    if (object?.geometry?.isBufferGeometry) geometriesInUse.add(object.geometry);
  });

  const disposalCandidates = new Set();
  geometryCache.forEach((cached, originalGeometry) => {
    disposalCandidates.add(originalGeometry);
    if (cached.status === 'optimized' && cached.result?.geometry) {
      disposalCandidates.add(cached.result.geometry);
    }
  });

  disposalCandidates.forEach(geometry => {
    if (!geometriesInUse.has(geometry) && typeof geometry.dispose === 'function') {
      geometry.dispose();
    }
  });
}

/**
 * Asynchronously optimize eligible meshes below an Object3D. Materials and all
 * Object3D transforms are preserved because only a successfully simplified
 * geometry is replaced. A failure affects only that mesh and leaves its source
 * geometry intact.
 */
export async function optimizeObject3DMeshes(root, options = {}) {
  if (!root?.traverse || typeof root.traverse !== 'function') {
    throw new TypeError('Expected a THREE.Object3D root');
  }
  const normalized = normalizeOptions(options);
  const meshes = [];
  root.traverse(object => {
    if (object?.isMesh && object.geometry?.isBufferGeometry) meshes.push(object);
  });

  const startedAt = globalThis.performance?.now?.() ?? Date.now();
  const stats = {
    backend: MeshoptSimplifier.supported ? 'meshoptimizer-wasm' : 'unavailable',
    totalMeshes: meshes.length,
    eligibleMeshes: 0,
    optimizedMeshes: 0,
    unchangedMeshes: 0,
    unreachedTargetMeshes: 0,
    skippedMeshes: 0,
    failedMeshes: 0,
    beforeTriangles: 0,
    afterTriangles: 0,
    savedTriangles: 0,
    durationMs: 0,
    details: []
  };
  const geometryCache = new Map();
  const yieldControl = typeof normalized.yieldControl === 'function'
    ? normalized.yieldControl
    : defaultYieldControl;

  if (normalized.enabled && MeshoptSimplifier.supported) await MeshoptSimplifier.ready;

  try {
    for (const mesh of meshes) {
      abortIfRequested(normalized.signal);
      const originalGeometry = mesh.geometry;
      const beforeTriangles = getGeometryTriangleCount(originalGeometry);
      stats.beforeTriangles += beforeTriangles;

      let skipReason = null;
      if (!normalized.enabled) skipReason = 'disabled';
      else if (!hasDefaultDrawRange(originalGeometry)) skipReason = 'non-default-draw-range';
      else if (beforeTriangles <= normalized.thresholdTriangles) skipReason = 'below-threshold';
      else if (beforeTriangles <= normalized.maxTriangles) skipReason = 'already-within-target';

      if (skipReason) {
        const detail = {
          name: mesh.name || mesh.uuid,
          status: 'skipped',
          reason: skipReason,
          beforeTriangles,
          afterTriangles: beforeTriangles
        };
        stats.skippedMeshes += 1;
        stats.afterTriangles += beforeTriangles;
        stats.details.push(detail);
        emitProgress(normalized.onProgress, detail, stats);
        continue;
      }

      stats.eligibleMeshes += 1;
      if (normalized.yieldBetweenMeshes) await yieldControl();
      abortIfRequested(normalized.signal);

      let cached = geometryCache.get(originalGeometry);
      if (!cached) {
        try {
          cached = {
            status: 'optimized',
            result: await simplifyBufferGeometry(originalGeometry, normalized)
          };
        } catch (error) {
          cached = { status: 'failed', error };
        }
        geometryCache.set(originalGeometry, cached);
      }

      if (cached.status === 'failed') {
        const detail = {
          name: mesh.name || mesh.uuid,
          status: 'failed',
          beforeTriangles,
          afterTriangles: beforeTriangles,
          error: cached.error instanceof Error ? cached.error.message : String(cached.error)
        };
        stats.failedMeshes += 1;
        stats.afterTriangles += beforeTriangles;
        stats.details.push(detail);
        emitProgress(normalized.onProgress, detail, stats);
        continue;
      }

      const result = cached.result;
      if (result.afterTriangles >= beforeTriangles) {
        const detail = {
          name: mesh.name || mesh.uuid,
          status: 'unchanged',
          beforeTriangles,
          afterTriangles: beforeTriangles,
          attemptedAfterTriangles: result.afterTriangles,
          removedDegenerateTriangles: result.removedDegenerateTriangles,
          simplificationError: result.simplificationError,
          reachedTarget: result.reachedTarget
        };
        stats.unchangedMeshes += 1;
        if (!result.reachedTarget) stats.unreachedTargetMeshes += 1;
        stats.afterTriangles += beforeTriangles;
        stats.details.push(detail);
        emitProgress(normalized.onProgress, detail, stats);
        continue;
      }

      mesh.geometry = result.geometry;
      const afterTriangles = result.afterTriangles;
      const detail = {
        name: mesh.name || mesh.uuid,
        status: 'optimized',
        beforeTriangles,
        afterTriangles,
        beforeVertices: result.beforeVertices,
        afterVertices: result.afterVertices,
        removedDegenerateTriangles: result.removedDegenerateTriangles,
        simplificationError: result.simplificationError,
        reachedTarget: result.reachedTarget
      };
      stats.optimizedMeshes += 1;
      if (!result.reachedTarget) stats.unreachedTargetMeshes += 1;
      stats.afterTriangles += afterTriangles;
      stats.details.push(detail);
      emitProgress(normalized.onProgress, detail, stats);
    }
  } finally {
    disposeUnusedCachedGeometries(root, geometryCache);
  }

  stats.savedTriangles = stats.beforeTriangles - stats.afterTriangles;
  const finishedAt = globalThis.performance?.now?.() ?? Date.now();
  stats.durationMs = Math.max(0, finishedAt - startedAt);
  return stats;
}
