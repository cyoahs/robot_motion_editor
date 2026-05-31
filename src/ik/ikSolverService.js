import * as THREE from 'three';
import { Solver } from 'closed-chain-ik/src/core/Solver.js';
import { Goal } from 'closed-chain-ik/src/core/Goal.js';
import { DOF } from 'closed-chain-ik/src/core/Joint.js';
import {
  setIKFromUrdf,
  setUrdfFromIK,
  urdfRobotToIKRoot
} from 'closed-chain-ik/src/three/urdfHelpers.js';
import { findIKLinkByName } from './ikSolverUtils.js';

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();

const DEFAULT_TRANS_FACTOR = 1;
const DEFAULT_ROT_FACTOR = 1;

/** 调位置：软混合时位置仍占主导，姿态仅轻微趋近参考 */
export const POSITION_HOLD_TRANS_FACTOR = 80;
export const POSITION_SOFT_ROT_FACTOR = 0.012;

/** 调姿态：位置尽量不变，姿态软趋近（允许较大姿态误差） */
export const ORIENTATION_HOLD_TRANS_FACTOR = 280;
export const ORIENTATION_HOLD_ROT_FACTOR = 0.01;

export class IkSolverService {
  constructor() {
    this.ikRoot = null;
    this.solver = null;
    this.goal = null;
    this.closureLink = null;
    this.chainJointNames = [];
    this.endEffectorLinkName = '';
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
      this.chainJointNames = chainJointNames || [];

      this.ikRoot = urdfRobotToIKRoot(robot, false);
      if (!this.ikRoot) return false;

      setIKFromUrdf(this.ikRoot, robot);

      this.closureLink = findIKLinkByName(this.ikRoot, endEffectorLinkName);
      if (!this.closureLink) {
        console.warn('IK: link not found in IK tree', endEffectorLinkName);
        return false;
      }

      this.goal = new Goal();
      this.goal.makeClosure(this.closureLink);

      this.solver = new Solver(this.ikRoot);
      this.solver.maxIterations = 8;
      this.solver.dampingFactor = 0.01;
      this.solver.translationFactor = DEFAULT_TRANS_FACTOR;
      this.solver.rotationFactor = DEFAULT_ROT_FACTOR;

      return true;
    } catch (err) {
      console.error('IK rebuild failed:', err);
      this.dispose();
      return false;
    }
  }

  solve(robot, position, quaternion, options = {}) {
    if (!this.solver || !this.goal || !this.ikRoot) {
      return { success: false, error: 'IK not initialized' };
    }

    const lockedJoints = this.chainJointNames.length > 0
      ? this._snapshotJointsOutsideChain(robot)
      : new Map();
    const lockedBase = this._snapshotBase(robot);

    const savedIter = this.solver.maxIterations;
    const savedTrans = this.solver.translationFactor;
    const savedRot = this.solver.rotationFactor;

    if (options.maxIterations != null) {
      this.solver.maxIterations = options.maxIterations;
    }
    if (options.translationFactor != null) {
      this.solver.translationFactor = options.translationFactor;
    }
    if (options.rotationFactor != null) {
      this.solver.rotationFactor = options.rotationFactor;
    }

    const passes = Math.max(1, options.solvePasses || 1);
    let status = null;

    for (let pass = 0; pass < passes; pass++) {
      setIKFromUrdf(this.ikRoot, robot);

      this.goal.setPosition(position.x, position.y, position.z);
      if (options.positionOnly) {
        this.goal.setGoalDoF(DOF.X, DOF.Y, DOF.Z);
      } else if (options.rotationOnly) {
        this.goal.setGoalDoF(DOF.EX, DOF.EY, DOF.EZ);
        this.goal.setQuaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
      } else {
        this.goal.setGoalDoF(DOF.X, DOF.Y, DOF.Z, DOF.EX, DOF.EY, DOF.EZ);
        this.goal.setQuaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
      }

      status = this.solver.solve();
      setUrdfFromIK(robot, this.ikRoot);
    }

    this.solver.maxIterations = savedIter;
    this.solver.translationFactor = savedTrans;
    this.solver.rotationFactor = savedRot;

    this._restoreJoints(robot, lockedJoints);
    this._restoreBase(robot, lockedBase);

    robot.updateMatrixWorld(true);

    const err = this._estimateError(robot, position, quaternion);
    const success = this._checkSuccess(err, options);

    return { success, status, error: err };
  }

  /**
   * 反复求解直至位姿误差低于阈值（用于重置等需一次到位的场景）
   */
  solveToConvergence(robot, position, quaternion, options = {}) {
    if (!this.solver || !this.goal || !this.ikRoot) {
      return { success: false, error: 'IK not initialized', passes: 0 };
    }

    const posTol = options.positionTolerance ?? 0.002;
    const rotTol = options.rotationTolerance ?? 0.025;
    const maxPasses = options.maxPasses ?? 48;

    const lockedJoints = this.chainJointNames.length > 0
      ? this._snapshotJointsOutsideChain(robot)
      : new Map();
    const lockedBase = this._snapshotBase(robot);

    const saved = {
      maxIterations: this.solver.maxIterations,
      dampingFactor: this.solver.dampingFactor,
      translationFactor: this.solver.translationFactor,
      rotationFactor: this.solver.rotationFactor,
      stallThreshold: this.solver.stallThreshold
    };

    this.solver.maxIterations = options.maxIterations ?? 32;
    this.solver.dampingFactor = options.dampingFactor ?? 0.002;
    this.solver.translationFactor = 1;
    this.solver.rotationFactor = 1;
    this.solver.stallThreshold = 0;

    this.goal.setPosition(position.x, position.y, position.z);
    this.goal.setGoalDoF(DOF.X, DOF.Y, DOF.Z, DOF.EX, DOF.EY, DOF.EZ);
    this.goal.setQuaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

    let status = null;
    let err = { position: Infinity, rotation: Infinity };
    let passesUsed = 0;

    for (let pass = 0; pass < maxPasses; pass++) {
      passesUsed = pass + 1;
      setIKFromUrdf(this.ikRoot, robot);
      status = this.solver.solve();
      setUrdfFromIK(robot, this.ikRoot);
      this._restoreJoints(robot, lockedJoints);
      this._restoreBase(robot, lockedBase);
      robot.updateMatrixWorld(true);

      err = this._estimateError(robot, position, quaternion);
      if (err.position < posTol && err.rotation < rotTol) {
        break;
      }
    }

    this.solver.maxIterations = saved.maxIterations;
    this.solver.dampingFactor = saved.dampingFactor;
    this.solver.translationFactor = saved.translationFactor;
    this.solver.rotationFactor = saved.rotationFactor;
    this.solver.stallThreshold = saved.stallThreshold;

    const success = err.position < posTol && err.rotation < rotTol;
    return { success, status, error: err, passes: passesUsed };
  }

  /** 先解位置，再多次锁姿态（姿态参考固定为 holdQuat） */
  solveHoldOrientation(robot, position, holdQuat, options = {}) {
    const iter = options.maxIterations ?? 18;
    const cycles = options.holdCycles ?? 3;
    for (let c = 0; c < cycles; c++) {
      this.solve(robot, position, holdQuat, { positionOnly: true, maxIterations: iter });
      for (let i = 0; i < 3; i++) {
        this.solve(robot, position, holdQuat, { rotationOnly: true, maxIterations: iter });
      }
    }
    const err = this._estimateError(robot, position, holdQuat);
    return {
      success: err.position < 0.04 && err.rotation < 0.05,
      error: err
    };
  }

  /**
   * 调姿态：6DOF 联合求解，translationFactor >> rotationFactor，全程锁定 refPosition。
   * 不用 rotationOnly（该模式会从误差向量中剔除位置，导致足端漂移）。
   */
  solveOrientationHoldPosition(robot, refPosition, targetQuat, options = {}) {
    const iter = options.maxIterations ?? 20;
    const passes = options.solvePasses ?? 4;
    const transW = options.translationFactor ?? ORIENTATION_HOLD_TRANS_FACTOR;
    const rotW = options.rotationFactor ?? ORIENTATION_HOLD_ROT_FACTOR;

    const weighted = {
      translationFactor: transW,
      rotationFactor: rotW,
      maxIterations: iter,
      orientationHoldPosition: true,
      solvePasses: 1
    };

    // 6DOF 软姿态趋近 + 强位置权重
    for (let i = 0; i < passes; i++) {
      this.solve(robot, refPosition, targetQuat, weighted);
    }

    // 末尾纯位置收紧，确保 XYZ 贴近锁点
    for (let i = 0; i < 3; i++) {
      this.solve(robot, refPosition, targetQuat, {
        positionOnly: true,
        maxIterations: iter
      });
    }

    const err = this._estimateError(robot, refPosition, targetQuat);
    return {
      success: err.position < (options.positionTolerance ?? 0.006),
      error: err
    };
  }

  /**
   * 调位置：强力跟随 gizmo 目标，姿态软约束（不修改姿态参考）。
   * 策略：先纯位置收敛，再姿态软混合，最后两次纯位置补偿，确保位置尽量接近目标。
   */
  solveHoldPositionSoftOrientation(robot, targetPos, refQuat, options = {}) {
    const iter = options.maxIterations ?? 16;
    const transW = options.translationFactor ?? POSITION_HOLD_TRANS_FACTOR;
    const rotW = options.rotationFactor ?? POSITION_SOFT_ROT_FACTOR;

    // 纯位置：优先贴近 gizmo
    for (let i = 0; i < 2; i++) {
      this.solve(robot, targetPos, refQuat, { positionOnly: true, maxIterations: iter });
    }
    // 单次软姿态趋近（姿态权重极小，位置仍占主导）
    this.solve(robot, targetPos, refQuat, {
      translationFactor: transW,
      rotationFactor: rotW,
      maxIterations: iter,
      positionSoftOrientation: true
    });
    // 纯位置补偿
    for (let i = 0; i < 3; i++) {
      this.solve(robot, targetPos, refQuat, { positionOnly: true, maxIterations: iter });
    }

    const err = this._estimateError(robot, targetPos, refQuat);
    return {
      success: err.position < 0.04,
      error: err
    };
  }

  _checkSuccess(err, options) {
    if (options.orientationHoldPosition) {
      return err.position < (options.positionTolerance ?? 0.006);
    }
    if (options.orientationSoft || options.positionSoftOrientation) {
      return err.position < 0.04;
    }
    if (options.positionOnly) {
      return err.position < 0.03;
    }
    if (options.rotationOnly) {
      return err.rotation < 0.25;
    }
    const t = options.translationFactor ?? DEFAULT_TRANS_FACTOR;
    const r = options.rotationFactor ?? DEFAULT_ROT_FACTOR;
    if (t >= r * 3) {
      return err.position < 0.03;
    }
    if (r >= t * 3) {
      return err.rotation < 0.25;
    }
    return err.position < 0.03 && err.rotation < 0.3;
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

  _estimateError(robot, targetPos, targetQuat) {
    const link = robot.links?.[this.endEffectorLinkName];
    if (!link) return { position: Infinity, rotation: Infinity };

    link.getWorldPosition(_pos);
    link.getWorldQuaternion(_quat);

    const position = _pos.distanceTo(targetPos);
    const rotation = _quat.angleTo(targetQuat);
    return { position, rotation };
  }
}
