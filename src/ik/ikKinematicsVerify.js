import * as THREE from 'three';
import { DOF } from 'closed-chain-ik/src/core/Joint.js';
import { findIKLinkByName } from './ikSolverUtils.js';
import { getUrdfLinkObject } from './ikChainRegistry.js';

/**
 * urdfRobotToIKRoot 会把 URDF 关节当前旋转写进 IK 外层固定变换，
 * setIKFromUrdf 又会把同一角度写入内层 DoF，导致角度被重复计入。
 * 每次同步前把外层重置为 origPosition/origQuaternion（不含关节角）。
 */
export function syncIkFixedJointOriginsFromUrdf(robot, ikRoot) {
  if (!robot || !ikRoot) return;

  ikRoot.traverse((c) => {
    if (!c.isJoint || !c.name || c.name === '__world_joint__') return;

    const urdfJoint = robot.joints?.[c.name];
    if (!urdfJoint?.isURDFJoint) return;
    if (urdfJoint.jointType !== 'revolute'
      && urdfJoint.jointType !== 'continuous'
      && urdfJoint.jointType !== 'prismatic') {
      return;
    }

    if (!urdfJoint.origPosition || !urdfJoint.origQuaternion) {
      const angle = urdfJoint.angle ?? 0;
      urdfJoint.setJointValue(angle);
    }
    if (!urdfJoint.origPosition || !urdfJoint.origQuaternion) return;

    const linkParent = c.parent;
    const outer = linkParent?.parent;
    if (!outer?.isJoint || outer.name) return;

    const op = urdfJoint.origPosition;
    const oq = urdfJoint.origQuaternion;
    outer.setPosition(op.x, op.y, op.z);
    outer.setQuaternion(oq.x, oq.y, oq.z, oq.w);
    outer.setMatrixNeedsUpdate();
  });

  ikRoot.updateMatrixWorld(true);
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();

function distMm(a, b) {
  if (!a || !b) return null;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) * 1000;
}

function readUrdfEePose(robot, linkName) {
  const link = getUrdfLinkObject(robot, linkName);
  if (!link) return null;
  link.getWorldPosition(_p);
  link.getWorldQuaternion(_q);
  return {
    position: { x: _p.x, y: _p.y, z: _p.z },
    quaternion: { x: _q.x, y: _q.y, z: _q.z, w: _q.w }
  };
}

function readIkClosurePose(ikService) {
  return ikService.captureIkClosureWorldPose?.() ?? null;
}

/** 将 IK 树全部具名关节写回 URDF（不改 robot 根位姿） */
export function applyAllIkJointsToUrdf(robot, ikRoot) {
  if (!robot || !ikRoot) return;
  ikRoot.updateMatrixWorld(true);
  ikRoot.traverse((c) => {
    if (!c.isJoint || !c.name || c.name === '__world_joint__') return;
    const urdfJoint = robot.joints[c.name];
    if (!urdfJoint) return;
    if (urdfJoint.jointType === 'prismatic') {
      urdfJoint.setJointValue(c.getDoFValue(DOF.Z));
    } else {
      urdfJoint.setJointValue(c.getDoFValue(DOF.EZ));
    }
  });
  robot.updateMatrixWorld(true);
}

/** 测量 URDF 末端 vs IK closure link 世界坐标偏差 */
export function measureUrdfIkFkDeltaMm(robot, ikService, linkName) {
  const urdf = readUrdfEePose(robot, linkName || ikService.endEffectorLinkName);
  const ik = readIkClosurePose(ikService);
  return {
    urdf,
    ik,
    deltaMm: distMm(urdf?.position, ik?.position)
  };
}

/** 逐关节对比 IK DoF 与 URDF angle（弧度） */
export function compareChainJointAngles(robot, ikRoot, chainJointNames) {
  const rows = [];
  let maxDeltaRad = 0;
  for (const name of chainJointNames || []) {
    let ikVal = null;
    ikRoot?.traverse((c) => {
      if (c.isJoint && c.name === name) ikVal = c.getDoFValue(DOF.EZ);
    });
    const urdfVal = robot.joints[name]?.angle ?? null;
    let delta = null;
    if (Number.isFinite(ikVal) && Number.isFinite(urdfVal)) {
      delta = urdfVal - ikVal;
      maxDeltaRad = Math.max(maxDeltaRad, Math.abs(delta));
    }
    rows.push({
      joint: name,
      ik_rad: ikVal != null ? ikVal.toFixed(6) : '-',
      urdf_rad: urdfVal != null ? urdfVal.toFixed(6) : '-',
      delta_rad: delta != null ? delta.toFixed(6) : '-'
    });
  }
  return { rows, maxDeltaRad };
}

/**
 * 闭环验证（不调用 solver）
 * A: URDF→IK 同步后 FK 是否一致
 * B: URDF→IK→写回关节→URDF FK 是否一致
 */
export function verifyIkKinematicsLoop(robot, ikService) {
  if (!robot || !ikService?.ikRoot) {
    return { ok: false, error: 'IK 未初始化' };
  }

  const linkName = ikService.endEffectorLinkName;
  const chainJointNames = ikService.chainJointNames || [];

  ikService._syncRobotToIk(robot);
  const afterSync = measureUrdfIkFkDeltaMm(robot, ikService, linkName);

  applyAllIkJointsToUrdf(robot, ikService.ikRoot);
  const afterWriteback = measureUrdfIkFkDeltaMm(robot, ikService, linkName);
  const jointCmp = compareChainJointAngles(robot, ikService.ikRoot, chainJointNames);

  const ikLink = findIKLinkByName(ikService.ikRoot, linkName);
  const urdfLink = getUrdfLinkObject(robot, linkName);
  const sameLinkRef = ikLink && urdfLink && ikLink.name === (urdfLink.urdfName || urdfLink.name);

  const syncOk = (afterSync.deltaMm ?? Infinity) < 0.5;
  const writebackOk = (afterWriteback.deltaMm ?? Infinity) < 0.5;
  const jointsOk = jointCmp.maxDeltaRad < 1e-5;

  const report = {
    ok: syncOk && writebackOk && jointsOk,
    linkName,
    sameLinkRef,
    syncDeltaMm: afterSync.deltaMm,
    writebackDeltaMm: afterWriteback.deltaMm,
    maxJointDeltaRad: jointCmp.maxDeltaRad,
    chainJointNames,
    jointRows: jointCmp.rows
  };

  return report;
}

export function logIkKinematicsVerify(report, tag = '[IK 闭环]') {
  if (!report) return;
  console.groupCollapsed(
    `${tag} ${report.ok ? '✅ 通过' : '❌ 未闭环'} · sync ${report.syncDeltaMm?.toFixed(3) ?? '-'}mm · writeback ${report.writebackDeltaMm?.toFixed(3) ?? '-'}mm`
  );
  console.log(`${tag} 末端 link: ${report.linkName} · IK/URDF 同名: ${report.sameLinkRef}`);
  console.log(`${tag} A 同步后 URDF↔IK: ${report.syncDeltaMm?.toFixed(3) ?? '-'} mm`);
  console.log(`${tag} B 写回后 URDF↔IK: ${report.writebackDeltaMm?.toFixed(3) ?? '-'} mm`);
  console.log(`${tag} 链关节 IK↔URDF 最大差: ${(report.maxJointDeltaRad * 1000).toFixed(3)} mrad`);
  if (report.jointRows?.length) console.table(report.jointRows);
  console.groupEnd();
  return report;
}

export function installIkKinematicsVerifyGlobals(ikServiceGetter) {
  if (typeof window === 'undefined') return;
  window.verifyIkKinematicsLoop = () => {
    const editor = window.motionEditor;
    const robot = editor?.robotRight;
    const ikService = typeof ikServiceGetter === 'function' ? ikServiceGetter() : editor?.endEffectorControls?.ikService;
    if (!robot || !ikService) {
      console.warn('[IK 闭环] 请先加载 URDF 并启用 IK');
      return null;
    }
    const report = verifyIkKinematicsLoop(robot, ikService);
    logIkKinematicsVerify(report);
    return report;
  };
}
