import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  IkSolverService,
  POSITION_SOFT_ROT_FACTOR,
  ORIENTATION_HOLD_TRANS_FACTOR,
  ORIENTATION_HOLD_ROT_FACTOR
} from './ikSolverService.js';
import { inferChainJointNames, getUrdfLinkObject } from './ikChainRegistry.js';
import { i18n } from '../i18n.js';

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _deltaQuat = new THREE.Quaternion();

const SNAP_POSITION_EPS = 0.008;

export class EndEffectorControls {
  constructor(editor) {
    this.editor = editor;
    this.ikService = new IkSolverService();
    this.enabled = false;
    this.endEffectorLinkName = '';
    this.goalMode = 'pose';

    this.controlsTranslate = null;
    this.controlsRotate = null;
    this._activeDragMode = null;

    this._proxy = new THREE.Object3D();

    /**
     * 调位置期间冻结（不随 FK 刷新）；调姿态结束后更新为实际 FK 四元数。
     * 初始化/切帧/播放恢复时从 FK 读取。
     */
    this._refQuaternion = new THREE.Quaternion();

    /**
     * 当前末端实际 FK 世界位置（每次 IK 求解后更新为实际到达位置）。
     * 进入姿态编辑时用于冻结 _orientationLockPosition。
     */
    this._refPosition = new THREE.Vector3();

    /**
     * 姿态编辑全程锁定的世界坐标。
     * 进入姿态编辑时从实际 FK 写入，求解期间保持不变。
     */
    this._orientationLockPosition = new THREE.Vector3();

    this._dragRefPosition = new THREE.Vector3();
    this._dragProxyStart = new THREE.Vector3();
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

  // ─── 双 gizmo 工具 ───────────────────────────────────────────────────────

  _forEachControl(fn) {
    if (this.controlsTranslate) fn(this.controlsTranslate);
    if (this.controlsRotate) fn(this.controlsRotate);
  }

  _isDragging() {
    return !!(this.controlsTranslate?.dragging || this.controlsRotate?.dragging);
  }

  _getPeerControl(control) {
    return control === this.controlsTranslate ? this.controlsRotate : this.controlsTranslate;
  }

  _updateGizmoMatrices() {
    this._forEachControl((c) => {
      if (c.object === this._proxy) c.updateMatrixWorld();
    });
  }

  /** 隐藏 TransformControls 绕相机视线旋转的黄色外圈（handle.name === 'E'） */
  _hideViewAxisRotationRing(control) {
    const gizmoRoot = control?._gizmo;
    if (!gizmoRoot) return;

    for (const part of ['gizmo', 'picker']) {
      const rotateRoot = gizmoRoot[part]?.rotate;
      if (!rotateRoot) continue;
      rotateRoot.traverse((child) => {
        if (child.name === 'E') child.visible = false;
      });
    }
  }

  _patchRotateControlNoViewRing(control) {
    if (!control || control._ikNoViewRingPatched) return;
    control._ikNoViewRingPatched = true;
    const origUpdate = control.updateMatrixWorld.bind(control);
    control.updateMatrixWorld = () => {
      origUpdate();
      this._hideViewAxisRotationRing(control);
    };
    this._hideViewAxisRotationRing(control);
  }

  _updateControlsAttachment() {
    const tc = this.controlsTranslate;
    const rc = this.controlsRotate;
    if (!tc || !rc) return;

    tc.detach();
    rc.detach();

    if (!this.enabled) {
      tc.enabled = false;
      rc.enabled = false;
      return;
    }

    const camera = this._getCamera();
    tc.camera = camera;
    rc.camera = camera;

    if (this.goalMode === 'pose') {
      tc.attach(this._proxy);
      rc.attach(this._proxy);
      tc.enabled = true;
      rc.enabled = true;
    } else if (this.goalMode === 'position') {
      tc.attach(this._proxy);
      tc.enabled = true;
      rc.enabled = false;
    } else {
      rc.attach(this._proxy);
      rc.enabled = true;
      tc.enabled = false;
    }
  }

  _reattachControls() {
    if (!this.controlsTranslate) return;
    const scene = this._getScene();
    if (!scene) return;

    if (this._proxy.parent !== scene) {
      this._proxy.parent?.remove(this._proxy);
      scene.add(this._proxy);
    }
    this._forEachControl((c) => {
      if (c.parent !== scene) {
        c.parent?.remove(c);
        scene.add(c);
      }
    });
    this._updateControlsAttachment();
  }

  _getDragSolveMode() {
    if (this.goalMode === 'pose') return this._activeDragMode;
    return this.goalMode === 'orientation' ? 'orientation' : 'position';
  }

  // ─── 参考值同步 ──────────────────────────────────────────────────────────

  _syncEeReferencesFromFk() {
    const link = getUrdfLinkObject(this.editor.robotRight, this.endEffectorLinkName);
    if (!link) return;
    link.getWorldPosition(this._refPosition);
    link.getWorldQuaternion(this._refQuaternion);
    this._orientationLockPosition.copy(this._refPosition);
  }

  /**
   * 读取实际 FK 位置，锁入 _orientationLockPosition 与 _refPosition。
   * 进入姿态编辑时必须调用，确保锁定的是机器人实际位置而非目标。
   */
  _lockOrientationPositionFromFk() {
    const link = getUrdfLinkObject(this.editor.robotRight, this.endEffectorLinkName);
    if (!link) return;
    link.getWorldPosition(this._orientationLockPosition);
    this._refPosition.copy(this._orientationLockPosition);
  }

  /**
   * 位置 IK 求解后：把实际 FK 位置写入 _refPosition 和 _orientationLockPosition。
   * gizmo(_proxy) 的位置保持目标(_pos)，用于流畅拖拽视觉；但参考值始终是实际位置。
   */
  _commitActualPositionAsRef(robot) {
    const link = getUrdfLinkObject(robot, this.endEffectorLinkName);
    if (link) {
      link.getWorldPosition(this._refPosition);
    } else {
      this._refPosition.copy(_pos);
    }
    this._orientationLockPosition.copy(this._refPosition);
  }

  // ─── gizmo 位置同步 ───────────────────────────────────────────────────────

  /**
   * 将 proxy 位置/姿态对齐到参考。
   * mode:
   *   'position' → proxy.pos = _refPosition, proxy.quat = _refQuaternion
   *   'orientation' → proxy.pos = _orientationLockPosition, proxy.quat = FK
   *   'pose' → proxy.pos = _refPosition, proxy.quat = FK (if syncQuatFromFk) else _refQuaternion
   */
  _applyProxyFromRefs(mode = this.goalMode, options = {}) {
    const syncQuatFromFk = options.syncQuatFromFk ?? false;

    if (mode === 'position') {
      this._proxy.position.copy(this._refPosition);
      this._proxy.quaternion.copy(this._refQuaternion);
    } else if (mode === 'orientation') {
      this._proxy.position.copy(this._orientationLockPosition);
      if (syncQuatFromFk) {
        const link = getUrdfLinkObject(this.editor.robotRight, this.endEffectorLinkName);
        if (link) {
          link.getWorldQuaternion(_quat);
          this._proxy.quaternion.copy(_quat);
        }
      }
    } else {
      // pose
      this._proxy.position.copy(this._refPosition);
      if (syncQuatFromFk) {
        const link = getUrdfLinkObject(this.editor.robotRight, this.endEffectorLinkName);
        if (link) {
          link.getWorldQuaternion(_quat);
          this._proxy.quaternion.copy(_quat);
        }
      } else {
        this._proxy.quaternion.copy(this._refQuaternion);
      }
    }
    this._proxy.updateMatrixWorld(true);
  }

  // ─── 启用 / 末端链 / 模式 ─────────────────────────────────────────────────

  setEnabled(on) {
    if (on && this.enabled) return true;
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
        this._syncEeReferencesFromFk();
        this._applyProxyFromRefs(this.goalMode, { syncQuatFromFk: true });
        this._reattachControls();
        return true;
      } catch (err) {
        console.error('IK enable failed:', err);
        this.editor.updateStatus(i18n.t('ikSolveFailed'), 'error');
        this.enabled = false;
        return false;
      }
    } else {
      this._updateControlsAttachment();
    }
    return true;
  }

  setEndLink(linkName) {
    this.endEffectorLinkName = linkName;
    if (this.enabled) {
      this.rebuildIk();
      this._syncEeReferencesFromFk();
      this._applyProxyFromRefs(this.goalMode, { syncQuatFromFk: true });
    }
    if (linkName) {
      this.editor.curveEditor?.setActiveEndEffector(linkName);
    }
  }

  setGoalMode(mode) {
    if (mode === 'orientation') {
      this.goalMode = 'orientation';
    } else if (mode === 'position') {
      this.goalMode = 'position';
    } else {
      this.goalMode = 'pose';
    }

    if (!this.enabled) return;

    if (this.goalMode === 'orientation') {
      // 进入纯姿态模式：从实际 FK 锁定位置，不能用 _refPosition（可能是目标而非实际）
      this._lockOrientationPositionFromFk();
      const link = getUrdfLinkObject(this.editor.robotRight, this.endEffectorLinkName);
      if (link) {
        link.getWorldQuaternion(_quat);
        this._proxy.quaternion.copy(_quat);
      }
      this._proxy.position.copy(this._orientationLockPosition);
    } else if (this.goalMode === 'position') {
      this._applyProxyFromRefs('position');
    } else {
      // pose：从 FK 读取最新状态
      this._syncEeReferencesFromFk();
      this._applyProxyFromRefs('pose', { syncQuatFromFk: true });
    }

    this._updateControlsAttachment();
    this._updateGizmoMatrices();
  }

  // ─── 位置目标构建 ─────────────────────────────────────────────────────────

  _buildPositionTarget(lockAxis = null) {
    if (lockAxis) {
      _pos.copy(this._refPosition);
      if (lockAxis === 'x') _pos.x = this._proxy.position.x;
      else if (lockAxis === 'y') _pos.y = this._proxy.position.y;
      else _pos.z = this._proxy.position.z;
      return _pos;
    }

    const delta = new THREE.Vector3().subVectors(this._proxy.position, this._dragProxyStart);
    _pos.copy(this._dragRefPosition);
    const eps = 1e-5;
    if (Math.abs(delta.x) >= eps) _pos.x += delta.x;
    if (Math.abs(delta.y) >= eps) _pos.y += delta.y;
    if (Math.abs(delta.z) >= eps) _pos.z += delta.z;
    return _pos;
  }

  rebuildIk() {
    const robot = this.editor.robotRight;
    if (!robot || !this.endEffectorLinkName) return false;
    const chain = inferChainJointNames(robot, this.endEffectorLinkName);
    return this.ikService.rebuild(robot, this.endEffectorLinkName, chain);
  }

  _applyGhostChainJoints() {
    const ghost = this.editor.robotLeft;
    const robot = this.editor.robotRight;
    if (!ghost || !robot) return false;

    let applied = 0;
    for (const name of this.ikService.chainJointNames) {
      const angle = ghost.joints[name]?.angle;
      if (angle !== undefined && robot.joints[name]) {
        robot.setJointValue(name, angle);
        applied++;
      }
    }
    return applied > 0;
  }

  _getPositionStepM() {
    const el = document.getElementById('ik-pos-step');
    const v = el ? parseFloat(el.value) : 0.01;
    return Number.isFinite(v) && v > 0 ? v : 0.01;
  }

  _getRotationStepRad() {
    const el = document.getElementById('ik-rot-step');
    const deg = el ? parseFloat(el.value) : 3;
    const v = (Number.isFinite(deg) ? deg : 3) * (Math.PI / 180);
    return v > 0 ? v : Math.PI / 60;
  }

  // ─── TransformControls 创建与绑定 ─────────────────────────────────────────

  _bindTransformControl(control, dragMode) {
    control.addEventListener('dragging-changed', (e) => {
      this.editor.controls.enabled = !e.value;
      this.editor.isIkDragging = e.value;
      const peer = this._getPeerControl(control);

      if (e.value) {
        // ── 拖拽开始 ──
        this._activeDragMode = dragMode;
        if (peer) peer.enabled = false;
        this._jointSnapshotBeforeDrag = this._captureChainJointAngles();

        if (dragMode === 'position') {
          // 位置拖拽：_refQuaternion 不更新，保持调位置期间姿态参考冻结
          this._applyProxyFromRefs(
            this.goalMode === 'pose' ? 'pose' : 'position'
          );
          this._dragRefPosition.copy(this._refPosition);
          this._dragProxyStart.copy(this._proxy.position);
        } else {
          // 姿态拖拽：从实际 FK 锁定位置参考
          this._lockOrientationPositionFromFk();
          this._proxy.position.copy(this._orientationLockPosition);
          const link = getUrdfLinkObject(this.editor.robotRight, this.endEffectorLinkName);
          if (link) {
            link.getWorldQuaternion(_quat);
            this._proxy.quaternion.copy(_quat);
          }
        }
        this._proxy.updateMatrixWorld(true);
        this._updateGizmoMatrices();
      } else {
        // ── 拖拽结束 ──
        this._onDragEnd();
        this.editor.isIkDragging = false;
        this._activeDragMode = null;
        if (peer && this.enabled) peer.enabled = true;
        this._updateControlsAttachment();
      }
    });

    control.addEventListener('change', () => {
      if (control.dragging) this._onDragMove();
    });
  }

  _ensureControls() {
    if (this.controlsTranslate) {
      this._updateControlsAttachment();
      return;
    }

    const camera = this._getCamera();
    const dom = this.editor.renderer.domElement;

    this.controlsTranslate = new TransformControls(camera, dom);
    this.controlsTranslate.setSpace('world');
    this.controlsTranslate.setMode('translate');
    this.controlsTranslate.size = 0.72;

    this.controlsRotate = new TransformControls(camera, dom);
    this.controlsRotate.setSpace('world');
    this.controlsRotate.setMode('rotate');
    this.controlsRotate.size = 0.82;
    this._patchRotateControlNoViewRing(this.controlsRotate);

    this._bindTransformControl(this.controlsTranslate, 'position');
    this._bindTransformControl(this.controlsRotate, 'orientation');

    const scene = this._getScene();
    if (scene) {
      scene.add(this._proxy);
      scene.add(this.controlsTranslate);
      scene.add(this.controlsRotate);
    }
    this._updateControlsAttachment();
  }

  syncGizmoToLink() {
    this._applyProxyFromRefs(this.goalMode, { syncQuatFromFk: true });
    this._updateGizmoMatrices();
  }

  // ─── IK 求解 ─────────────────────────────────────────────────────────────

  _applyIkSolve(mode, extraOptions = {}) {
    const robot = this.editor.robotRight;
    if (!robot || !this.endEffectorLinkName) return { success: false };

    let result;

    if (mode === 'position') {
      // 位置编辑：跟随 gizmo 目标，_refQuaternion 作软约束（不修改它）
      const lockAxis = extraOptions.lockAxis ?? null;
      this._buildPositionTarget(lockAxis);

      result = this.ikService.solveHoldPositionSoftOrientation(
        robot,
        _pos,
        this._refQuaternion,
        {
          rotationFactor: POSITION_SOFT_ROT_FACTOR,
          maxIterations: 18,
          ...extraOptions
        }
      );

      // 把实际 FK 位置写入参考（不用目标 _pos）
      this._commitActualPositionAsRef(robot);
      // gizmo 跟目标走（视觉流畅）
      this._proxy.position.copy(_pos);
      this._proxy.quaternion.copy(this._refQuaternion);
    } else {
      // 姿态编辑：位置权重极高，锁定 _orientationLockPosition
      this._proxy.position.copy(this._orientationLockPosition);
      _quat.copy(this._proxy.quaternion);

      result = this.ikService.solveOrientationHoldPosition(
        robot,
        this._orientationLockPosition,
        _quat,
        {
          translationFactor: ORIENTATION_HOLD_TRANS_FACTOR,
          rotationFactor: ORIENTATION_HOLD_ROT_FACTOR,
          maxIterations: 20,
          solvePasses: 5,
          ...extraOptions
        }
      );

      // gizmo 位置钉在锁点
      this._proxy.position.copy(this._orientationLockPosition);
    }

    this._lastSolveSuccess = result.success;
    robot.updateMatrixWorld(true);
    this._proxy.updateMatrixWorld(true);
    this._updateGizmoMatrices();
    return result;
  }

  _onDragMove() {
    if (!this.enabled || !this.editor.robotRight) return;

    const solveMode = this._getDragSolveMode();
    if (!solveMode) return;

    try {
      this._applyIkSolve(solveMode);
      this._syncJointUi();
      this.editor.curveEditor?.drawDebounced();
    } catch (err) {
      console.error('IK drag solve failed:', err);
      this._lastSolveSuccess = false;
    }
  }

  // ─── ± 按钮微调 ───────────────────────────────────────────────────────────

  nudgePosition(axis, sign) {
    if (!this.enabled) return false;
    const step = this._getPositionStepM() * sign;
    // 从实际参考位置起步
    _pos.copy(this._refPosition);
    if (axis === 'x') _pos.x += step;
    else if (axis === 'y') _pos.y += step;
    else _pos.z += step;
    this._proxy.position.copy(_pos);
    this._proxy.updateMatrixWorld(true);
    return this._applyNudge('position', { lockAxis: axis });
  }

  nudgeOrientation(axis, sign) {
    if (!this.enabled) return false;
    // 姿态 nudge 开始时才从 FK 刷新锁点（避免多次连续 nudge 因 IK 误差累积漂移）
    // 只有在第一次调用时（_orientationLockPosition 已在 drag/setGoalMode 时设定）刷新
    // 如果 _refPosition 与实际 FK 偏差较大，才重新锁
    const link = getUrdfLinkObject(this.editor.robotRight, this.endEffectorLinkName);
    if (link) {
      link.getWorldPosition(_pos);
      if (_pos.distanceTo(this._orientationLockPosition) > 0.005) {
        this._lockOrientationPositionFromFk();
      }
    }
    this._proxy.position.copy(this._orientationLockPosition);

    const step = this._getRotationStepRad() * sign;
    if (axis === 'x') _axis.set(1, 0, 0);
    else if (axis === 'y') _axis.set(0, 1, 0);
    else _axis.set(0, 0, 1);
    _deltaQuat.setFromAxisAngle(_axis, step);
    this._proxy.quaternion.premultiply(_deltaQuat);
    this._proxy.updateMatrixWorld(true);
    return this._applyNudge('orientation');
  }

  _applyNudge(mode, extra = {}) {
    this._jointSnapshotBeforeDrag = this._captureChainJointAngles();
    const result = this._applyIkSolve(mode, { maxIterations: 18, ...extra });
    this._syncJointUi();
    this.editor.curveEditor?.drawDebounced();

    if (mode === 'orientation') {
      this._proxy.position.copy(this._orientationLockPosition);
      // 松手后更新 _refQuaternion 为实际 FK 四元数
      const link = getUrdfLinkObject(this.editor.robotRight, this.endEffectorLinkName);
      if (link) link.getWorldQuaternion(this._refQuaternion);
    } else {
      this._applyProxyFromRefs(this.goalMode === 'pose' ? 'pose' : 'position');
    }
    this._updateGizmoMatrices();

    if (result.success && this._chainAnglesChanged()) {
      this._commitKeyframe();
    }
    return result.success;
  }

  // ─── 重置到参考 ───────────────────────────────────────────────────────────

  resetToReference() {
    if (!this.enabled || !this.editor.robotRight) return false;

    if (!this.editor.robotLeft) {
      this.editor.updateStatus(i18n.t('ikNeedReference'), 'error');
      return false;
    }

    this._jointSnapshotBeforeDrag = this._captureChainJointAngles();

    if (!this._applyGhostChainJoints()) {
      this.editor.updateStatus(i18n.t('ikSolveFailed'), 'error');
      return false;
    }

    const robot = this.editor.robotRight;
    robot.updateMatrixWorld(true);
    this.rebuildIk();
    this._syncEeReferencesFromFk();
    this._applyProxyFromRefs(this.goalMode, { syncQuatFromFk: true });
    this._lastSolveSuccess = true;

    this._syncJointUi();
    this.editor.curveEditor?.drawDebounced();

    if (this._chainAnglesChanged()) this._commitKeyframe();
    this.editor.updateStatus(i18n.t('ikResetDone'), 'success');
    return true;
  }

  // ─── 拖拽结束 ─────────────────────────────────────────────────────────────

  _onDragEnd() {
    const robot = this.editor.robotRight;
    const endMode = this._getDragSolveMode() || this.goalMode;
    const isPositionEnd = endMode === 'position';
    const isOrientationEnd = endMode === 'orientation';

    let showIkError = false;

    if (isPositionEnd && robot) {
      this._buildPositionTarget();
      const targetPos = _pos.clone();
      this.ikService.solveHoldPositionSoftOrientation(
        robot,
        _pos,
        this._refQuaternion,
        { maxIterations: 24, rotationFactor: POSITION_SOFT_ROT_FACTOR }
      );
      robot.updateMatrixWorld(true);
      this._commitActualPositionAsRef(robot);
      const link = getUrdfLinkObject(robot, this.endEffectorLinkName);
      if (link) {
        link.getWorldPosition(_pos);
        showIkError = _pos.distanceTo(targetPos) > 0.05;
      }
      this._syncJointUi();
    } else if (isOrientationEnd && robot) {
      // 做最终高精度姿态求解
      _quat.copy(this._proxy.quaternion);
      this.ikService.solveOrientationHoldPosition(robot, this._orientationLockPosition, _quat, {
        translationFactor: ORIENTATION_HOLD_TRANS_FACTOR,
        rotationFactor: ORIENTATION_HOLD_ROT_FACTOR,
        maxIterations: 24,
        solvePasses: 8
      });
      robot.updateMatrixWorld(true);
      // 更新 _refQuaternion 为实际 FK 四元数（供后续位置编辑维持）
      const link = getUrdfLinkObject(robot, this.endEffectorLinkName);
      if (link) link.getWorldQuaternion(this._refQuaternion);
      this._syncJointUi();
    }

    this._lastSolveSuccess = !showIkError;

    if (showIkError) {
      this.editor.updateStatus(i18n.t('ikPositionReachFailed'), 'error');
    } else if (this._chainAnglesChanged()) {
      this._commitKeyframe();
    }

    const syncQuat = isOrientationEnd || this.goalMode === 'orientation';
    this._applyProxyFromRefs(this.goalMode, { syncQuatFromFk: syncQuat });
    this._updateGizmoMatrices();
  }

  // ─── 辅助 ────────────────────────────────────────────────────────────────

  _captureChainJointAngles() {
    const robot = this.editor.robotRight;
    const names = this.ikService.chainJointNames;
    return names.map((n) => robot.joints[n]?.angle ?? 0);
  }

  _chainAnglesChanged() {
    if (!this._jointSnapshotBeforeDrag) return true;
    const current = this._captureChainJointAngles();
    for (let i = 0; i < current.length; i++) {
      if (Math.abs(current[i] - this._jointSnapshotBeforeDrag[i]) > 1e-4) return true;
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

  // ─── 切帧 / 播放 ──────────────────────────────────────────────────────────

  onFrameChanged() {
    if (!this.enabled) return;
    if (this._isDragging()) return;
    if (this.editor.timelineController?.isPlaying) return;

    this._syncEeReferencesFromFk();
    this._applyProxyFromRefs(this.goalMode, { syncQuatFromFk: true });
    this._updateGizmoMatrices();
  }

  onPlaybackChanged(isPlaying) {
    if (!this.controlsTranslate) return;
    if (isPlaying) {
      this.controlsTranslate.detach();
      this.controlsRotate.detach();
      this.controlsTranslate.enabled = false;
      this.controlsRotate.enabled = false;
    } else if (this.enabled) {
      this._syncEeReferencesFromFk();
      this._applyProxyFromRefs(this.goalMode, { syncQuatFromFk: true });
      this._updateControlsAttachment();
      this._updateGizmoMatrices();
    }
  }

  dispose() {
    this._forEachControl((c) => {
      c.detach();
      c.dispose();
    });
    this.controlsTranslate = null;
    this.controlsRotate = null;
    this.ikService.dispose();
  }
}
