import * as THREE from 'three';
import { computeReferenceEeWorldPose } from './eePoseSampler.js';
import { getUrdfLinkObject } from './ikChainRegistry.js';

const _euler = new THREE.Euler(0, 0, 0, 'ZYX');
const _q = new THREE.Quaternion();

function makeSphere(color, radius, opacity = 0.92) {
  const geo = new THREE.SphereGeometry(radius, 12, 12);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthTest: true,
    depthWrite: opacity >= 1
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 20;
  return mesh;
}

function formatVec3(v) {
  return `(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
}

function formatQuatEuler(q) {
  _euler.setFromQuaternion(q);
  const d = (r) => (r * 180 / Math.PI).toFixed(1);
  return `RPY° ${d(_euler.x)}, ${d(_euler.y)}, ${d(_euler.z)}`;
}

/**
 * 可视化 IK 求解目标、内部参考值与 FK 正解末端位姿
 */
export class IkDebugVisualizer {
  constructor(editor) {
    this.editor = editor;
    this.visible = true;
    this.group = new THREE.Group();
    this.group.name = 'ik-debug';

    this.target = this._makePoseNode(0xffcc00, 0.02, 0.1);
    this.target.label = 'target';
    this.fk = this._makePoseNode(0x89d185, 0.02, 0.1);
    this.fk.label = 'fk';
    this.refPos = this._makePoseNode(0x4fc1ff, 0.014, 0.07);
    this.refPos.label = 'refPos';
    this.refOrient = this._makePoseNode(0x569cd6, 0.012, 0.06);
    this.refOrient.label = 'refOrient';
    this.lockPos = this._makePoseNode(0xff6b6b, 0.012, 0.05);
    this.lockPos.label = 'lockPos';
    this.ghostRef = this._makePoseNode(0x6a9955, 0.015, 0.08, 0.55);
    this.ghostRef.label = 'ghostRef';

    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3()
    ]);
    this.errorLine = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0xc586c0, linewidth: 2, depthTest: true })
    );
    this.errorLine.renderOrder = 21;
    this.group.add(this.errorLine);

    this.group.add(
      this.target.root,
      this.fk.root,
      this.refPos.root,
      this.refOrient.root,
      this.lockPos.root,
      this.ghostRef.root
    );

    this._readoutEl = document.getElementById('ik-debug-readout');
  }

  _makePoseNode(color, radius, axisLen, opacity = 0.92) {
    const root = new THREE.Group();
    const sphere = makeSphere(color, radius, opacity);
    const axes = new THREE.AxesHelper(axisLen);
    axes.renderOrder = 22;
    root.add(sphere, axes);
    return { root, sphere, axes };
  }

  setVisible(on) {
    this.visible = !!on;
    this.group.visible = this.visible;
    if (this._readoutEl) {
      this._readoutEl.style.display = this.visible ? 'block' : 'none';
    }
    if (!this.visible) {
      this._hideAllNodes();
      this.errorLine.visible = false;
    }
  }

  reattach(scene) {
    if (!scene) return;
    if (this.group.parent !== scene) {
      this.group.parent?.remove(this.group);
      scene.add(this.group);
    }
  }

  _hideAllNodes() {
    for (const n of [
      this.target,
      this.fk,
      this.refPos,
      this.refOrient,
      this.lockPos,
      this.ghostRef
    ]) {
      n.root.visible = false;
    }
  }

  _placeNode(node, position, quaternion, showAxes = true) {
    if (!position) {
      node.root.visible = false;
      return;
    }
    node.root.visible = true;
    node.root.position.copy(position);
    if (quaternion) {
      node.root.quaternion.copy(quaternion);
    } else {
      node.root.quaternion.identity();
    }
    node.axes.visible = showAxes;
  }

  /**
   * @param {object|null} state
   */
  update(state) {
    if (!this.visible || !state?.enabled) {
      this._hideAllNodes();
      this.errorLine.visible = false;
      if (this._readoutEl && !this.visible) this._readoutEl.textContent = '';
      return;
    }

    const {
      goalMode,
      solveMode,
      targetPosition,
      targetQuaternion,
      refPosition,
      refQuaternion,
      orientationLockPosition,
      fkPosition,
      fkQuaternion,
      posErrorM,
      rotErrorRad,
      showLockPosition,
      showRefOrient
    } = state;

    this._placeNode(this.target, targetPosition, targetQuaternion, true);
    this._placeNode(this.fk, fkPosition, fkQuaternion, true);
    this._placeNode(this.refPos, refPosition, null, false);

    if (showRefOrient && refPosition && refQuaternion) {
      this._placeNode(this.refOrient, refPosition, refQuaternion, true);
    } else {
      this.refOrient.root.visible = false;
    }

    if (showLockPosition && orientationLockPosition) {
      this._placeNode(this.lockPos, orientationLockPosition, null, false);
    } else {
      this.lockPos.root.visible = false;
    }

    if (state.ghostRefPosition && state.ghostRefQuaternion) {
      this._placeNode(this.ghostRef, state.ghostRefPosition, state.ghostRefQuaternion, true);
    } else {
      this.ghostRef.root.visible = false;
    }

    if (fkPosition && targetPosition) {
      const dist = fkPosition.distanceTo(targetPosition);
      this.errorLine.visible = dist > 1e-4;
      const arr = this.errorLine.geometry.attributes.position;
      arr.setXYZ(0, fkPosition.x, fkPosition.y, fkPosition.z);
      arr.setXYZ(1, targetPosition.x, targetPosition.y, targetPosition.z);
      arr.needsUpdate = true;
      this.errorLine.geometry.computeBoundingSphere();
    } else {
      this.errorLine.visible = false;
    }

    if (this._readoutEl) {
      const lines = [
        `<div style="margin-top:6px;color:var(--text-tertiary)">${state.linkName || ''} · ${goalMode} · 求解 ${solveMode || '-'}</div>`,
        `<div><span style="color:#ffcc00">■</span> IK目标位 ${formatVec3(targetPosition)}</div>`,
        `<div style="padding-left:10px;color:var(--text-secondary)">${formatQuatEuler(targetQuaternion)}</div>`,
        `<div><span style="color:#4fc1ff">■</span> 参考位置 _ref ${formatVec3(refPosition)}</div>`,
        `<div><span style="color:#569cd6">■</span> 参考姿态 _ref ${formatQuatEuler(refQuaternion)}</div>`
      ];
      if (showLockPosition) {
        lines.push(`<div><span style="color:#ff6b6b">■</span> 姿态锁定位置 ${formatVec3(orientationLockPosition)}</div>`);
      }
      if (state.ghostRefPosition) {
        lines.push(`<div><span style="color:#6a9955">■</span> Ghost参考 ${formatVec3(state.ghostRefPosition)}</div>`);
        lines.push(`<div style="padding-left:10px;color:var(--text-secondary)">${formatQuatEuler(state.ghostRefQuaternion)}</div>`);
      }
      lines.push(`<div><span style="color:#89d185">■</span> FK正解 ${formatVec3(fkPosition)}</div>`);
      lines.push(`<div style="padding-left:10px;color:var(--text-secondary)">${formatQuatEuler(fkQuaternion)}</div>`);
      const pe = posErrorM != null ? `${(posErrorM * 1000).toFixed(2)} mm` : '-';
      const re = rotErrorRad != null ? `${(rotErrorRad * 180 / Math.PI).toFixed(2)}°` : '-';
      lines.push(`<div style="margin-top:4px">Δ 位置 ${pe} · Δ 姿态 ${re}</div>`);
      if (state.activeWeights) {
        const aw = state.activeWeights;
        lines.push(
          `<div style="margin-top:6px;padding-top:4px;border-top:1px dashed var(--border-primary)">`,
          `<div style="color:var(--accent-info)">生效权重 [${aw.label}]</div>`,
          `<div>T=${aw.translationFactor} · R=${aw.rotationFactor} · iter=${aw.maxIterations}${aw.solvePasses != null ? ` · passes=${aw.solvePasses}` : ''}</div>`,
          `</div>`
        );
      }
      this._readoutEl.innerHTML = lines.join('');
      this._readoutEl.style.display = 'block';
    }
  }

  /** 从 EndEffectorControls 收集当前帧调试状态 */
  static buildState(controls, solveMode, solveResult = null) {
    if (!controls?.enabled || !controls.endEffectorLinkName) return null;

    const editor = controls.editor;
    const robot = editor.robotRight;
    const linkName = controls.endEffectorLinkName;
    const link = getUrdfLinkObject(robot, linkName);

    const fkPosition = new THREE.Vector3();
    const fkQuaternion = new THREE.Quaternion();
    if (link) {
      link.getWorldPosition(fkPosition);
      link.getWorldQuaternion(fkQuaternion);
    }

    const refPosition = controls._refPosition.clone();
    const refQuaternion = controls._refQuaternion.clone();
    const orientationLockPosition = controls._orientationLockPosition.clone();

    let targetPosition;
    let targetQuaternion;
    const mode = solveMode || controls._getDragSolveMode?.() || controls.goalMode;

    if (mode === 'position') {
      const dragging = controls.controlsTranslate?.dragging || controls.controlsRotate?.dragging;
      if (dragging && controls._buildPositionTarget) {
        targetPosition = controls._buildPositionTarget().clone();
      } else {
        targetPosition = controls._proxy.position.clone();
      }
      targetQuaternion = refQuaternion.clone();
    } else {
      targetPosition = orientationLockPosition.clone();
      targetQuaternion = controls._lastIkTargetQuaternion?.clone?.() || controls._proxy.quaternion.clone();
    }

    let ghostRefPosition = null;
    let ghostRefQuaternion = null;
    const ghostPose = computeReferenceEeWorldPose(editor, linkName);
    if (ghostPose) {
      ghostRefPosition = new THREE.Vector3(ghostPose.px, ghostPose.py, ghostPose.pz);
      _q.set(ghostPose.qx, ghostPose.qy, ghostPose.qz, ghostPose.qw);
      ghostRefQuaternion = _q.clone();
    }

    let posErrorM = null;
    let rotErrorRad = null;
    if (solveResult?.error) {
      posErrorM = solveResult.error.position;
      rotErrorRad = solveResult.error.rotation;
    } else if (link) {
      posErrorM = fkPosition.distanceTo(targetPosition);
      _q.copy(refQuaternion).invert().multiply(fkQuaternion);
      rotErrorRad = 2 * Math.acos(Math.min(1, Math.abs(_q.w)));
    }

    const panel = editor.ikPanel;
    const weightKey = mode === 'orientation' ? 'orientation' : 'position';
    const w = panel?.getSolveOptions?.(weightKey);
    const weightLabels = {
      position: '位置编辑',
      orientation: '姿态编辑'
    };

    return {
      enabled: true,
      linkName,
      goalMode: controls.goalMode,
      solveMode: mode,
      activeWeights: w
        ? {
            label: weightLabels[weightKey],
            ...w
          }
        : null,
      targetPosition,
      targetQuaternion,
      refPosition,
      refQuaternion,
      orientationLockPosition,
      fkPosition,
      fkQuaternion,
      ghostRefPosition,
      ghostRefQuaternion,
      posErrorM,
      rotErrorRad,
      showLockPosition: mode === 'orientation' || controls.goalMode === 'orientation',
      showRefOrient: mode === 'position' || controls.goalMode === 'pose'
    };
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m.dispose?.());
      }
    });
  }
}
