import * as THREE from 'three';

export const DEFAULT_LEFT_PALM_OFFSET = new THREE.Vector3(0.1115, 0.0030, 0.0);
export const DEFAULT_RIGHT_PALM_OFFSET = new THREE.Vector3(0.1115, -0.0030, 0.0);
const LEFT_WRIST_LINK_NAME = 'left_wrist_yaw_link';
const RIGHT_WRIST_LINK_NAME = 'right_wrist_yaw_link';

function findObjectByName(root, name) {
  if (!root) return null;

  const direct = root.getObjectByName(name);
  if (direct) return direct;

  let found = null;
  root.traverse((child) => {
    if (found) return;
    if (child.name === name || child.urdfName === name) {
      found = child;
    }
  });
  return found;
}

function computePalmPosition(link, offset) {
  const worldPosition = new THREE.Vector3();
  const worldQuaternion = new THREE.Quaternion();

  link.updateWorldMatrix(true, false);
  link.getWorldPosition(worldPosition);
  link.getWorldQuaternion(worldQuaternion);

  return worldPosition.add(offset.clone().applyQuaternion(worldQuaternion));
}

export function computePalmInfoFromLinks(
  leftWristLink,
  rightWristLink,
  leftOffset = DEFAULT_LEFT_PALM_OFFSET,
  rightOffset = DEFAULT_RIGHT_PALM_OFFSET
) {
  if (!leftWristLink || !rightWristLink) {
    return null;
  }

  const leftPalm = computePalmPosition(leftWristLink, leftOffset);
  const rightPalm = computePalmPosition(rightWristLink, rightOffset);
  const palmCenter = leftPalm.clone().add(rightPalm).multiplyScalar(0.5);
  const distance = leftPalm.distanceTo(rightPalm);

  return { leftPalm, rightPalm, palmCenter, distance };
}

export function computePalmInfo(robot) {
  const leftWristLink = findObjectByName(robot, LEFT_WRIST_LINK_NAME);
  const rightWristLink = findObjectByName(robot, RIGHT_WRIST_LINK_NAME);

  return computePalmInfoFromLinks(leftWristLink, rightWristLink);
}

export class PalmVisualizer {
  constructor(scene, labelElement = null) {
    this.scene = scene;
    this.labelElement = labelElement;
    this.palmSphere = null;
    this.leftPalmMarker = null;
    this.rightPalmMarker = null;
    this.connectionLine = null;
    this.lastInfo = null;
    this.createVisualization();
  }

  createVisualization() {
    const sphereGeometry = new THREE.SphereGeometry(0.1, 32, 16);
    const sphereMaterial = new THREE.MeshBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.22,
      depthWrite: false
    });
    this.palmSphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    this.scene.add(this.palmSphere);

    const markerGeometry = new THREE.SphereGeometry(0.025, 16, 12);
    const leftMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    const rightMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xffd166 });
    this.leftPalmMarker = new THREE.Mesh(markerGeometry, leftMarkerMaterial);
    this.rightPalmMarker = new THREE.Mesh(markerGeometry.clone(), rightMarkerMaterial);
    this.scene.add(this.leftPalmMarker);
    this.scene.add(this.rightPalmMarker);

    const lineGeometry = new THREE.BufferGeometry();
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.75
    });
    this.connectionLine = new THREE.Line(lineGeometry, lineMaterial);
    this.scene.add(this.connectionLine);

    this.hide();
  }

  update(robot) {
    const info = computePalmInfo(robot);
    this.lastInfo = info;

    if (!info) {
      this.hide();
      return null;
    }

    this.palmSphere.position.copy(info.palmCenter);
    this.leftPalmMarker.position.copy(info.leftPalm);
    this.rightPalmMarker.position.copy(info.rightPalm);

    const positions = new Float32Array([
      info.leftPalm.x, info.leftPalm.y, info.leftPalm.z,
      info.rightPalm.x, info.rightPalm.y, info.rightPalm.z
    ]);
    this.connectionLine.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.connectionLine.geometry.computeBoundingSphere();

    this.show();
    this.updateLabel(info.distance);
    return info;
  }

  updateLabel(distance) {
    if (!this.labelElement) return;
    this.labelElement.textContent = Number.isFinite(distance) ? `${distance.toFixed(3)} m` : '--';
  }

  show() {
    this.palmSphere.visible = true;
    this.leftPalmMarker.visible = true;
    this.rightPalmMarker.visible = true;
    this.connectionLine.visible = true;
    if (this.labelElement) {
      this.labelElement.textContent = this.lastInfo ? `${this.lastInfo.distance.toFixed(3)} m` : '--';
    }
  }

  hide() {
    this.palmSphere.visible = false;
    this.leftPalmMarker.visible = false;
    this.rightPalmMarker.visible = false;
    this.connectionLine.visible = false;
    if (this.labelElement) {
      this.labelElement.textContent = '--';
    }
  }

  setVisible(visible) {
    if (visible) {
      this.show();
    } else {
      this.hide();
    }
  }

  dispose() {
    this.scene.remove(this.palmSphere);
    this.scene.remove(this.leftPalmMarker);
    this.scene.remove(this.rightPalmMarker);
    this.scene.remove(this.connectionLine);

    this.palmSphere.geometry.dispose();
    this.palmSphere.material.dispose();
    this.leftPalmMarker.geometry.dispose();
    this.leftPalmMarker.material.dispose();
    this.rightPalmMarker.geometry.dispose();
    this.rightPalmMarker.material.dispose();
    this.connectionLine.geometry.dispose();
    this.connectionLine.material.dispose();
  }
}
