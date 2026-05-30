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

    setIKFromUrdf(this.ikRoot, robot);

    this.goal.setPosition(position.x, position.y, position.z);
    if (options.positionOnly) {
      this.goal.setGoalDoF(DOF.X, DOF.Y, DOF.Z);
    } else {
      this.goal.setGoalDoF(DOF.X, DOF.Y, DOF.Z, DOF.EX, DOF.EY, DOF.EZ);
      this.goal.setQuaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    }

    const status = this.solver.solve();
    setUrdfFromIK(robot, this.ikRoot);

    this._restoreJoints(robot, lockedJoints);
    this._restoreBase(robot, lockedBase);

    robot.updateMatrixWorld(true);

    const err = this._estimateError(robot, position, quaternion, options.positionOnly);
    const success = err.position < 0.025 && (options.positionOnly || err.rotation < 0.2);

    return { success, status, error: err };
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

  _estimateError(robot, targetPos, targetQuat, positionOnly) {
    const link = robot.links?.[this.endEffectorLinkName];
    if (!link) return { position: Infinity, rotation: Infinity };

    link.getWorldPosition(_pos);
    link.getWorldQuaternion(_quat);

    const position = _pos.distanceTo(targetPos);
    let rotation = 0;
    if (!positionOnly) {
      rotation = _quat.angleTo(targetQuat);
    }
    return { position, rotation };
  }
}
