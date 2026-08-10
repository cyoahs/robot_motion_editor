#!/usr/bin/env node

import assertModule from 'assert';
import * as THREE from 'three';
import {
  DEFAULT_MESH_OPTIMIZATION_OPTIONS,
  getGeometryTriangleCount,
  optimizeObject3DMeshes,
  shouldOptimizeGeometry,
  simplifyBufferGeometry
} from '../src/meshOptimizer.js';

const assert = assertModule.strict;

async function captureGeometryDisposals(callback) {
  const originalDispose = THREE.BufferGeometry.prototype.dispose;
  const disposed = [];
  THREE.BufferGeometry.prototype.dispose = function disposeSpy(...args) {
    disposed.push(this);
    return originalDispose.apply(this, args);
  };
  try {
    return { value: await callback(), disposed };
  } finally {
    THREE.BufferGeometry.prototype.dispose = originalDispose;
  }
}

async function run() {
  assert.equal(
    DEFAULT_MESH_OPTIMIZATION_OPTIONS.targetError,
    0.0005,
    'the runtime default must keep simplification within the benchmarked 0.05% extent budget'
  );

  const root = new THREE.Group();
  const highGeometry = new THREE.PlaneGeometry(2, 2, 40, 40);
  const highTriangles = getGeometryTriangleCount(highGeometry);
  const halfIndexCount = Math.floor(highGeometry.index.count / 6) * 3;
  highGeometry.clearGroups();
  highGeometry.addGroup(0, halfIndexCount, 0);
  highGeometry.addGroup(halfIndexCount, highGeometry.index.count - halfIndexCount, 1);

  const materials = [
    new THREE.MeshBasicMaterial({ color: 0xff0000 }),
    new THREE.MeshBasicMaterial({ color: 0x0000ff })
  ];
  const first = new THREE.Mesh(highGeometry, materials);
  first.name = 'dense-primary';
  first.position.set(1, 2, 3);
  first.rotation.set(0.1, 0.2, 0.3);
  first.scale.set(2, 3, 4);
  first.updateMatrix();

  // Shared geometries are simplified only once and remain shared afterwards.
  const second = new THREE.Mesh(highGeometry, materials);
  second.name = 'dense-shared';
  second.position.set(-3, 4, 5);

  const smallGeometry = new THREE.BoxGeometry(1, 1, 1);
  const smallMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  const small = new THREE.Mesh(smallGeometry, smallMaterial);
  small.name = 'small-skip';

  // This mesh is eligible by index count but malformed. It must fall back to
  // its original geometry without preventing other meshes from succeeding.
  const invalidGeometry = new THREE.BufferGeometry();
  invalidGeometry.setIndex(new THREE.BufferAttribute(new Uint32Array(1200), 1));
  const invalid = new THREE.Mesh(invalidGeometry, smallMaterial);
  invalid.name = 'invalid-fallback';

  root.add(first, second, small, invalid);

  const transformSnapshot = {
    position: first.position.toArray(),
    quaternion: first.quaternion.toArray(),
    scale: first.scale.toArray(),
    matrix: first.matrix.toArray()
  };
  const progress = [];
  let yields = 0;
  const options = {
    thresholdTriangles: 100,
    maxTriangles: 300,
    targetError: 1,
    yieldControl: async () => { yields += 1; },
    onProgress: detail => progress.push(detail.status)
  };

  assert.equal(shouldOptimizeGeometry(highGeometry, options), true);
  assert.equal(shouldOptimizeGeometry(smallGeometry, options), false);
  assert.throws(
    () => shouldOptimizeGeometry(highGeometry, { maxTriangles: 0 }),
    /maxTriangles/
  );

  const originalHighGeometry = highGeometry;
  const optimizationRun = await captureGeometryDisposals(
    () => optimizeObject3DMeshes(root, options)
  );
  const stats = optimizationRun.value;
  const optimizedTriangles = getGeometryTriangleCount(first.geometry);

  assert.equal(stats.backend, 'meshoptimizer-wasm');
  assert.equal(stats.totalMeshes, 4);
  assert.equal(stats.eligibleMeshes, 3);
  assert.equal(stats.optimizedMeshes, 2);
  assert.equal(stats.unchangedMeshes, 0);
  assert.equal(stats.unreachedTargetMeshes, 0);
  assert.equal(stats.skippedMeshes, 1);
  assert.equal(stats.failedMeshes, 1);
  assert.equal(progress.length, 4);
  assert.equal(yields, 3);
  assert.ok(stats.durationMs >= 0);
  assert.ok(stats.savedTriangles > 0);
  assert.equal(stats.beforeTriangles, highTriangles * 2 + 12 + 400);
  assert.equal(stats.afterTriangles, optimizedTriangles * 2 + 12 + 400);

  assert.ok(optimizedTriangles > 0);
  assert.ok(optimizedTriangles <= options.maxTriangles);
  assert.notEqual(first.geometry, originalHighGeometry);
  assert.equal(second.geometry, first.geometry);
  assert.equal(
    optimizationRun.disposed.filter(geometry => geometry === originalHighGeometry).length,
    1,
    'a source geometry shared by multiple meshes must be disposed exactly once'
  );
  assert.equal(
    optimizationRun.disposed.includes(first.geometry),
    false,
    'the optimized geometry shared by live meshes must not be disposed'
  );
  assert.equal(getGeometryTriangleCount(originalHighGeometry), highTriangles);
  assert.equal(first.geometry.groups.length, 2);
  assert.deepEqual(first.geometry.groups.map(group => group.materialIndex), [0, 1]);
  assert.equal(first.material, materials);
  assert.equal(second.material, materials);
  assert.deepEqual(first.position.toArray(), transformSnapshot.position);
  assert.deepEqual(first.quaternion.toArray(), transformSnapshot.quaternion);
  assert.deepEqual(first.scale.toArray(), transformSnapshot.scale);
  assert.deepEqual(first.matrix.toArray(), transformSnapshot.matrix);

  assert.equal(small.geometry, smallGeometry);
  assert.equal(small.material, smallMaterial);
  assert.equal(invalid.geometry, invalidGeometry);
  const failed = stats.details.find(detail => detail.name === 'invalid-fallback');
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /position/i);

  const direct = await simplifyBufferGeometry(
    new THREE.SphereGeometry(1, 32, 16),
    { maxTriangles: 100, targetError: 1 }
  );
  assert.ok(direct.beforeTriangles > direct.afterTriangles);
  assert.ok(direct.afterTriangles <= 100);
  assert.ok(direct.afterVertices < direct.beforeVertices);
  assert.ok(direct.geometry.boundingBox);
  assert.ok(direct.geometry.boundingSphere);
  assert.equal(direct.geometry.userData.meshOptimization.afterTriangles, direct.afterTriangles);

  // The calibrated default sits on the quality/performance elbow: it must
  // refuse an aggressively small triangle target when doing so would exceed
  // 0.05% of the mesh extent. The former 1% budget reaches that target but at
  // a much larger geometric deviation, so this probe catches a loose-default
  // regression without depending on the large benchmark assets.
  const errorProbe = new THREE.SphereGeometry(1, 64, 32).toNonIndexed();
  errorProbe.deleteAttribute('uv');
  const defaultErrorResult = await simplifyBufferGeometry(errorProbe, {
    maxTriangles: 500
  });
  const looseErrorResult = await simplifyBufferGeometry(errorProbe, {
    maxTriangles: 500,
    targetError: 0.01
  });
  assert.equal(defaultErrorResult.reachedTarget, false);
  assert.ok(
    defaultErrorResult.simplificationError <= DEFAULT_MESH_OPTIMIZATION_OPTIONS.targetError
  );
  assert.ok(defaultErrorResult.afterTriangles > looseErrorResult.afterTriangles);
  assert.equal(looseErrorResult.reachedTarget, true);
  assert.ok(
    looseErrorResult.simplificationError > DEFAULT_MESH_OPTIMIZATION_OPTIONS.targetError
  );
  defaultErrorResult.geometry.dispose();
  looseErrorResult.geometry.dispose();
  errorProbe.dispose();

  // A non-default draw range can intentionally hide part of an index buffer.
  // Optimizing the full buffer and resetting the range would make hidden faces
  // visible, so the object-level optimizer must conservatively skip it.
  const rangedGeometry = new THREE.PlaneGeometry(2, 2, 20, 20);
  rangedGeometry.setDrawRange(0, 6);
  const rangedMesh = new THREE.Mesh(rangedGeometry, smallMaterial);
  rangedMesh.name = 'partial-draw-range';
  const rangedRoot = new THREE.Group();
  rangedRoot.add(rangedMesh);
  const rangedStats = await optimizeObject3DMeshes(rangedRoot, {
    thresholdTriangles: 100,
    maxTriangles: 20,
    targetError: 1,
    yieldBetweenMeshes: false
  });
  assert.equal(shouldOptimizeGeometry(rangedGeometry, {
    thresholdTriangles: 100,
    maxTriangles: 20
  }), false);
  assert.equal(rangedStats.eligibleMeshes, 0);
  assert.equal(rangedStats.skippedMeshes, 1);
  assert.equal(rangedStats.details[0].reason, 'non-default-draw-range');
  assert.equal(rangedMesh.geometry, rangedGeometry);
  assert.deepEqual(rangedGeometry.drawRange, { start: 0, count: 6 });
  await assert.rejects(
    simplifyBufferGeometry(rangedGeometry, { maxTriangles: 20, targetError: 1 }),
    /drawRange/
  );

  // A tangent is not reconstructible from positions alone. This exact
  // position+normal+tangent triangle soup previously entered the STL welding
  // path and silently lost its tangent stream.
  const tangentSoup = new THREE.PlaneGeometry(3, 3, 20, 20).toNonIndexed();
  tangentSoup.deleteAttribute('uv');
  const soupVertexCount = tangentSoup.getAttribute('position').count;
  const soupTangents = new Float32Array(soupVertexCount * 4);
  for (let vertex = 0; vertex < soupVertexCount; vertex += 1) {
    soupTangents.set([1, 0, 0, vertex % 2 ? -1 : 1], vertex * 4);
  }
  tangentSoup.setAttribute('tangent', new THREE.Float32BufferAttribute(soupTangents, 4));
  const tangentSoupResult = await simplifyBufferGeometry(tangentSoup, {
    maxTriangles: 20,
    targetError: 1
  });
  assert.ok(tangentSoupResult.geometry.getAttribute('tangent'));
  assert.equal(
    tangentSoupResult.geometry.getAttribute('tangent').count,
    tangentSoupResult.geometry.getAttribute('position').count
  );

  // Indexed geometry keeps every vertex stream aligned while unused vertices
  // are compacted. Include a tangent, a normalized itemSize=5 custom stream,
  // and a morph target to catch accidental attribute deletion or truncation.
  const attributedGeometry = new THREE.PlaneGeometry(4, 4, 30, 30);
  const attributedPosition = attributedGeometry.getAttribute('position');
  const tangents = new Float32Array(attributedPosition.count * 4);
  const customValues = new Uint16Array(attributedPosition.count * 5);
  const morphPosition = attributedPosition.clone();
  const sourceAttributesByPosition = new Map();
  for (let vertex = 0; vertex < attributedPosition.count; vertex += 1) {
    tangents.set([vertex, vertex + 0.25, vertex + 0.5, 1], vertex * 4);
    customValues.set([
      vertex,
      vertex + 1,
      vertex + 2,
      vertex + 3,
      vertex + 4
    ], vertex * 5);
    morphPosition.setZ(vertex, morphPosition.getZ(vertex) + 0.125);
    const key = [
      attributedPosition.getX(vertex),
      attributedPosition.getY(vertex),
      attributedPosition.getZ(vertex)
    ].join(',');
    sourceAttributesByPosition.set(key, {
      tangent: Array.from(tangents.slice(vertex * 4, vertex * 4 + 4)),
      custom: Array.from(customValues.slice(vertex * 5, vertex * 5 + 5)),
      morphZ: morphPosition.getZ(vertex)
    });
  }
  const tangentAttribute = new THREE.Float32BufferAttribute(tangents, 4);
  tangentAttribute.name = 'preserved-tangent';
  tangentAttribute.setUsage(THREE.DynamicDrawUsage);
  attributedGeometry.setAttribute('tangent', tangentAttribute);
  attributedGeometry.setAttribute(
    'applicationData',
    new THREE.Uint16BufferAttribute(customValues, 5, true)
  );
  attributedGeometry.morphAttributes.position = [morphPosition];

  const attributedResult = await simplifyBufferGeometry(attributedGeometry, {
    maxTriangles: 80,
    targetError: 1
  });
  assert.ok(attributedResult.afterTriangles < attributedResult.beforeTriangles);
  assert.ok(attributedResult.afterVertices < attributedResult.beforeVertices);
  const resultPosition = attributedResult.geometry.getAttribute('position');
  const resultTangent = attributedResult.geometry.getAttribute('tangent');
  const resultCustom = attributedResult.geometry.getAttribute('applicationData');
  const resultMorph = attributedResult.geometry.morphAttributes.position[0];
  assert.ok(resultTangent, 'tangent attribute must not be dropped');
  assert.ok(resultCustom, 'custom attribute must not be dropped');
  assert.equal(resultTangent.name, 'preserved-tangent');
  assert.equal(resultTangent.usage, THREE.DynamicDrawUsage);
  assert.equal(resultCustom.itemSize, 5);
  assert.equal(resultCustom.normalized, true);
  assert.equal(resultTangent.count, resultPosition.count);
  assert.equal(resultCustom.count, resultPosition.count);
  assert.equal(resultMorph.count, resultPosition.count);
  for (let vertex = 0; vertex < resultPosition.count; vertex += 1) {
    const key = [
      resultPosition.getX(vertex),
      resultPosition.getY(vertex),
      resultPosition.getZ(vertex)
    ].join(',');
    const expected = sourceAttributesByPosition.get(key);
    assert.ok(expected, `compacted vertex ${key} must originate in the source geometry`);
    assert.deepEqual(
      Array.from(resultTangent.array.slice(vertex * 4, vertex * 4 + 4)),
      expected.tangent
    );
    assert.deepEqual(
      Array.from(resultCustom.array.slice(vertex * 5, vertex * 5 + 5)),
      expected.custom
    );
    assert.equal(resultMorph.getZ(vertex), expected.morphZ);
  }

  // STLLoader produces a non-indexed position+normal triangle soup. It needs a
  // welded topology for simplification, but the render result must be expanded
  // again so every triangle retains a flat normal and no unused vertices remain.
  const flatSource = new THREE.PlaneGeometry(4, 4, 40, 40).toNonIndexed();
  flatSource.deleteAttribute('uv');
  const flatSourceVertices = flatSource.getAttribute('position').count;
  const flatResult = await simplifyBufferGeometry(flatSource, {
    maxTriangles: 20,
    targetError: 1
  });
  assert.ok(flatResult.afterTriangles < flatResult.beforeTriangles);
  assert.equal(flatResult.geometry.index, null);
  assert.equal(flatResult.afterVertices, flatResult.afterTriangles * 3);
  assert.ok(flatResult.afterVertices < flatSourceVertices);
  assert.equal(flatSource.getAttribute('position').count, flatSourceVertices);
  const flatNormals = flatResult.geometry.getAttribute('normal');
  assert.equal(flatNormals.count, flatResult.afterVertices);
  for (let triangle = 0; triangle < flatResult.afterTriangles; triangle += 1) {
    const offset = triangle * 3;
    const firstNormal = [
      flatNormals.getX(offset),
      flatNormals.getY(offset),
      flatNormals.getZ(offset)
    ];
    for (let corner = 1; corner < 3; corner += 1) {
      assert.deepEqual([
        flatNormals.getX(offset + corner),
        flatNormals.getY(offset + corner),
        flatNormals.getZ(offset + corner)
      ], firstNormal);
    }
  }

  // A simplifier can legitimately be constrained by topology or the error
  // target. Such an attempt must not replace the geometry or claim success.
  const lockedGeometry = new THREE.BufferGeometry();
  const lockedPositions = [];
  const lockedIndices = [];
  for (let triangle = 0; triangle < 200; triangle += 1) {
    const vertex = triangle * 3;
    const x = triangle * 3;
    lockedPositions.push(x, 0, 0, x + 1, 0, 0, x, 1, 0);
    lockedIndices.push(vertex, vertex + 1, vertex + 2);
  }
  lockedGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(lockedPositions, 3)
  );
  lockedGeometry.setIndex(lockedIndices);
  const lockedMesh = new THREE.Mesh(lockedGeometry, smallMaterial);
  lockedMesh.name = 'locked-unchanged';
  const lockedRoot = new THREE.Group();
  lockedRoot.add(lockedMesh);
  const lockedRun = await captureGeometryDisposals(
    () => optimizeObject3DMeshes(lockedRoot, {
      thresholdTriangles: 100,
      maxTriangles: 10,
      targetError: 1,
      simplifierFlags: ['LockBorder'],
      yieldBetweenMeshes: false
    })
  );
  const lockedStats = lockedRun.value;
  assert.equal(lockedStats.eligibleMeshes, 1);
  assert.equal(lockedStats.optimizedMeshes, 0);
  assert.equal(lockedStats.unchangedMeshes, 1);
  assert.equal(lockedStats.unreachedTargetMeshes, 1);
  assert.equal(lockedStats.savedTriangles, 0);
  assert.equal(lockedStats.details[0].status, 'unchanged');
  assert.equal(lockedStats.details[0].reachedTarget, false);
  assert.equal(lockedMesh.geometry, lockedGeometry);
  assert.equal(lockedRun.disposed.includes(lockedGeometry), false);
  assert.equal(lockedRun.disposed.length, 1);
  assert.notEqual(
    lockedRun.disposed[0],
    lockedMesh.geometry,
    'the unused simplification result, not the retained source, must be disposed'
  );

  console.log('mesh optimizer tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
