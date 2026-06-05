#!/usr/bin/env node

/**
 * 使用 biped_s70.urdf 验证 URDF↔IK 闭环：
 * - 无 orig 重置时，改 IK 内层角度后写回会导致 FK 失配
 * - syncIkFixedJointOriginsFromUrdf 修复后写回应闭环
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseHTML } from 'linkedom';
import * as THREE from 'three';
import URDFLoader from 'urdf-loader';
import { DOF } from 'closed-chain-ik/src/core/Joint.js';
import { urdfRobotToIKRoot, setIKFromUrdf } from 'closed-chain-ik/src/three/urdfHelpers.js';
import {
  applyAllIkJointsToUrdf,
  measureUrdfIkFkDeltaMm,
  syncIkFixedJointOriginsFromUrdf,
  verifyIkKinematicsLoop
} from '../src/ik/ikKinematicsVerify.js';
import { findIKLinkByName } from '../src/ik/ikSolverUtils.js';
import { inferChainJointNames } from '../src/ik/ikChainRegistry.js';
import { IkSolverService } from '../src/ik/ikSolverService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URDF_PATH = join(
  __dirname,
  '../../GMR/output/pkl/csv/biped_s70/urdf/biped_s70.urdf'
);

const END_LINK = 'leg_l6_link';

/** 与调试日志 #175 接近的左腿姿态 */
const LEG_POSE = {
  leg_l1_joint: -0.32092,
  leg_l2_joint: -0.01593,
  leg_l3_joint: 0.24974,
  leg_l4_joint: 1.32963,
  leg_l5_joint: -0.34409,
  leg_l6_joint: 0.02622
};

/** 模拟 solver 改 leg_l4 后的角度 */
const LEG_POSE_AFTER_SOLVE = {
  ...LEG_POSE,
  leg_l4_joint: 0.82562,
  leg_l1_joint: -0.03549,
  leg_l2_joint: 0.02306,
  leg_l3_joint: 0.15243
};

function installDomPolyfill() {
  const { document, DOMParser } = parseHTML('<!DOCTYPE html><html></html>');
  global.DOMParser = DOMParser;
  global.Document = document.constructor;
  global.Element = document.createElement('div').constructor;
}

function loadBipedRobot() {
  installDomPolyfill();
  const loader = new URDFLoader();
  loader.parseVisual = false;
  loader.parseCollision = false;
  const urdfText = readFileSync(URDF_PATH, 'utf8');
  return loader.parse(urdfText);
}

function applyLegPose(robot, pose) {
  for (const [name, angle] of Object.entries(pose)) {
    robot.setJointValue(name, angle);
  }
  robot.updateMatrixWorld(true);
}

function setIkJointAngle(ikRoot, jointName, angle) {
  ikRoot.traverse((c) => {
    if (c.isJoint && c.name === jointName) {
      c.setDoFValue(DOF.EZ, angle);
    }
  });
  ikRoot.updateMatrixWorld(true);
}

function applyIkLegPose(ikRoot, pose) {
  for (const [name, angle] of Object.entries(pose)) {
    setIkJointAngle(ikRoot, name, angle);
  }
}

function makeMockService(ikRoot, endLink) {
  return {
    ikRoot,
    endEffectorLinkName: endLink,
    captureIkClosureWorldPose() {
      const link = findIKLinkByName(ikRoot, endLink);
      if (!link) return null;
      const position = new THREE.Vector3();
      link.getWorldPosition(position);
      return { position };
    }
  };
}

function distMmFromMeasure(m) {
  return m?.deltaMm ?? Infinity;
}

console.log('ik-fk-loop biped_s70 tests');
console.log('URDF:', URDF_PATH);

const robot = loadBipedRobot();
applyLegPose(robot, LEG_POSE);

const chainJointNames = inferChainJointNames(robot, END_LINK);
assert.ok(chainJointNames.length >= 6, `expected leg chain, got ${chainJointNames.join(', ')}`);

const ikRoot = urdfRobotToIKRoot(robot, false);
assert.ok(ikRoot, 'ikRoot built');

const mockService = makeMockService(ikRoot, END_LINK);

// 旧行为：build 后直接 setIKFromUrdf，同姿态下 FK 应对齐
setIKFromUrdf(ikRoot, robot);
ikRoot.updateMatrixWorld(true);
const syncAtBuild = measureUrdfIkFkDeltaMm(robot, mockService, END_LINK);
console.log(`  同步(无 orig 重置) URDF↔IK: ${syncAtBuild.deltaMm?.toFixed(3)} mm`);
assert.ok(distMmFromMeasure(syncAtBuild) < 0.5, 'sync at build angles should match');

// 旧行为：只改 IK 内层角度并写回 → FK 失配（复现 #175 类问题）
applyIkLegPose(ikRoot, LEG_POSE_AFTER_SOLVE);
applyAllIkJointsToUrdf(robot, ikRoot);
const broken = measureUrdfIkFkDeltaMm(robot, mockService, END_LINK);
console.log(`  写回(无 orig 重置) URDF↔IK: ${broken.deltaMm?.toFixed(3)} mm`);
assert.ok(
  distMmFromMeasure(broken) > 10,
  `expected FK mismatch without origin reset, got ${broken.deltaMm?.toFixed(3)}mm`
);

// 修复后：重置 URDF 姿态 → sync with orig reset → 改 IK → 写回 → 闭环
applyLegPose(robot, LEG_POSE);
setIKFromUrdf(ikRoot, robot);
syncIkFixedJointOriginsFromUrdf(robot, ikRoot);
setIKFromUrdf(ikRoot, robot);
applyIkLegPose(ikRoot, LEG_POSE_AFTER_SOLVE);
applyAllIkJointsToUrdf(robot, ikRoot);
const fixed = measureUrdfIkFkDeltaMm(robot, mockService, END_LINK);
console.log(`  写回(有 orig 重置) URDF↔IK: ${fixed.deltaMm?.toFixed(3)} mm`);
assert.ok(
  distMmFromMeasure(fixed) < 0.5,
  `expected FK loop after origin reset, got ${fixed.deltaMm?.toFixed(3)}mm`
);

// 通过 IkSolverService 完整闭环验证
applyLegPose(robot, LEG_POSE);
const ikService = new IkSolverService();
const ok = ikService.rebuild(robot, END_LINK, chainJointNames);
assert.ok(ok, 'IkSolverService.rebuild failed');

const loopReport = verifyIkKinematicsLoop(robot, ikService);
console.log(`  verifyIkKinematicsLoop A sync: ${loopReport.syncDeltaMm?.toFixed(3)} mm`);
console.log(`  verifyIkKinematicsLoop B writeback: ${loopReport.writebackDeltaMm?.toFixed(3)} mm`);
assert.ok(loopReport.syncDeltaMm < 0.5, 'verify A failed');
assert.ok(loopReport.writebackDeltaMm < 0.5, 'verify B failed');

console.log('✅ ik-fk-loop-biped-s70-test passed');
