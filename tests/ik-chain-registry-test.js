#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  inferChainJointNames,
  guessDefaultEndLink,
  listUrdfLinks
} from '../src/ik/ikChainRegistry.js';

function mockRobot(links, jointsTree) {
  const linksMap = {};
  for (const [name, parentName] of Object.entries(links)) {
    const link = { isURDFLink: true, name, parent: null };
    linksMap[name] = link;
  }
  for (const [name, parentName] of Object.entries(links)) {
    if (parentName) {
      linksMap[name].parent = linksMap[parentName] || jointsTree[parentName];
    }
  }
  const joints = {};
  for (const [jname, cfg] of Object.entries(jointsTree)) {
    joints[jname] = {
      isURDFJoint: true,
      name: jname,
      jointType: cfg.type || 'revolute',
      parent: linksMap[cfg.parentLink],
      angle: 0
    };
    if (cfg.childLink && linksMap[cfg.childLink]) {
      linksMap[cfg.childLink].parent = joints[jname];
    }
  }
  return { links: linksMap, joints };
}

console.log('ik-chain-registry tests');

const robot = mockRobot(
  {
    pelvis: null,
    left_hip: 'pelvis',
    left_knee_link: 'left_hip',
    left_ankle_link: 'left_knee_link'
  },
  {
    left_hip_joint: { parentLink: 'pelvis', childLink: 'left_hip', type: 'revolute' },
    left_knee_joint: { parentLink: 'left_hip', childLink: 'left_knee_link', type: 'revolute' },
    left_ankle_joint: { parentLink: 'left_knee_link', childLink: 'left_ankle_link', type: 'revolute' }
  }
);

const linkNames = listUrdfLinks(robot);
assert.ok(linkNames.includes('left_ankle_link'));

const chain = inferChainJointNames(robot, 'left_ankle_link');
assert.ok(chain.includes('left_ankle_joint'));
assert.ok(chain.includes('left_knee_joint'));
assert.equal(chain.includes('left_hip_joint'), true);

const guess = guessDefaultEndLink({
  links: {
    right_wrist_yaw_link: {},
    left_ankle_roll_link: {}
  }
});
assert.ok(guess.length > 0);

console.log('✅ ik-chain-registry-test passed');
