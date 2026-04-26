import * as THREE from 'three';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const LOCAL_X = new THREE.Vector3(1, 0, 0);

function toQuaternion(quaternionLike) {
  return new THREE.Quaternion(
    quaternionLike.x || 0,
    quaternionLike.y || 0,
    quaternionLike.z || 0,
    quaternionLike.w ?? 1
  ).normalize();
}

function toPlainQuaternion(quaternion) {
  return {
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
    w: quaternion.w
  };
}

export function normalizeQuaternion(quaternionLike) {
  const quaternion = new THREE.Quaternion(
    quaternionLike.x || 0,
    quaternionLike.y || 0,
    quaternionLike.z || 0,
    quaternionLike.w ?? 1
  );

  if (quaternion.lengthSq() < 1e-12) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }

  return toPlainQuaternion(quaternion.normalize());
}

export function composeRootRotation({ yawZ = 0, pitchSide = 0, rollHeading = 0 }) {
  const euler = new THREE.Euler(
    rollHeading * DEG_TO_RAD,
    pitchSide * DEG_TO_RAD,
    yawZ * DEG_TO_RAD,
    'ZYX'
  );

  return toPlainQuaternion(new THREE.Quaternion().setFromEuler(euler).normalize());
}

export function decomposeRootRotation(quaternionLike) {
  const euler = new THREE.Euler().setFromQuaternion(toQuaternion(quaternionLike), 'ZYX');

  return {
    yawZ: euler.z * RAD_TO_DEG,
    pitchSide: euler.y * RAD_TO_DEG,
    rollHeading: euler.x * RAD_TO_DEG
  };
}

export function getRootHeadingFromQuaternion(quaternionLike) {
  const heading = LOCAL_X.clone().applyQuaternion(toQuaternion(quaternionLike));
  heading.z = 0;

  if (heading.lengthSq() < 1e-12) {
    return new THREE.Vector3(1, 0, 0);
  }

  return heading.normalize();
}
