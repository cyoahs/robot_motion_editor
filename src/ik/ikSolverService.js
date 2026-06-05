import * as THREE from 'three';
import { Solver } from 'closed-chain-ik/src/core/Solver.js';
import { Goal } from 'closed-chain-ik/src/core/Goal.js';
import { DOF } from 'closed-chain-ik/src/core/Joint.js';
import {
  setIKFromUrdf,
  urdfRobotToIKRoot
} from 'closed-chain-ik/src/three/urdfHelpers.js';
import { findIKLinkByName, formatSolverStatus } from './ikSolverUtils.js';
import {
  inferChainJointNames,
  inferChainJointNamesFromIkTree
} from './ikChainRegistry.js';
import { IK_WEIGHT_DEFAULTS } from './ikWeightConfig.js';
import {
  applyAllIkJointsToUrdf,
  compareChainJointAngles,
  measureUrdfIkFkDeltaMm,
  syncIkFixedJointOriginsFromUrdf,
  verifyIkKinematicsLoop
} from './ikKinematicsVerify.js';

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'ZYX');

export class IkSolverService {
  constructor() {
    this.ikRoot = null;
    this.solver = null;
    this.goal = null;
    this.closureLink = null;
    this.chainJointNames = [];
    this.endEffectorLinkName = '';
    this._worldJoint = null;
  }

  dispose() {
    this.ikRoot = null;
    this.solver = null;
    this.goal = null;
    this.closureLink = null;
  }

  rebuild(robot, endEffectorLinkName, chainJointNames) {
    this.dispose();
    if (!robot || !endEffectorLinkName) return false;

    try {
      this.endEffectorLinkName = endEffectorLinkName;
      this.chainJointNames = chainJointNames || inferChainJointNames(robot, endEffectorLinkName);

      this.ikRoot = urdfRobotToIKRoot(robot, false);
      if (!this.ikRoot) return false;

      this._syncRobotToIk(robot);

      this.closureLink = findIKLinkByName(this.ikRoot, endEffectorLinkName);
      if (!this.closureLink) {
        console.warn('IK: link not found in IK tree', endEffectorLinkName);
        return false;
      }

      const ikChain = inferChainJointNamesFromIkTree(this.ikRoot, endEffectorLinkName);
      if (ikChain.length && ikChain.join(',') !== this.chainJointNames.join(',')) {
        console.warn('[IK] URDF 链与 IK 树链不一致', {
          urdf: this.chainJointNames,
          ikTree: ikChain,
          endLink: endEffectorLinkName
        });
      }

      this.goal = new Goal();
      this.goal.makeClosure(this.closureLink);

      this.solver = new Solver(this.ikRoot);
      this._applyDefaultSolverSettings();
      this._worldJoint = this._findWorldJoint();

      return true;
    } catch (err) {
      console.error('IK rebuild failed:', err);
      this.dispose();
      return false;
    }
  }

  _applyDefaultSolverSettings() {
    const d = IK_WEIGHT_DEFAULTS.position;
    this.solver.maxIterations = d.maxIterations;
    this.solver.dampingFactor = d.dampingFactor;
    this.solver.translationFactor = d.translationFactor;
    this.solver.rotationFactor = d.rotationFactor;
    this.solver.translationErrorClamp = d.translationErrorClamp;
    this.solver.divergeThreshold = d.divergeThreshold;
    this.solver.translationConvergeThreshold = d.convergedPositionTolerance;
    this.solver.stallThreshold = 1e-4;
  }

  _applySolverOptions(options = {}) {
    if (options.maxIterations != null) {
      this.solver.maxIterations = options.maxIterations;
    }
    if (options.dampingFactor != null) {
      this.solver.dampingFactor = options.dampingFactor;
    }
    if (options.translationFactor != null) {
      this.solver.translationFactor = options.translationFactor;
    }
    if (options.rotationFactor != null) {
      this.solver.rotationFactor = options.rotationFactor;
    }
    if (options.translationErrorClamp != null) {
      this.solver.translationErrorClamp = options.translationErrorClamp;
    }
    if (options.rotationErrorClamp != null) {
      this.solver.rotationErrorClamp = options.rotationErrorClamp;
    }
    if (options.divergeThreshold != null) {
      this.solver.divergeThreshold = options.divergeThreshold;
    }
    if (options.convergedPositionTolerance != null) {
      this.solver.translationConvergeThreshold = options.convergedPositionTolerance;
    }
    if (options.rotationConvergeThreshold != null) {
      this.solver.rotationConvergeThreshold = options.rotationConvergeThreshold;
    }
    if (options.stallThreshold != null) {
      this.solver.stallThreshold = options.stallThreshold;
    }
  }

  _snapshotSolverSettings() {
    const s = this.solver;
    return {
      maxIterations: s.maxIterations,
      dampingFactor: s.dampingFactor,
      translationFactor: s.translationFactor,
      rotationFactor: s.rotationFactor,
      translationErrorClamp: s.translationErrorClamp,
      divergeThreshold: s.divergeThreshold,
      translationConvergeThreshold: s.translationConvergeThreshold,
      rotationConvergeThreshold: s.rotationConvergeThreshold,
      stallThreshold: s.stallThreshold
    };
  }

  _restoreSolverSettings(saved) {
    Object.assign(this.solver, saved);
  }

  _findWorldJoint() {
    let found = null;
    this.ikRoot?.traverse((c) => {
      if (c.isJoint && c.name === '__world_joint__') found = c;
    });
    return found;
  }

  /**
   * URDF → IK 同步；用四元数写 world_joint 旋转，避免 rotation/euler 不一致
   */
  _syncRobotToIk(robot) {
    robot.updateMatrixWorld(true);
    syncIkFixedJointOriginsFromUrdf(robot, this.ikRoot);
    setIKFromUrdf(this.ikRoot, robot);

    if (this._worldJoint) {
      this._worldJoint.setDoFValue(DOF.X, robot.position.x);
      this._worldJoint.setDoFValue(DOF.Y, robot.position.y);
      this._worldJoint.setDoFValue(DOF.Z, robot.position.z);
      _euler.setFromQuaternion(robot.quaternion, 'ZYX');
      this._worldJoint.setDoFValue(DOF.EX, _euler.x);
      this._worldJoint.setDoFValue(DOF.EY, _euler.y);
      this._worldJoint.setDoFValue(DOF.EZ, _euler.z);
      this._worldJoint.setMatrixDoFNeedsUpdate();
    }

    this.ikRoot.updateMatrixWorld(true);
  }

  _lockJointAtCurrent(joint) {
    if (!joint?.dof?.length) return;
    for (const dof of joint.dof) {
      const v = joint.getDoFValue(dof);
      joint.setMinLimit(dof, v);
      joint.setMaxLimit(dof, v);
    }
  }

  /**
   * 锁定 __world_joint__ 与非本链关节。
   * 人形全链共享 pelvis/world，不锁会导致解一条腿时带动全身。
   */
  _prepareIkTreeForSolve() {
    const chainSet = new Set(this.chainJointNames);

    if (this._worldJoint) {
      this._lockJointAtCurrent(this._worldJoint);
    }

    this.ikRoot?.traverse((c) => {
      if (!c.isJoint || c.name === '__world_joint__') return;
      if (!chainSet.has(c.name)) {
        this._lockJointAtCurrent(c);
      }
    });
  }

  verifyKinematicsLoop(robot) {
    return verifyIkKinematicsLoop(robot, this);
  }

  /** Goal 目标必须用世界坐标 API（THREE 世界系 → Goal 世界系） */
  _setGoalTarget(position, quaternion, options = {}) {
    if (options.positionOnly) {
      this.goal.setGoalDoF(DOF.X, DOF.Y, DOF.Z);
      this.goal.setWorldPosition(position.x, position.y, position.z);
    } else if (options.rotationOnly) {
      this.goal.setGoalDoF(DOF.EX, DOF.EY, DOF.EZ);
      this.goal.setWorldPosition(position.x, position.y, position.z);
      this.goal.setWorldQuaternion(
        quaternion.x, quaternion.y, quaternion.z, quaternion.w
      );
    } else {
      this.goal.setGoalDoF(DOF.X, DOF.Y, DOF.Z, DOF.EX, DOF.EY, DOF.EZ);
      this.goal.setWorldPosition(position.x, position.y, position.z);
      this.goal.setWorldQuaternion(
        quaternion.x, quaternion.y, quaternion.z, quaternion.w
      );
    }
    this.goal.updateMatrixWorld(true);
  }

  /** IK closure link 世界坐标，用于诊断 URDF↔IK 同步 */
  captureIkClosureWorldPose() {
    if (!this.closureLink) return null;
    this.closureLink.updateMatrixWorld(true);
    this.closureLink.getWorldPosition(_pos);
    this.closureLink.getWorldQuaternion(_quat);
    return {
      position: _pos.clone(),
      quaternion: _quat.clone()
    };
  }

  captureChainJointAngles(robot) {
    const out = {};
    for (const name of this.chainJointNames) {
      out[name] = robot.joints[name]?.angle ?? 0;
    }
    return out;
  }

  captureEeFk(robot) {
    const link = robot.links?.[this.endEffectorLinkName];
    if (!link) return null;
    link.getWorldPosition(_pos);
    link.getWorldQuaternion(_quat);
    return {
      position: _pos.clone(),
      quaternion: _quat.clone()
    };
  }

  solve(robot, position, quaternion, options = {}) {
    if (!this.solver || !this.goal || !this.ikRoot) {
      return { success: false, error: 'IK not initialized' };
    }

    const errBeforeSolve = this._estimateError(robot, position, quaternion, options);

    const saved = this._snapshotSolverSettings();
    this._applySolverOptions(options);

    this._syncRobotToIk(robot);
    this._prepareIkTreeForSolve();
    this._setGoalTarget(position, quaternion, options);

    const ikFkBefore = this.captureIkClosureWorldPose();
    const status = this.solver.solve();
    this.ikRoot.updateMatrixWorld(true);
    const ikFkAfter = this.captureIkClosureWorldPose();

    applyAllIkJointsToUrdf(robot, this.ikRoot);
    const loopAfterWriteback = measureUrdfIkFkDeltaMm(robot, this, this.endEffectorLinkName);
    const jointLoop = compareChainJointAngles(robot, this.ikRoot, this.chainJointNames);

    this._restoreSolverSettings(saved);

    const err = this._estimateError(robot, position, quaternion, options);
    const success = this._checkSuccess(err, options);

    return {
      success,
      status,
      statusLabel: formatSolverStatus(status),
      error: err,
      errorBefore: errBeforeSolve,
      ikFkBefore,
      ikFkAfter,
      loopDeltaMm: loopAfterWriteback.deltaMm,
      loopUrdfAfter: loopAfterWriteback.urdf,
      loopIkAfter: loopAfterWriteback.ik,
      loopMaxJointDeltaRad: jointLoop.maxDeltaRad
    };
  }

  solveToConvergence(robot, position, quaternion, options = {}) {
    if (!this.solver || !this.goal || !this.ikRoot) {
      return { success: false, error: 'IK not initialized', passes: 0 };
    }

    const posTol = options.convergedPositionTolerance ?? options.positionTolerance ?? 0.002;
    const rotTol = options.rotationConvergeThreshold ?? options.rotationTolerance ?? 0.025;
    const maxPasses = options.maxPasses ?? 48;
    const positionOnly = !!options.positionOnly;

    const saved = this._snapshotSolverSettings();
    this._applySolverOptions({
      ...options,
      maxIterations: options.maxIterations ?? 32,
      dampingFactor: options.dampingFactor ?? 0.002,
      translationFactor: options.translationFactor ?? 1,
      rotationFactor: options.rotationFactor ?? 0.012,
      convergedPositionTolerance: posTol
    });
    this.solver.stallThreshold = options.stallThreshold ?? 0;

    let status = null;
    let statusLabel = '';
    let err = { position: Infinity, rotation: Infinity };
    let passesUsed = 0;

    for (let pass = 0; pass < maxPasses; pass++) {
      passesUsed = pass + 1;
      this._syncRobotToIk(robot);
      this._prepareIkTreeForSolve();
      this._setGoalTarget(position, quaternion, { ...options, positionOnly });

      status = this.solver.solve();
      statusLabel = formatSolverStatus(status);

      applyAllIkJointsToUrdf(robot, this.ikRoot);

      err = this._estimateError(robot, position, quaternion, { positionOnly });
      if (positionOnly) {
        if (err.position < posTol) break;
      } else if (err.position < posTol && err.rotation < rotTol) {
        break;
      }
    }

    this._restoreSolverSettings(saved);

    const success = positionOnly
      ? err.position < posTol
      : err.position < posTol && err.rotation < rotTol;
    return { success, status, statusLabel, error: err, passes: passesUsed };
  }

  _checkSuccess(err, options = {}) {
    const posTol = options.convergedPositionTolerance ?? 0.004;
    const rotTol = options.rotationConvergeThreshold ?? 0.05;

    if (options.orientationSoft) {
      // 软约束：不要求姿态到达，只要求位置未明显漂移
      return err.position < Math.max(posTol, 0.03);
    }
    if (options.positionOnly) {
      return err.position < Math.max(posTol, 0.03);
    }
    if (options.rotationOnly) {
      return err.rotation < rotTol;
    }
    return err.position < posTol && err.rotation < rotTol;
  }

  _snapshotJointsOutsideChain(robot) {
    const snap = new Map();
    const chainSet = new Set(this.chainJointNames);
    for (const name of Object.keys(robot.joints || {})) {
      if (!chainSet.has(name)) {
        snap.set(name, robot.joints[name].angle);
      }
    }
    return snap;
  }

  _snapshotBase(robot) {
    return {
      position: robot.position.clone(),
      quaternion: robot.quaternion.clone()
    };
  }

  _restoreJoints(robot, snap) {
    for (const [name, angle] of snap) {
      if (robot.joints[name]) {
        robot.setJointValue(name, angle);
      }
    }
  }

  _restoreBase(robot, base) {
    robot.position.copy(base.position);
    robot.quaternion.copy(base.quaternion);
  }

  _estimateError(robot, targetPos, targetQuat, options = {}) {
    const link = robot.links?.[this.endEffectorLinkName];
    if (!link) return { position: Infinity, rotation: Infinity };

    link.getWorldPosition(_pos);
    link.getWorldQuaternion(_quat);

    let position = _pos.distanceTo(targetPos);
    let rotation = _quat.angleTo(targetQuat);

    if (options.positionOnly) {
      rotation = 0;
    } else if (options.rotationOnly) {
      position = 0;
    }

    return { position, rotation };
  }
}
