#!/usr/bin/env node

import * as THREE from 'three';
import {
  composeRootRotation,
  decomposeRootRotation,
  getRootHeadingFromQuaternion,
  normalizeQuaternion
} from '../src/rotationDecomposition.js';

const EPSILON = 1e-6;

function assertClose(actual, expected, label, epsilon = EPSILON) {
  const diff = Math.abs(actual - expected);
  if (diff > epsilon) {
    throw new Error(`${label}: expected ${expected}, got ${actual}, diff ${diff}`);
  }
}

function assertVectorClose(actual, expected, label, epsilon = EPSILON) {
  assertClose(actual.x, expected.x, `${label}.x`, epsilon);
  assertClose(actual.y, expected.y, `${label}.y`, epsilon);
  assertClose(actual.z, expected.z, `${label}.z`, epsilon);
}

function assertEquivalentQuaternion(actual, expected, label, epsilon = EPSILON) {
  const direct = Math.abs(actual.x - expected.x) +
    Math.abs(actual.y - expected.y) +
    Math.abs(actual.z - expected.z) +
    Math.abs(actual.w - expected.w);
  const negated = Math.abs(actual.x + expected.x) +
    Math.abs(actual.y + expected.y) +
    Math.abs(actual.z + expected.z) +
    Math.abs(actual.w + expected.w);

  if (Math.min(direct, negated) > epsilon) {
    throw new Error(`${label}: quaternions differ`);
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(error.message);
    process.exitCode = 1;
  }
}

test('yawZ rotates root local +X heading in the world XY plane', () => {
  const q = composeRootRotation({
    yawZ: 90,
    pitchSide: 0,
    rollHeading: 0
  });

  const heading = getRootHeadingFromQuaternion(q);

  assertVectorClose(heading, new THREE.Vector3(0, 1, 0), 'heading');
});

test('pitchSide rotates around worldZ cross heading after yaw', () => {
  const q = composeRootRotation({
    yawZ: 90,
    pitchSide: 30,
    rollHeading: 0
  });

  const heading = new THREE.Vector3(1, 0, 0).applyQuaternion(q).normalize();
  const expected = new THREE.Vector3(0, Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6));

  assertVectorClose(heading, expected, 'pitched heading');
});

test('decomposeRootRotation round-trips editor angles through quaternion storage', () => {
  const angles = {
    yawZ: 35,
    pitchSide: -12,
    rollHeading: 18
  };
  const q = composeRootRotation(angles);
  const decomposed = decomposeRootRotation(q);
  const recomposed = composeRootRotation(decomposed);

  assertClose(decomposed.yawZ, angles.yawZ, 'yawZ');
  assertClose(decomposed.pitchSide, angles.pitchSide, 'pitchSide');
  assertClose(decomposed.rollHeading, angles.rollHeading, 'rollHeading');
  assertEquivalentQuaternion(recomposed, q, 'round trip');
});

test('normalizeQuaternion keeps direct quaternion edits on unit length', () => {
  const q = normalizeQuaternion({ x: 0.2, y: -0.1, z: 0.3, w: 1 });
  const length = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);

  assertClose(length, 1, 'normalized quaternion length');
});
