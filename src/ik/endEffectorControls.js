import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { IkSolverService } from './ikSolverService.js';
import { inferChainJointNames, getUrdfLinkObject } from './ikChainRegistry.js';
import { isIkSolveLogEnabled } from './ikSolveLogger.js';
import { verifyIkKinematicsLoop, logIkKinematicsVerify } from './ikKinematicsVerify.js';
import {
  readIkWeightsFromDom,
  capIterationsForLiveDrag,
  getDragEndSolveOptions
} from './ikWeightConfig.js';
import {
  beginIkSolveSession,
  endIkSolveSession
} from './ikSolveLogger.js';
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
    this._dragStartFk = null;
    this._lastSolveSuccess = true;
    this._jointSnapshotBeforeDrag = null;
    this._storedIkWeights = null;
  }

  _getIkWeights() {
    return readIkWeightsFromDom(this._storedIkWeights);
  }

  setStoredIkWeights(weights) {
    this._storedIkWeights = weights;
  }

  _buildSolveOptions(mode, { dragging = false, dragEnd = false } = {}) {
    const weights = this._getIkWeights();
    const w = weights.position;
    let opts = { ...w };
    if (mode === 'orientation') {
      opts.orientationSoft = true;
    }
    if (dragging) {
      opts = capIterationsForLiveDrag(opts, true);
    } else if (dragEnd) {
      opts = getDragEndSolveOptions(mode, weights);
    }
    return { weights: w, opts };
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

  /**
   * @param {{ syncOrientation?: boolean }} [options]
   *   syncOrientation=false 时只更新位置（位置编辑模式下保持 _refQuaternion 冻结）
   */
  _syncEeReferencesFromFk(options = {}) {
    const syncOrientation = options.syncOrientation ?? (this.goalMode !== 'position');
    const link = getUrdfLinkObject(this.editor.robotRight, this.endEffectorLinkName);
    if (!link) return;
    link.getWorldPosition(this._refPosition);
    if (syncOrientation) {
      link.getWorldQuaternion(this._refQuaternion);
    }
    this._orientationLockPosition.copy(this._refPosition);
  }

  /** 进入位置编辑前快照姿态参考（之后位置 IK 期间不再从 FK 刷新） */
  _snapshotRefQuaternionFromFk() {
    const link = getUrdfLinkObject(this.editor.robotRight, this.endEffectorLinkName);
    if (link) {
      link.getWorldQuaternion(this._refQuaternion);
    }
  }

  /**
   * 位置 IK 后：用同一套权重把姿态拉回 _refQuaternion（6DOF，位置锁在实际 FK）。
   */
  _holdOrientationAtRef(robot, lockPosition) {
    if (!robot || !lockPosition) return;
    const fk = this.ikService.captureEeFk(robot);
    if (fk && fk.quaternion.angleTo(this._refQuaternion) < 0.008) return;

    const w = this._getIkWeights().position;
    this.ikService.solve(robot, lockPosition, this._refQuaternion, {
      ...w,
      orientationSoft: true
    });
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
   *   'orientation' → proxy.pos = _orientationLockPosition, proxy.quat = _refQuaternion
   *   'pose' → proxy.pos = _refPosition, proxy.quat = FK (if syncQuatFromFk) else _refQuaternion
   */
  _applyProxyFromRefs(mode = this.goalMode, options = {}) {
    const syncQuatFromFk = options.syncQuatFromFk ?? false;

    if (mode === 'position') {
      this._proxy.position.copy(this._refPosition);
      this._proxy.quaternion.copy(this._refQuaternion);
    } else if (mode === 'orientation') {
      this._proxy.position.copy(this._orientationLockPosition);
      this._proxy.quaternion.copy(this._refQuaternion);
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
        this._syncEeReferencesFromFk({ syncOrientation: true });
        this._applyProxyFromRefs(this.goalMode, {
          syncQuatFromFk: this.goalMode !== 'position'
        });
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
      this._syncEeReferencesFromFk({ syncOrientation: true });
      this._applyProxyFromRefs(this.goalMode, {
        syncQuatFromFk: this.goalMode !== 'position'
      });
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
      this._lockOrientationPositionFromFk();
      this._proxy.position.copy(this._orientationLockPosition);
      this._proxy.quaternion.copy(this._refQuaternion);
    } else if (this.goalMode === 'position') {
      this._snapshotRefQuaternionFromFk();
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

  _buildPositionTarget() {
    // 拖拽 / 面板增量：目标 = gizmo 世界坐标（与 TransformControls world 空间一致）
    _pos.copy(this._proxy.position);
    return _pos;
  }

  rebuildIk() {
    const robot = this.editor.robotRight;
    if (!robot || !this.endEffectorLinkName) return false;
    const chain = inferChainJointNames(robot, this.endEffectorLinkName);
    const ok = this.ikService.rebuild(robot, this.endEffectorLinkName, chain);
    if (ok && isIkSolveLogEnabled()) {
      try {
        logIkKinematicsVerify(
          verifyIkKinematicsLoop(robot, this.ikService),
          '[IK 闭环@rebuild]'
        );
      } catch (err) {
        console.warn('[IK 闭环@rebuild] 验证失败:', err);
      }
    }
    return ok;
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
          const link = getUrdfLinkObject(this.editor.robotRight, this.endEffectorLinkName);
          if (link) {
            link.getWorldPosition(_pos);
            link.getWorldQuaternion(_quat);
            this._dragStartFk = { position: _pos.clone(), quaternion: _quat.clone() };
          } else {
            this._dragStartFk = null;
          }
        } else {
          // 姿态拖拽：锁位置，从 _refQuaternion 起步（四元数增量，不用 FK/欧拉）
          this._lockOrientationPositionFromFk();
          this._proxy.position.copy(this._orientationLockPosition);
          this._proxy.quaternion.copy(this._refQuaternion);
          this._dragStartFk = {
            position: this._orientationLockPosition.clone(),
            quaternion: this._refQuaternion.clone()
          };
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
    if (this.goalMode === 'orientation') {
      this._applyProxyFromRefs('orientation');
    } else if (this.goalMode === 'position') {
      this._applyProxyFromRefs('position');
    } else {
      this._applyProxyFromRefs('pose', { syncQuatFromFk: true });
    }
    this._updateGizmoMatrices();
  }

  // ─── IK 求解（每帧单次 solve）────────────────────────────────────────────

  _applyIkSolve(mode, extraOptions = {}) {
    const robot = this.editor.robotRight;
    if (!robot || !this.endEffectorLinkName) return { success: false };

    const dragging = extraOptions.dragging ?? this._isDragging();
    const dragEnd = extraOptions.dragEnd ?? false;
    const { weights, opts: baseOpts } = this._buildSolveOptions(mode, { dragging, dragEnd });
    const solveOpts = { ...baseOpts, ...extraOptions };
    delete solveOpts.dragging;
    delete solveOpts.dragEnd;
    delete solveOpts.solvePasses;
    delete solveOpts.skipOrientationHold;
    delete solveOpts.keepProxyAtTarget;

    const jointsBefore = this.ikService.captureChainJointAngles(robot);
    const fkBefore = this.ikService.captureEeFk(robot);
    const proxyInput = {
      position: this._proxy.position.clone(),
      quaternion: this._proxy.quaternion.clone()
    };

    let targetPos;
    let targetQuat;
    let targetBreakdown = null;

    if (mode === 'position') {
      targetPos = this._buildPositionTarget().clone();
      targetQuat = this._refQuaternion.clone();
      _pos.copy(targetPos);
      _quat.copy(targetQuat);

      if (dragging && this._dragProxyStart) {
        targetBreakdown = {
          proxyNow: proxyInput.position.clone(),
          proxyDeltaMm: proxyInput.position.distanceTo(this._dragProxyStart) * 1000
        };
      }

      solveOpts.positionOnly = true;
    } else {
      // 姿态：位置锁 + 目标 = _refQuaternion（拖拽时从 gizmo 同步到 ref）
      if (dragging) {
        this._refQuaternion.copy(this._proxy.quaternion);
      }
      targetPos = this._orientationLockPosition.clone();
      targetQuat = this._refQuaternion.clone();
      this._proxy.position.copy(this._orientationLockPosition);
      this._proxy.quaternion.copy(this._refQuaternion);
      _pos.copy(targetPos);
      _quat.copy(targetQuat);
    }

    const errBefore = this.ikService._estimateError(robot, targetPos, targetQuat, solveOpts);

    // 位置已收敛时跳过求解，避免冗余链零空间破坏 _refQuaternion 对应的姿态
    if (mode === 'position' && solveOpts.positionOnly) {
      const posTol = solveOpts.convergedPositionTolerance ?? 0.004;
      if (errBefore.position < posTol) {
        return { success: true, skipped: true, error: errBefore };
      }
    }

    const appliedWeights = { ...weights, ...solveOpts };

    const sessionId = beginIkSolveSession({
      mode,
      title: mode === 'position' ? '位置 IK' : '姿态 IK',
      context: {
        source: dragging ? 'drag' : 'nudge',
        endLink: this.endEffectorLinkName
      },
      targetPos: targetPos.clone(),
      refQuat: targetQuat.clone(),
      dragStartFk: this._dragStartFk,
      fkBeforeSolve: fkBefore,
      errBefore,
      targetBreakdown,
      weights,
      initialJoints: jointsBefore
    });

    const result = this.ikService.solve(robot, targetPos, targetQuat, solveOpts);

    const jointsAfter = this.ikService.captureChainJointAngles(robot);
    const fkAfter = this.ikService.captureEeFk(robot);
    const errAfter = result.error ?? this.ikService._estimateError(robot, targetPos, targetQuat, solveOpts);

    if (mode === 'position') {
      // 拖拽中 / 面板增量：不做姿态回拉，避免把位置拉斜
      const skipHold = dragging || extraOptions.skipOrientationHold;
      if (!skipHold) {
        this._holdOrientationAtRef(robot, targetPos);
      }
      this._commitActualPositionAsRef(robot);
      this._proxy.quaternion.copy(this._refQuaternion);
      // 拖拽中 gizmo 跟鼠标；非拖拽由 _applyNudge / _onDragEnd 决定是否对齐 FK
      if (!dragging && !extraOptions.keepProxyAtTarget) {
        this._proxy.position.copy(this._refPosition);
      }
    } else if (mode === 'orientation') {
      this._proxy.position.copy(this._orientationLockPosition);
      this._proxy.quaternion.copy(this._refQuaternion);
    }

    this._lastSolveSuccess = result.success;
    robot.updateMatrixWorld(true);
    if (!dragging) {
      this._proxy.updateMatrixWorld(true);
    }
    this._updateGizmoMatrices();

    if (sessionId != null) {
      endIkSolveSession({
        success: result.success,
        result,
        jointsBefore,
        jointsAfter,
        proxyInput,
        appliedWeights,
        fkAfter,
        errAfter,
        errBefore: result.errorBefore ?? errBefore,
        ikFkBefore: result.ikFkBefore,
        ikFkAfter: result.ikFkAfter,
        solverStatus: result.statusLabel,
        loopDeltaMm: result.loopDeltaMm,
        targetPos,
        refQuat: targetQuat,
        weights
      });
    }

    return result;
  }

  _onDragMove() {
    if (!this.enabled || !this.editor.robotRight) return;

    const solveMode = this._getDragSolveMode();
    if (!solveMode) return;

    try {
      this._applyIkSolve(solveMode, { dragging: true });
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
    // 与 gizmo 一致：沿世界系 XYZ 从当前 proxy 位置步进
    _pos.copy(this._proxy.position);
    if (axis === 'x') _pos.x += step;
    else if (axis === 'y') _pos.y += step;
    else _pos.z += step;
    this._proxy.position.copy(_pos);
    this._proxy.updateMatrixWorld(true);
    return this._applyNudge('position', { skipOrientationHold: true });
  }

  nudgeOrientation(axis, sign) {
    if (!this.enabled) return false;
    this._proxy.position.copy(this._orientationLockPosition);

    // 在 _refQuaternion 基础上绕世界轴增量旋转（四元数，避免欧拉万向节）
    _quat.copy(this._refQuaternion);
    const step = this._getRotationStepRad() * sign;
    if (axis === 'x') _axis.set(1, 0, 0);
    else if (axis === 'y') _axis.set(0, 1, 0);
    else _axis.set(0, 0, 1);
    _deltaQuat.setFromAxisAngle(_axis, step);
    _quat.premultiply(_deltaQuat);
    _quat.normalize();
    this._refQuaternion.copy(_quat);
    this._proxy.quaternion.copy(_quat);
    this._proxy.updateMatrixWorld(true);
    return this._applyNudge('orientation');
  }

  _applyNudge(mode, extra = {}) {
    this._jointSnapshotBeforeDrag = this._captureChainJointAngles();
    const result = this._applyIkSolve(mode, { dragging: false, ...extra });
    this._syncJointUi();
    this.editor.curveEditor?.drawDebounced();

    if (mode === 'orientation') {
      this._proxy.position.copy(this._orientationLockPosition);
      this._proxy.quaternion.copy(this._refQuaternion);
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
      const targetPos = this._proxy.position.clone();
      const w = this._getIkWeights().position;
      // 拖拽每帧已求解；松手只做一次精修，不做姿态回拉、不 snap 回 FK
      this._applyIkSolve('position', {
        dragEnd: true,
        dragging: false,
        skipOrientationHold: true,
        keepProxyAtTarget: true
      });
      robot.updateMatrixWorld(true);
      const link = getUrdfLinkObject(robot, this.endEffectorLinkName);
      if (link) {
        link.getWorldPosition(_pos);
        const tol = w.convergedPositionTolerance ?? 0.004;
        showIkError = _pos.distanceTo(targetPos) > Math.max(tol * 3, 0.05);
      }
      this._proxy.position.copy(targetPos);
      this._proxy.quaternion.copy(this._refQuaternion);
      this._updateGizmoMatrices();
      this._syncJointUi();
    } else if (isOrientationEnd && robot) {
      this._refQuaternion.copy(this._proxy.quaternion);
      this._applyIkSolve('orientation', {
        dragEnd: true,
        dragging: false,
        keepProxyAtTarget: true
      });
      robot.updateMatrixWorld(true);
      this._proxy.position.copy(this._orientationLockPosition);
      this._proxy.quaternion.copy(this._refQuaternion);
      this._updateGizmoMatrices();
      this._syncJointUi();
    }

    this._lastSolveSuccess = !showIkError;

    if (showIkError) {
      this.editor.updateStatus(i18n.t('ikPositionReachFailed'), 'error');
    } else if (this._chainAnglesChanged()) {
      this._commitKeyframe();
    }
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

    this._syncEeReferencesFromFk({ syncOrientation: this.goalMode !== 'position' });
    this._applyProxyFromRefs(this.goalMode, {
      syncQuatFromFk: this.goalMode !== 'position'
    });
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
      this._syncEeReferencesFromFk({ syncOrientation: this.goalMode !== 'position' });
      this._applyProxyFromRefs(this.goalMode, {
        syncQuatFromFk: this.goalMode !== 'position'
      });
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
