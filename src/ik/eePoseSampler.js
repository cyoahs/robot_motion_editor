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
