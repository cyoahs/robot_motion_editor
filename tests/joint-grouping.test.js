#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  getJointGroupKey,
  groupJointsBySide,
  JOINT_GROUPS
} from '../src/jointGrouping.js';

assert.equal(getJointGroupKey('left_shoulder_pitch_joint'), 'left');
assert.equal(getJointGroupKey('L_hip_yaw'), 'left');
assert.equal(getJointGroupKey('right_elbow_joint'), 'right');
assert.equal(getJointGroupKey('r_knee_joint'), 'right');
assert.equal(getJointGroupKey('waist_yaw_joint'), 'center');
assert.equal(getJointGroupKey('head_pitch_joint'), 'center');

const grouped = groupJointsBySide([
  { name: 'left_shoulder_pitch_joint' },
  { name: 'waist_yaw_joint' },
  { name: 'right_elbow_joint' },
  { name: 'head_pitch_joint' }
]);

assert.deepEqual(Object.keys(grouped), JOINT_GROUPS.map((group) => group.key));
assert.deepEqual(grouped.center.map((item) => item.index), [1, 3]);
assert.deepEqual(grouped.left.map((item) => item.index), [0]);
assert.deepEqual(grouped.right.map((item) => item.index), [2]);
assert.deepEqual(JOINT_GROUPS.map((group) => group.fallbackLabel), ['Center', 'Left', 'Right']);

console.log('Joint grouping tests passed');
