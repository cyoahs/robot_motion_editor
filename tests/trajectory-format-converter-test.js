#!/usr/bin/env node

import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  SEED_EULER_ORDER,
  TRAJECTORY_FORMATS,
  convertTrajectoryCSV,
  exportTrajectoryCSV,
  parseTrajectoryCSV
} from '../src/trajectoryFormatConverter.js';

function approx(actual, expected, epsilon = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `expected ${actual} to be close to ${expected}`
  );
}

function parseNumbers(line) {
  return line.split(',').map(value => parseFloat(value));
}

function seedRPYQuaternion(rollDegrees, pitchDegrees, yawDegrees) {
  return new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(yawDegrees))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(pitchDegrees)))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(rollDegrees)));
}

const seedCSV = `Frame,root_translateX,root_translateY,root_translateZ,root_rotateX,root_rotateY,root_rotateZ,left_hip_pitch_joint_dof
0,100,200,300,0,0,90,180`;

const parsedSeed = parseTrajectoryCSV(seedCSV, 'sample_seed.csv');
assert.equal(parsedSeed.format, TRAJECTORY_FORMATS.SEED);
assert.equal(parsedSeed.fps, 120);
assert.equal(parsedSeed.baseTrajectory.length, 1);
approx(parsedSeed.baseTrajectory[0].base.position.x, 1);
approx(parsedSeed.baseTrajectory[0].base.position.y, 2);
approx(parsedSeed.baseTrajectory[0].base.position.z, 3);
approx(parsedSeed.baseTrajectory[0].joints[0], Math.PI);

const parsedEuler = new THREE.Euler().setFromQuaternion(
  new THREE.Quaternion(
    parsedSeed.baseTrajectory[0].base.quaternion.x,
    parsedSeed.baseTrajectory[0].base.quaternion.y,
    parsedSeed.baseTrajectory[0].base.quaternion.z,
    parsedSeed.baseTrajectory[0].base.quaternion.w
  ),
  SEED_EULER_ORDER
);
approx(THREE.MathUtils.radToDeg(parsedEuler.z), 90);

const combinedRotationSeedCSV = `Frame,root_translateX,root_translateY,root_translateZ,root_rotateX,root_rotateY,root_rotateZ,joint_dof
0,0,0,0,10,20,30,0`;
const parsedCombinedRotation = parseTrajectoryCSV(combinedRotationSeedCSV, 'combined_seed.csv');
const parsedCombinedQuaternion = new THREE.Quaternion(
  parsedCombinedRotation.baseTrajectory[0].base.quaternion.x,
  parsedCombinedRotation.baseTrajectory[0].base.quaternion.y,
  parsedCombinedRotation.baseTrajectory[0].base.quaternion.z,
  parsedCombinedRotation.baseTrajectory[0].base.quaternion.w
);
approx(parsedCombinedQuaternion.angleTo(seedRPYQuaternion(10, 20, 30)), 0, 1e-10);

const exportedCombinedRotation = exportTrajectoryCSV(parsedCombinedRotation.baseTrajectory, {
  format: TRAJECTORY_FORMATS.SEED,
  seedJointColumns: parsedCombinedRotation.metadata.seedJointColumns
});
const exportedCombinedValues = parseNumbers(exportedCombinedRotation.split('\n')[1]);
approx(exportedCombinedValues[4], 10);
approx(exportedCombinedValues[5], 20);
approx(exportedCombinedValues[6], 30);

const unitreeCSV = exportTrajectoryCSV(parsedSeed.baseTrajectory, { format: TRAJECTORY_FORMATS.UNITREE });
const unitreeValues = parseNumbers(unitreeCSV);
approx(unitreeValues[0], 1);
approx(unitreeValues[1], 2);
approx(unitreeValues[2], 3);
approx(unitreeValues[7], Math.PI);

const convertedSeed = convertTrajectoryCSV(unitreeCSV, TRAJECTORY_FORMATS.SEED).csv;
const convertedLines = convertedSeed.split('\n');
assert.equal(convertedLines[0], 'Frame,root_translateX,root_translateY,root_translateZ,root_rotateX,root_rotateY,root_rotateZ,joint_1_dof');
const convertedSeedValues = parseNumbers(convertedLines[1]);
approx(convertedSeedValues[1], 100);
approx(convertedSeedValues[2], 200);
approx(convertedSeedValues[3], 300);
approx(convertedSeedValues[6], 90);
approx(convertedSeedValues[7], 180);

const seedRoundTrip = exportTrajectoryCSV(parsedSeed.baseTrajectory, {
  format: TRAJECTORY_FORMATS.SEED,
  seedJointColumns: parsedSeed.metadata.seedJointColumns
});
assert.equal(seedRoundTrip.split('\n')[0], seedCSV.split('\n')[0]);

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};
globalThis.window = { location: { search: '' } };
Object.defineProperty(globalThis, 'navigator', {
  value: { languages: ['en'], language: 'en' },
  configurable: true
});
const { TrajectoryManager } = await import('../src/trajectoryManager.js');
const manager = new TrajectoryManager();
manager.parseCSV(`0,0,0,0,0,0,1,0
10,0,0,0,0,0,1,1
20,0,0,0,0,0,1,2`, 'unitree.csv');
const resampledUnitree = manager.exportBaseTrajectory(TRAJECTORY_FORMATS.UNITREE, 100);
const resampledLines = resampledUnitree.split('\n');
assert.equal(resampledLines.length, 6);
approx(parseNumbers(resampledLines[1])[0], 4);
approx(parseNumbers(resampledLines[4])[0], 16);
approx(parseNumbers(resampledLines[5])[0], 20);
approx(parseNumbers(resampledLines[5])[7], 2);

console.log('trajectory format converter tests passed');
