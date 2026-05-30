import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { IkSolverService } from './ikSolverService.js';
import { inferChainJointNames, getUrdfLinkObject } from './ikChainRegistry.js';
import { i18n } from '../i18n.js';

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();

export class EndEffectorControls {
  constructor(editor) {
    this.editor = editor;
    this.ikService = new IkSolverService();
    this.enabled = false;
    this.endEffectorLinkName = '';
    this.goalMode = 'pose';
    this.lockFootZ = false;
    this._footZAtDragStart = null;
    this.controls = null;
    this._proxy = new THREE.Object3D();
    this._lastSolveSuccess = true;
    this._jointSnapshotBeforeDrag = null;
  }

  onViewportModeChanged() {
    this._reattachControls();
  }

  _getScene() {
    return this.editor.viewportManager?.getActiveScene() || this.editor.sceneRight;
  }

  _getCamera() {
    return this.editor.viewportManager?.getRenderCamera() || this.editor.cameraRight;
  }

  _reattachControls() {
    if (!this.controls) return;
    const scene = this._getScene();
    if (!scene) return;

    if (this._proxy.parent !== scene) {
      this._proxy.parent?.remove(this._proxy);
      scene.add(this._proxy);
    }
    if (this.controls.parent !== scene) {
      this.controls.parent?.remove(this.controls);
      scene.add(this.controls);
    }
    this.controls.camera = this._getCamera();
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) {
      if (!this.editor.robotRight) {
        alert(i18n.t('ikNeedUrdf'));
        this.enabled = false;
        return false;
      }
      if (!this.endEffectorLinkName) {
        this.editor.updateStatus(i18n.t('ikSolveFailed'), 'error');
        this.enabled = false;
        return false;
      }
      try {
        this._ensureControls();
        if (!this.rebuildIk()) {
          this.editor.updateStatus(i18n.t('ikSolveFailed'), 'error');
          this.enabled = false;
          return false;
        }
        this.syncGizmoToLink();
        this._reattachControls();
        if (this.controls) {
          this.controls.enabled = true;
          this.controls.attach(this._proxy);
        }
        return true;
      } catch (err) {
        console.error('IK enable failed:', err);
        this.editor.updateStatus(i18n.t('ikSolveFailed'), 'error');
        this.enabled = false;
        return false;
      }
    } else if (this.controls) {
      this.controls.detach();
      this.controls.enabled = false;
    }
    return true;
  }

  setEndLink(linkName) {
    this.endEffectorLinkName = linkName;
    if (this.enabled) {
      this.rebuildIk();
      this.syncGizmoToLink();
    }
    if (linkName) {
      this.editor.curveEditor?.setActiveEndEffector(linkName);
    }
  }

  setGoalMode(mode) {
    this.goalMode = mode;
  }

  setLockFootZ(on) {
    this.lockFootZ = on;
  }

  rebuildIk() {
    const robot = this.editor.robotRight;
    if (!robot || !this.endEffectorLinkName) return false;
    const chain = inferChainJointNames(robot, this.endEffectorLinkName);
    return this.ikService.rebuild(robot, this.endEffectorLinkName, chain);
  }

  _ensureControls() {
    if (this.controls) {
      this.controls.enabled = true;
      return;
    }

    const camera = this._getCamera();
    this.controls = new TransformControls(camera, this.editor.renderer.domElement);
    this.controls.setSpace('world');
    this.controls.size = 0.75;

    this.controls.addEventListener('dragging-changed', (e) => {
      this.editor.controls.enabled = !e.value;
      this.editor.isIkDragging = e.value;
      if (e.value) {
        this._footZAtDragStart = this._getLinkWorldPosition()?.z ?? null;
        this._jointSnapshotBeforeDrag = this._captureChainJointAngles();
      } else {
        this._onDragEnd();
        this.editor.isIkDragging = false;
      }
    });

    this.controls.addEventListener('change', () => {
      if (this.controls.dragging) {
        this._onDragMove();
      }
    });

    const scene = this._getScene();
    if (scene) {
      scene.add(this._proxy);
      scene.add(this.controls);
    }
  }

  _getLinkWorldPosition() {
    const robot = this.editor.robotRight;
    const link = getUrdfLinkObject(robot, this.endEffectorLinkName);
    if (!link) return null;
    link.getWorldPosition(_pos);
    return _pos.clone();
  }

  syncGizmoToLink() {
    const robot = this.editor.robotRight;
    const link = getUrdfLinkObject(robot, this.endEffectorLinkName);
    if (!link) return;

    link.getWorldPosition(_pos);
    link.getWorldQuaternion(_quat);
    _euler.setFromQuaternion(_quat);

    this._proxy.position.copy(_pos);
    this._proxy.quaternion.copy(_quat);
    this._proxy.updateMatrixWorld(true);
  }

  _onDragMove() {
    if (!this.enabled || !this.editor.robotRight) return;

    try {
      _pos.copy(this._proxy.position);
      _quat.copy(this._proxy.quaternion);
      if (this.lockFootZ && this._footZAtDragStart != null) {
        _pos.z = this._footZAtDragStart;
      }

      const options = {
        positionOnly: this.goalMode === 'position'
      };

      const result = this.ikService.solve(this.editor.robotRight, _pos, _quat, options);
      this._lastSolveSuccess = result.success;

      this._syncJointUi();
      this.editor.robotRight.updateMatrixWorld(true);
      this.syncGizmoToLink();
      this.editor.curveEditor?.drawDebounced();
    } catch (err) {
      console.error('IK drag solve failed:', err);
      this._lastSolveSuccess = false;
    }
  }

  _onDragEnd() {
    if (!this._lastSolveSuccess) {
      this.editor.updateStatus(i18n.t('ikSolveFailed'), 'error');
      this.syncGizmoToLink();
      return;
    }

    const changed = this._chainAnglesChanged();
    if (changed) {
      this._commitKeyframe();
    }
  }

  _captureChainJointAngles() {
    const robot = this.editor.robotRight;
    const names = this.ikService.chainJointNames;
    return names.map((n) => robot.joints[n]?.angle ?? 0);
  }

  _chainAnglesChanged() {
    if (!this._jointSnapshotBeforeDrag) return true;
    const current = this._captureChainJointAngles();
    for (let i = 0; i < current.length; i++) {
      if (Math.abs(current[i] - this._jointSnapshotBeforeDrag[i]) > 1e-4) {
        return true;
      }
    }
    return false;
  }

  _syncJointUi() {
    const jc = this.editor.jointController;
    if (!jc) return;
    jc.syncFromRobotSilent(this.editor.robotRight);
    if (this.editor.showCOM && this.editor.comVisualizerRight) {
      this.editor.comVisualizerRight.update(this.editor.robotRight);
    }
  }

  _commitKeyframe() {
    const editor = this.editor;
    if (!editor.jointController || !editor.trajectoryManager.hasTrajectory()) return;

    const frame = editor.timelineController.getCurrentFrame();
    const jointValues = editor.jointController.getCurrentJointValues();
    const baseValues = editor.baseController
      ? editor.baseController.getCurrentBaseValues()
      : null;

    const isNew = editor.trajectoryManager.addKeyframe(frame, jointValues, baseValues);

    const keyframes = Array.from(editor.trajectoryManager.keyframes.keys());
    editor.timelineController.updateKeyframeMarkers(keyframes);
    editor.jointController.updateKeyframeIndicators();
    editor.curveEditor?.drawDebounced();

    editor.updateStatus(isNew ? i18n.t('addKeyframe') : i18n.t('addKeyframe'), 'success');
  }

  onFrameChanged() {
    if (!this.enabled) return;
    if (this.controls?.dragging) return;
    if (this.editor.timelineController?.isPlaying) return;
    this.syncGizmoToLink();
  }

  onPlaybackChanged(isPlaying) {
    if (!this.controls) return;
    if (isPlaying) {
      this.controls.detach();
      this.controls.enabled = false;
    } else if (this.enabled) {
      this.controls.enabled = true;
      this.controls.attach(this._proxy);
      this.syncGizmoToLink();
    }
  }

  dispose() {
    if (this.controls) {
      this.controls.detach();
      this.controls.dispose();
      this.controls = null;
    }
    this.ikService.dispose();
  }
}
