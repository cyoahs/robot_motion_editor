#!/usr/bin/env node

import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  computePalmInfoFromLinks,
  DEFAULT_LEFT_PALM_OFFSET,
  DEFAULT_RIGHT_PALM_OFFSET
} from '../src/palmVisualizer.js';

function assertVectorClose(actual, expected, epsilon = 1e-6) {
  assert.ok(actual.distanceTo(expected) < epsilon, `expected ${actual.toArray()} to equal ${expected.toArray()}`);
}

const root = new THREE.Object3D();
const leftWrist = new THREE.Object3D();
const rightWrist = new THREE.Object3D();

leftWrist.position.set(1, 2, 3);
rightWrist.position.set(1, 2.5, 3);
root.add(leftWrist);
root.add(rightWrist);
root.updateMatrixWorld(true);

const info = computePalmInfoFromLinks(leftWrist, rightWrist);

const expectedLeftPalm = leftWrist.position.clone().add(DEFAULT_LEFT_PALM_OFFSET);
const expectedRightPalm = rightWrist.position.clone().add(DEFAULT_RIGHT_PALM_OFFSET);
const expectedCenter = expectedLeftPalm.clone().add(expectedRightPalm).multiplyScalar(0.5);

assertVectorClose(info.leftPalm, expectedLeftPalm);
assertVectorClose(info.rightPalm, expectedRightPalm);
assertVectorClose(info.palmCenter, expectedCenter);
assert.equal(info.distance, expectedLeftPalm.distanceTo(expectedRightPalm));

leftWrist.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
rightWrist.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
root.updateMatrixWorld(true);

const rotatedInfo = computePalmInfoFromLinks(leftWrist, rightWrist);
const expectedRotatedLeft = leftWrist.position.clone().add(DEFAULT_LEFT_PALM_OFFSET.clone().applyQuaternion(leftWrist.quaternion));
const expectedRotatedRight = rightWrist.position.clone().add(DEFAULT_RIGHT_PALM_OFFSET.clone().applyQuaternion(rightWrist.quaternion));

assertVectorClose(rotatedInfo.leftPalm, expectedRotatedLeft);
assertVectorClose(rotatedInfo.rightPalm, expectedRotatedRight);

console.log('Palm visualizer tests passed');
