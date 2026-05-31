import * as THREE from 'three';
import { getUrdfLinkObject } from './ikChainRegistry.js';

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'ZYX');

export function captureRobotState(robot, jointController) {
  if (!robot) return null;
  const jointNames = jointController?.joints?.map((j) => j.name) || [];
  return {
    position: robot.position.clone(),
    quaternion: robot.quaternion.clone(),
    joints: jointNames.map((name) => robot.joints[name]?.angle ?? 0),
    jointNames
  };
}

export function restoreRobotState(robot, snapshot) {
  if (!robot || !snapshot) return;
  robot.position.copy(snapshot.position);
  robot.quaternion.copy(snapshot.quaternion);
  snapshot.jointNames.forEach((name, i) => {
    if (robot.joints[name]) {
      robot.setJointValue(name, snapshot.joints[i]);
    }
  });
  robot.updateMatrixWorld(true);
}

/**
 * 将轨迹某一帧的状态应用到机器人（用于 FK 采样，不写 UI）
 * @param {boolean} edited true=含关键帧残差的 combined，false=仅 base
 */
export function applyFrameStateToRobot(editor, robot, frameIndex, edited = true) {
  const tm = editor.trajectoryManager;
  if (!tm?.hasTrajectory() || !robot) return false;

  const state = edited ? tm.getCombinedState(frameIndex) : tm.getBaseState(frameIndex);
  if (!state?.joints) return false;

  robot.position.set(
    state.base.position.x,
    state.base.position.y,
    state.base.position.z
  );
  robot.quaternion.set(
    state.base.quaternion.x,
    state.base.quaternion.y,
    state.base.quaternion.z,
    state.base.quaternion.w
  );

  const joints = editor.jointController?.joints || [];
  state.joints.forEach((value, index) => {
    const name = joints[index]?.name;
    if (name) robot.setJointValue(name, value);
  });
  robot.updateMatrixWorld(true);
  return true;
}

/** 世界系末端位姿：位置 m + 欧拉角 rad (ZYX) */
const _ghostBasePos = new THREE.Vector3();
const _ghostBaseQuat = new THREE.Quaternion();
const _editedBasePos = new THREE.Vector3();
const _editedBaseQuat = new THREE.Quaternion();
const _eeLocalPos = new THREE.Vector3();
const _eeLocalQuat = new THREE.Quaternion();
const _invGhostBaseQuat = new THREE.Quaternion();
const _targetQuat = new THREE.Quaternion();

/**
 * Ghost 末端位姿变换到编辑机器人当前 base 下的世界系目标（位置 m + 四元数）
 */
export function computeReferenceEeWorldPose(editor, linkName) {
  const ghost = editor.robotLeft;
  const edited = editor.robotRight;
  if (!ghost || !edited || !linkName) return null;

  const ref = sampleEndEffectorPose(ghost, linkName);
  if (!ref) return null;

  ghost.getWorldPosition(_ghostBasePos);
  ghost.getWorldQuaternion(_ghostBaseQuat);
  edited.getWorldPosition(_editedBasePos);
  edited.getWorldQuaternion(_editedBaseQuat);

  _pos.set(ref.px, ref.py, ref.pz);
  _euler.set(ref.rx, ref.ry, ref.rz);
  _quat.setFromEuler(_euler);

  _invGhostBaseQuat.copy(_ghostBaseQuat).invert();
  _eeLocalPos.copy(_pos).sub(_ghostBasePos).applyQuaternion(_invGhostBaseQuat);
  _eeLocalQuat.copy(_invGhostBaseQuat).multiply(_quat);

  _targetQuat.copy(_editedBaseQuat).multiply(_eeLocalQuat);
  _pos.copy(_eeLocalPos).applyQuaternion(_editedBaseQuat).add(_editedBasePos);

  return {
    px: _pos.x,
    py: _pos.y,
    pz: _pos.z,
    qx: _targetQuat.x,
    qy: _targetQuat.y,
    qz: _targetQuat.z,
    qw: _targetQuat.w
  };
}

export function sampleEndEffectorPose(robot, linkName) {
  const link = getUrdfLinkObject(robot, linkName);
  if (!link) return null;

  link.getWorldPosition(_pos);
  link.getWorldQuaternion(_quat);
  _euler.setFromQuaternion(_quat);

  return {
    px: _pos.x,
    py: _pos.y,
    pz: _pos.z,
    rx: _euler.x,
    ry: _euler.y,
    rz: _euler.z
  };
}

export const EE_POSE_COMPONENTS = [
  { key: 'px', label: 'X', group: 'pos' },
  { key: 'py', label: 'Y', group: 'pos' },
  { key: 'pz', label: 'Z', group: 'pos' },
  { key: 'rx', label: 'RX', group: 'rot' },
  { key: 'ry', label: 'RY', group: 'rot' },
  { key: 'rz', label: 'RZ', group: 'rot' }
];

export function eeCurveKeyPrefix(linkName) {
  return `ee_${linkName.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}
