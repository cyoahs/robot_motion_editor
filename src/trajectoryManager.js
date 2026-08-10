import * as THREE from 'three';
import { i18n } from './i18n.js';
import {
  DEFAULT_FPS_BY_FORMAT,
  TRAJECTORY_FORMATS,
  exportTrajectoryCSV,
  normalizeTrajectoryFormat,
  parseTrajectoryCSV
} from './trajectoryFormatConverter.js';

/**
 * Validate the single clock shared by the independently editable robot and
 * scene tracks. Empty managers are ignored because a model may not have been
 * loaded yet; every non-empty manager must use exactly the same frame count
 * and FPS.
 */
export function assertSharedTimelineInvariant(managers, declaredTimeline = null) {
  const activeManagers = (Array.isArray(managers) ? managers : [])
    .filter(manager => manager?.hasTrajectory?.());

  const validateTimeline = (timeline, label) => {
    if (!timeline || typeof timeline !== 'object' || Array.isArray(timeline)) {
      throw new TypeError(`${label} 必须包含 frameCount 和 fps`);
    }

    const { frameCount, fps } = timeline;
    if (!Number.isInteger(frameCount) || frameCount <= 0) {
      throw new RangeError(`${label}.frameCount 必须是正整数`);
    }
    if (!Number.isFinite(fps) || fps <= 0) {
      throw new RangeError(`${label}.fps 必须是大于 0 的有限数值`);
    }

    return { frameCount, fps };
  };

  let sharedTimeline = declaredTimeline === null || declaredTimeline === undefined
    ? null
    : validateTimeline(declaredTimeline, '共享时间轴');

  if (!sharedTimeline && activeManagers.length > 0) {
    sharedTimeline = validateTimeline({
      frameCount: activeManagers[0].getFrameCount(),
      fps: activeManagers[0].fps
    }, '轨迹时间轴');
  }

  if (!sharedTimeline) return null;

  activeManagers.forEach((manager, index) => {
    const actual = validateTimeline({
      frameCount: manager.getFrameCount(),
      fps: manager.fps
    }, `第 ${index + 1} 条轨迹时间轴`);
    if (actual.frameCount !== sharedTimeline.frameCount || actual.fps !== sharedTimeline.fps) {
      throw new Error(
        `机器人与场景轨迹的帧数/FPS必须一致：期望 ${sharedTimeline.frameCount} 帧 @ ` +
        `${sharedTimeline.fps} FPS，实际 ${actual.frameCount} 帧 @ ${actual.fps} FPS`
      );
    }
  });

  return sharedTimeline;
}

/**
 * 轨迹管理器 - 管理基础轨迹和关键帧残差
 * 
 * 数据结构说明：
 * - baseTrajectory: Array<{ base: BaseState, joints: number[] }>
 *   base: { position: {x,y,z}, quaternion: {x,y,z,w} }
 * 
 * - keyframes: Map<frameIndex, KeyframeData>
 *   KeyframeData: { residual: number[], baseResidual: BaseResidual | null }
 *   residual: 关节角度残差数组
 *   baseResidual: { position: {x,y,z}, quaternion: {x,y,z,w} } 或 null
 */
export class TrajectoryManager {
  constructor() {
    this.baseTrajectory = [];  // CSV 加载的基础轨迹
    this.keyframes = new Map(); // 关键帧残差: frameIndex -> { residual, baseResidual }
    // 轨迹级固定关节覆盖。键是关节索引，值是整个轨迹中使用的固定值。
    // 使用普通对象，确保工程数据可以直接 JSON 序列化。
    this.fixedJointValues = {};
    this.jointCount = 0;
    this.originalFileName = ''; // 原始CSV文件名
    this.fps = 50; // 默认帧率
    this.interpolationMode = 'linear'; // 插值模式: 'linear' 或 'bezier'
    this.sourceFormat = TRAJECTORY_FORMATS.UNITREE;
    this.seedHeader = null;
    this.seedJointColumns = [];
  }

  parseCSV(csvText, fileName = '') {
    const parsed = parseTrajectoryCSV(csvText, fileName);

    this.validateCSVInput(csvText, parsed.format);
    this.validateTrajectory(parsed.baseTrajectory, parsed.jointCount, false);

    this.baseTrajectory = parsed.baseTrajectory;
    this.keyframes.clear();
    this.fixedJointValues = {};
    this.jointCount = parsed.jointCount;
    this.originalFileName = fileName;
    this.sourceFormat = parsed.format;
    this.seedHeader = parsed.metadata.seedHeader;
    this.seedJointColumns = parsed.metadata.seedJointColumns || [];
    this.fps = parsed.fps || DEFAULT_FPS_BY_FORMAT[this.sourceFormat] || 50;

    console.log('解析 CSV:', this.baseTrajectory.length, '帧,', this.jointCount, '个关节, 格式:', this.sourceFormat);
  }

  resolveExportFormat(format = 'source') {
    if (format === 'source') {
      return this.sourceFormat || TRAJECTORY_FORMATS.UNITREE;
    }

    return normalizeTrajectoryFormat(format);
  }

  hasTrajectory() {
    return this.baseTrajectory.length > 0;
  }

  getKeyframes() {
    // 返回所有关键帧的数组，按帧号排序
    return Array.from(this.keyframes.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([frame, data]) => ({
        frame,
        residual: data.residual,
        baseResidual: data.baseResidual
      }));
  }

  getFrameCount() {
    return this.baseTrajectory.length;
  }

  getDuration() {
    // 使用设置的 FPS
    return this.baseTrajectory.length / (this.fps || 50);
  }

  setFPS(fps) {
    if (!Number.isFinite(fps) || fps <= 0) {
      throw new RangeError('FPS 必须是大于 0 的有限数值');
    }
    this.fps = fps;
  }

  /**
   * 创建一条基体位置和关节值均为 0、基体姿态为单位四元数的轨迹。
   */
  createZeroTrajectory(frameCount, jointCount, fps = 50, fileName = '') {
    this.validatePositiveInteger(frameCount, 'frameCount');
    this.validateNonNegativeInteger(jointCount, 'jointCount');
    if (!Number.isFinite(fps) || fps <= 0) {
      throw new RangeError('fps 必须是大于 0 的有限数值');
    }
    if (typeof fileName !== 'string') {
      throw new TypeError('fileName 必须是字符串');
    }

    this.baseTrajectory = Array.from({ length: frameCount }, () => this.createZeroState(jointCount));
    this.keyframes.clear();
    this.fixedJointValues = {};
    this.jointCount = jointCount;
    this.originalFileName = fileName;
    this.fps = fps;
    this.sourceFormat = TRAJECTORY_FORMATS.UNITREE;
    this.seedHeader = null;
    this.seedJointColumns = [];

    return this.getFrameCount();
  }

  /**
   * 修改轨迹帧数。扩展时克隆原末帧，缩短时删除越界关键帧。
   */
  resizeTrajectory(frameCount) {
    this.validatePositiveInteger(frameCount, 'frameCount');
    if (!this.hasTrajectory()) {
      throw new Error('没有可调整长度的轨迹');
    }

    const currentFrameCount = this.baseTrajectory.length;
    if (frameCount < currentFrameCount) {
      this.baseTrajectory.length = frameCount;
    } else if (frameCount > currentFrameCount) {
      const lastState = this.baseTrajectory[currentFrameCount - 1];
      for (let index = currentFrameCount; index < frameCount; index++) {
        this.baseTrajectory.push(this.cloneTrajectoryState(lastState));
      }
    }

    for (const keyframeIndex of this.keyframes.keys()) {
      if (keyframeIndex >= frameCount) {
        this.keyframes.delete(keyframeIndex);
      }
    }

    return this.getFrameCount();
  }

  setFixedJoint(index, value) {
    this.validateJointIndex(index);
    if (!Number.isFinite(value)) {
      throw new TypeError('固定关节值必须是有限数值');
    }

    this.fixedJointValues[index] = value;
    return value;
  }

  clearFixedJoint(index) {
    if (!this.isValidJointIndex(index)) {
      return false;
    }
    const existed = this.isJointFixed(index);
    delete this.fixedJointValues[index];
    return existed;
  }

  isJointFixed(index) {
    return this.isValidJointIndex(index) &&
      Object.prototype.hasOwnProperty.call(this.fixedJointValues, index);
  }

  getFixedJointValue(index) {
    return this.isJointFixed(index) ? this.fixedJointValues[index] : null;
  }

  clearAllFixedJoints() {
    this.fixedJointValues = {};
  }

  getBaseState(frameIndex) {
    if (frameIndex < 0 || frameIndex >= this.baseTrajectory.length) {
      return null;
    }
    return this.baseTrajectory[frameIndex];
  }

  getInterpolatedBaseState(framePosition) {
    if (this.baseTrajectory.length === 0) {
      return null;
    }

    const clampedFrame = Math.max(0, Math.min(framePosition, this.baseTrajectory.length - 1));
    const prevIndex = Math.floor(clampedFrame);
    const nextIndex = Math.ceil(clampedFrame);

    if (prevIndex === nextIndex) {
      return this.cloneTrajectoryState(this.baseTrajectory[prevIndex]);
    }

    const t = clampedFrame - prevIndex;
    const prevState = this.baseTrajectory[prevIndex];
    const nextState = this.baseTrajectory[nextIndex];
    const qPrev = new THREE.Quaternion(
      prevState.base.quaternion.x,
      prevState.base.quaternion.y,
      prevState.base.quaternion.z,
      prevState.base.quaternion.w
    );
    const qNext = new THREE.Quaternion(
      nextState.base.quaternion.x,
      nextState.base.quaternion.y,
      nextState.base.quaternion.z,
      nextState.base.quaternion.w
    );
    const qInterpolated = qPrev.clone().slerp(qNext, t).normalize();

    return {
      base: {
        position: {
          x: prevState.base.position.x + (nextState.base.position.x - prevState.base.position.x) * t,
          y: prevState.base.position.y + (nextState.base.position.y - prevState.base.position.y) * t,
          z: prevState.base.position.z + (nextState.base.position.z - prevState.base.position.z) * t
        },
        quaternion: {
          x: qInterpolated.x,
          y: qInterpolated.y,
          z: qInterpolated.z,
          w: qInterpolated.w
        }
      },
      joints: prevState.joints.map((prevValue, idx) => {
        const nextValue = nextState.joints[idx] ?? prevValue;
        return prevValue + (nextValue - prevValue) * t;
      })
    };
  }

  getCombinedState(frameIndex) {
    const baseState = this.getBaseState(frameIndex);
    if (!baseState) {
      return null;
    }

    return this.applyResidualsToState(baseState, frameIndex);
  }

  getCombinedStateAtFrame(framePosition) {
    const baseState = this.getInterpolatedBaseState(framePosition);
    if (!baseState) {
      return null;
    }

    return this.applyResidualsToState(baseState, framePosition);
  }

  applyResidualsToState(baseState, frameIndex) {
    // 获取关键帧残差
    const residual = this.getInterpolatedResidual(frameIndex);
    const baseResidual = this.getInterpolatedBaseResidual(frameIndex);
    
    // 叠加 base 和 residual
    const combinedJoints = baseState.joints.map((baseValue, idx) => {
      return baseValue + (residual[idx] || 0);
    });

    // 叠加基体残差
    let combinedBase = {
      position: { ...baseState.base.position },
      quaternion: { ...baseState.base.quaternion }
    };
    
    if (baseResidual) {
      // 位置直接相加
      combinedBase.position.x += baseResidual.position.x;
      combinedBase.position.y += baseResidual.position.y;
      combinedBase.position.z += baseResidual.position.z;
      
      // 四元数使用乘法（正确的旋转组合方式）
      const qBase = new THREE.Quaternion(
        baseState.base.quaternion.x,
        baseState.base.quaternion.y,
        baseState.base.quaternion.z,
        baseState.base.quaternion.w
      );
      const qResidual = new THREE.Quaternion(
        baseResidual.quaternion.x,
        baseResidual.quaternion.y,
        baseResidual.quaternion.z,
        baseResidual.quaternion.w
      );
      
      // q_combined = q_base * q_residual（使用clone避免修改qBase）
      const qCombined = qBase.clone().multiply(qResidual);
      
      // 确保归一化
      qCombined.normalize();
      
      combinedBase.quaternion = {
        x: qCombined.x,
        y: qCombined.y,
        z: qCombined.z,
        w: qCombined.w
      };
    }

    // 固定关节是最终输出约束，优先级高于基础轨迹和关键帧残差。
    Object.entries(this.fixedJointValues).forEach(([indexText, value]) => {
      const index = Number(indexText);
      if (Number.isInteger(index) && index >= 0 && index < combinedJoints.length && Number.isFinite(value)) {
        combinedJoints[index] = value;
      }
    });

    return {
      base: combinedBase,
      joints: combinedJoints
    };
  }

  cloneTrajectoryState(state) {
    return {
      base: {
        position: { ...state.base.position },
        quaternion: { ...state.base.quaternion }
      },
      joints: [...state.joints]
    };
  }

  createZeroState(jointCount = this.jointCount) {
    this.validateNonNegativeInteger(jointCount, 'jointCount');
    return {
      base: {
        position: { x: 0, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 }
      },
      joints: new Array(jointCount).fill(0)
    };
  }

  validatePositiveInteger(value, name) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new RangeError(`${name} 必须是大于 0 的整数`);
    }
  }

  validateNonNegativeInteger(value, name) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`${name} 必须是大于等于 0 的整数`);
    }
  }

  validateJointIndex(index) {
    if (!Number.isInteger(index)) {
      throw new TypeError('关节索引必须是整数');
    }
    if (index < 0 || index >= this.jointCount) {
      throw new RangeError(`关节索引超出范围: ${index}`);
    }
  }

  isValidJointIndex(index) {
    return Number.isInteger(index) && index >= 0 && index < this.jointCount;
  }

  validateTrajectory(trajectory, jointCount, allowEmpty = true) {
    if (!Array.isArray(trajectory)) {
      throw new TypeError('轨迹必须是数组');
    }
    this.validateNonNegativeInteger(jointCount, 'jointCount');
    if (!allowEmpty && trajectory.length === 0) {
      throw new Error('轨迹不包含有效帧');
    }

    trajectory.forEach((state, frameIndex) => {
      if (!state || !state.base || !state.base.position || !state.base.quaternion || !Array.isArray(state.joints)) {
        throw new TypeError(`轨迹第 ${frameIndex} 帧结构无效`);
      }
      if (state.joints.length !== jointCount) {
        throw new Error(`轨迹第 ${frameIndex} 帧关节数量不一致: 期望 ${jointCount}，实际 ${state.joints.length}`);
      }

      const values = [
        state.base.position.x,
        state.base.position.y,
        state.base.position.z,
        state.base.quaternion.x,
        state.base.quaternion.y,
        state.base.quaternion.z,
        state.base.quaternion.w,
        ...state.joints
      ];
      if (!values.every(Number.isFinite)) {
        throw new TypeError(`轨迹第 ${frameIndex} 帧包含非有限数值`);
      }
    });
  }

  buildProjectCandidate(projectData) {
    if (!projectData || typeof projectData !== 'object' || Array.isArray(projectData)) {
      throw new TypeError('工程数据必须是对象');
    }

    const jointCount = projectData.jointCount === undefined ? 0 : projectData.jointCount;
    this.validateNonNegativeInteger(jointCount, 'jointCount');

    const baseTrajectory = projectData.baseTrajectory === undefined
      ? []
      : projectData.baseTrajectory;
    this.validateTrajectory(baseTrajectory, jointCount, true);

    const fps = projectData.fps === undefined ? 50 : projectData.fps;
    if (!Number.isFinite(fps) || fps <= 0) {
      throw new RangeError('工程 FPS 必须是大于 0 的有限数值');
    }

    const interpolationMode = projectData.interpolationMode === undefined
      ? 'linear'
      : projectData.interpolationMode;
    if (interpolationMode !== 'linear' && interpolationMode !== 'bezier') {
      throw new TypeError(`无效的工程插值模式: ${interpolationMode}`);
    }

    const keyframes = projectData.keyframes === undefined ? [] : projectData.keyframes;
    if (!Array.isArray(keyframes)) {
      throw new TypeError('工程 keyframes 必须是数组');
    }

    const candidateKeyframes = new Map();
    const seenFrameIndices = new Set();
    keyframes.forEach((keyframe, keyframeIndex) => {
      if (!keyframe || typeof keyframe !== 'object' || Array.isArray(keyframe)) {
        throw new TypeError(`工程第 ${keyframeIndex} 个关键帧结构无效`);
      }

      const frameIndex = keyframe.frameIndex;
      if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= baseTrajectory.length) {
        throw new RangeError(`工程关键帧索引超出范围: ${frameIndex}`);
      }
      if (seenFrameIndices.has(frameIndex)) {
        throw new Error(`工程包含重复关键帧索引: ${frameIndex}`);
      }
      seenFrameIndices.add(frameIndex);

      if (!Array.isArray(keyframe.residual) || keyframe.residual.length !== jointCount) {
        throw new TypeError(`工程关键帧 ${frameIndex} 的 residual 必须是长度为 ${jointCount} 的数组`);
      }
      if (!keyframe.residual.every(Number.isFinite)) {
        throw new TypeError(`工程关键帧 ${frameIndex} 的 residual 必须全部是有限数值`);
      }

      let baseResidual = null;
      if (keyframe.baseResidual !== null && keyframe.baseResidual !== undefined) {
        const position = keyframe.baseResidual.position;
        const quaternion = keyframe.baseResidual.quaternion;
        const baseResidualValues = position && quaternion ? [
          position.x,
          position.y,
          position.z,
          quaternion.x,
          quaternion.y,
          quaternion.z,
          quaternion.w
        ] : [];
        if (baseResidualValues.length !== 7 || !baseResidualValues.every(Number.isFinite)) {
          throw new TypeError(`工程关键帧 ${frameIndex} 的 baseResidual 必须包含有限数值的 position 和 quaternion`);
        }
        baseResidual = {
          position: { x: position.x, y: position.y, z: position.z },
          quaternion: {
            x: quaternion.x,
            y: quaternion.y,
            z: quaternion.z,
            w: quaternion.w
          }
        };
      }

      candidateKeyframes.set(frameIndex, {
        residual: [...keyframe.residual],
        baseResidual
      });
    });

    const fixedJointValues = {};
    if (projectData.fixedJointValues !== null && projectData.fixedJointValues !== undefined) {
      const fixedEntries = Array.isArray(projectData.fixedJointValues)
        ? projectData.fixedJointValues.map((value, index) => [index, value])
        : Object.entries(projectData.fixedJointValues);

      fixedEntries.forEach(([rawIndex, value]) => {
        const index = Number(rawIndex);
        if (value === null || value === undefined) {
          return;
        }
        if (!Number.isInteger(index) || index < 0 || index >= jointCount || !Number.isFinite(value)) {
          console.warn('忽略无效的固定关节工程数据:', rawIndex, value);
          return;
        }
        fixedJointValues[index] = value;
      });
    }

    const originalFileName = projectData.originalFileName === undefined || projectData.originalFileName === null
      ? ''
      : projectData.originalFileName;
    if (typeof originalFileName !== 'string') {
      throw new TypeError('工程 originalFileName 必须是字符串');
    }

    const seedJointColumns = projectData.seedJointColumns === undefined || projectData.seedJointColumns === null
      ? []
      : projectData.seedJointColumns;
    if (!Array.isArray(seedJointColumns) || !seedJointColumns.every(column => typeof column === 'string')) {
      throw new TypeError('工程 seedJointColumns 必须是字符串数组');
    }

    const seedHeader = projectData.seedHeader === undefined || projectData.seedHeader === null
      ? null
      : projectData.seedHeader;
    if (seedHeader !== null &&
        (!Array.isArray(seedHeader) || !seedHeader.every(column => typeof column === 'string'))) {
      throw new TypeError('工程 seedHeader 必须是字符串数组或 null');
    }

    return {
      version: projectData.version || '1.0',
      baseTrajectory: baseTrajectory.map(state => this.cloneTrajectoryState(state)),
      keyframes: candidateKeyframes,
      fixedJointValues,
      jointCount,
      originalFileName,
      fps,
      interpolationMode,
      sourceFormat: normalizeTrajectoryFormat(projectData.sourceFormat),
      seedHeader: seedHeader ? [...seedHeader] : null,
      seedJointColumns: [...seedJointColumns]
    };
  }

  validateCSVInput(csvText, format) {
    if (typeof csvText !== 'string') {
      throw new TypeError('CSV 内容必须是字符串');
    }

    const lines = csvText
      .trim()
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    const dataLines = format === TRAJECTORY_FORMATS.SEED ? lines.slice(1) : lines;
    const expectedColumnCount = format === TRAJECTORY_FORMATS.SEED
      ? (lines[0] ? lines[0].split(',').length : 0)
      : (dataLines[0] ? dataLines[0].split(',').length : 0);

    if (expectedColumnCount > 0 && expectedColumnCount < 7) {
      throw new Error(`CSV 至少需要 7 列，实际 ${expectedColumnCount} 列`);
    }

    dataLines.forEach((line, rowIndex) => {
      const columns = line.split(',').map(value => value.trim());
      if (columns.length !== expectedColumnCount) {
        throw new Error(
          `CSV 第 ${rowIndex + 1} 个数据行列数不一致: 期望 ${expectedColumnCount}，实际 ${columns.length}`
        );
      }
      const hasInvalidValue = columns.some(value => value === '' || !Number.isFinite(Number(value)));
      if (hasInvalidValue) {
        throw new TypeError(`CSV 第 ${rowIndex + 1} 个数据行包含无效数值`);
      }
    });
  }

  getExportFramePositions(targetFPS = this.fps) {
    const sourceFPS = this.fps || 50;
    const exportFPS = parseInt(targetFPS) || sourceFPS;

    if (this.baseTrajectory.length === 0) {
      return [];
    }

    const targetFrameCount = Math.max(1, Math.round(this.baseTrajectory.length * exportFPS / sourceFPS));
    const lastFrameIndex = this.baseTrajectory.length - 1;

    if (targetFrameCount === 1) {
      return [0];
    }

    return Array.from({ length: targetFrameCount }, (_, index) => {
      return index * lastFrameIndex / (targetFrameCount - 1);
    });
  }

  getInterpolatedResidual(frameIndex) {
    // 如果当前帧就是关键帧，直接返回
    if (this.keyframes.has(frameIndex)) {
      const kf = this.keyframes.get(frameIndex);
      return kf.residual || kf; // 兼容新旧格式
    }

    // 找到前后两个关键帧进行插值
    const keyframeIndices = Array.from(this.keyframes.keys()).sort((a, b) => a - b);
    
    if (keyframeIndices.length === 0) {
      return new Array(this.jointCount).fill(0);
    }

    // 找到前一个关键帧
    let prevIdx = -1;
    let nextIdx = -1;
    
    for (let i = 0; i < keyframeIndices.length; i++) {
      if (keyframeIndices[i] < frameIndex) {
        prevIdx = keyframeIndices[i];
      }
      if (keyframeIndices[i] > frameIndex) {
        nextIdx = keyframeIndices[i];
        break;
      }
    }

    // 在第一个关键帧之前：不受影响，返回0
    if (prevIdx === -1) {
      return new Array(this.jointCount).fill(0);
    }

    // 在最后一个关键帧之后：保持最后一个关键帧的值
    if (nextIdx === -1) {
      const kf = this.keyframes.get(prevIdx);
      return kf.residual || kf;
    }

    // 两个关键帧之间：根据插值模式进行插值
    const t = (frameIndex - prevIdx) / (nextIdx - prevIdx);
    const prevKf = this.keyframes.get(prevIdx);
    const nextKf = this.keyframes.get(nextIdx);
    const prevResidual = prevKf.residual || prevKf;
    const nextResidual = nextKf.residual || nextKf;
    
    // 选择插值方法
    const interpolatedT = this.interpolationMode === 'bezier' ? 
      this.cubicBezierEase(t) : t;
    
    return prevResidual.map((prevVal, idx) => {
      const nextVal = nextResidual[idx] || 0;
      return prevVal + (nextVal - prevVal) * interpolatedT;
    });
  }

  getInterpolatedBaseResidual(frameIndex) {
    if (this.keyframes.size === 0) {
      return null;
    }
    
    const keyframeIndices = Array.from(this.keyframes.keys()).sort((a, b) => a - b);
    
    // 检查是否有任何基体残差
    const hasAnyBaseResidual = keyframeIndices.some(idx => {
      const kf = this.keyframes.get(idx);
      return kf.baseResidual !== null && kf.baseResidual !== undefined;
    });
    
    if (!hasAnyBaseResidual) {
      return null;
    }
    
    // 如果当前帧就是关键帧
    if (this.keyframes.has(frameIndex)) {
      const kf = this.keyframes.get(frameIndex);
      return kf.baseResidual ? JSON.parse(JSON.stringify(kf.baseResidual)) : null;
    }
    
    // 如果在第一个关键帧之前
    if (frameIndex < keyframeIndices[0]) {
      return null;
    }
    
    // 如果在最后一个关键帧之后
    if (frameIndex >= keyframeIndices[keyframeIndices.length - 1]) {
      const lastKeyframe = this.keyframes.get(keyframeIndices[keyframeIndices.length - 1]);
      if (!lastKeyframe.baseResidual) return null;
      return JSON.parse(JSON.stringify(lastKeyframe.baseResidual));
    }
    
    // 在两个关键帧之间插值
    let prevIndex = keyframeIndices[0];
    let nextIndex = keyframeIndices[keyframeIndices.length - 1];
    
    for (let i = 0; i < keyframeIndices.length - 1; i++) {
      if (keyframeIndices[i] <= frameIndex && frameIndex <= keyframeIndices[i + 1]) {
        prevIndex = keyframeIndices[i];
        nextIndex = keyframeIndices[i + 1];
        break;
      }
    }
    
    const prevKeyframe = this.keyframes.get(prevIndex);
    const nextKeyframe = this.keyframes.get(nextIndex);
    
    const prevBase = prevKeyframe.baseResidual;
    const nextBase = nextKeyframe.baseResidual;
    
    // 如果两个关键帧都没有基体残差
    if (!prevBase && !nextBase) {
      return null;
    }
    
    const t = (frameIndex - prevIndex) / (nextIndex - prevIndex);
    // 应用插值模式
    const interpolatedT = this.interpolationMode === 'bezier' ? 
      this.cubicBezierEase(t) : t;
    
    const prev = prevBase || {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 }
    };
    const next = nextBase || {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 }
    };
    
    // 位置插值（使用贝塞尔或线性）
    const interpolatedPosition = {
      x: prev.position.x + (next.position.x - prev.position.x) * interpolatedT,
      y: prev.position.y + (next.position.y - prev.position.y) * interpolatedT,
      z: prev.position.z + (next.position.z - prev.position.z) * interpolatedT
    };
    
    // 四元数球面线性插值 (SLERP) - 使用插值后的 t 值
    const qPrev = new THREE.Quaternion(
      prev.quaternion.x,
      prev.quaternion.y,
      prev.quaternion.z,
      prev.quaternion.w
    );
    const qNext = new THREE.Quaternion(
      next.quaternion.x,
      next.quaternion.y,
      next.quaternion.z,
      next.quaternion.w
    );
    
    // 使用SLERP插值
    const qInterpolated = qPrev.clone().slerp(qNext, interpolatedT);
    
    return {
      position: interpolatedPosition,
      quaternion: {
        x: qInterpolated.x,
        y: qInterpolated.y,
        z: qInterpolated.z,
        w: qInterpolated.w
      }
    };
  }

  addKeyframe(frameIndex, jointValues, baseValues = null) {
    if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= this.baseTrajectory.length) {
      throw new RangeError(`无效的帧索引: ${frameIndex}`);
    }
    if (!Array.isArray(jointValues) || jointValues.length !== this.jointCount) {
      throw new TypeError(`jointValues 必须是长度为 ${this.jointCount} 的数组`);
    }
    if (!jointValues.every(Number.isFinite)) {
      throw new TypeError('jointValues 必须全部是有限数值');
    }
    if (baseValues) {
      const position = baseValues.position;
      const quaternion = baseValues.quaternion;
      const baseNumbers = position && quaternion ? [
        position.x, position.y, position.z,
        quaternion.x, quaternion.y, quaternion.z, quaternion.w
      ] : [];
      if (baseNumbers.length !== 7 || !baseNumbers.every(Number.isFinite)) {
        throw new TypeError('baseValues 必须包含有限数值的 position 和 quaternion');
      }
    }

    // 计算残差（当前值 - base 值）
    const baseState = this.getBaseState(frameIndex);

    const residual = jointValues.map((value, idx) => {
      return value - baseState.joints[idx];
    });

    // 计算基体残差
    let baseResidual = null;
    if (baseValues) {
      // 位置残差：直接相减
      const positionResidual = {
        x: baseValues.position.x - baseState.base.position.x,
        y: baseValues.position.y - baseState.base.position.y,
        z: baseValues.position.z - baseState.base.position.z
      };
      
      // 四元数残差： q_residual = q_base^(-1) * q_current
      const qCurrent = new THREE.Quaternion(
        baseValues.quaternion.x,
        baseValues.quaternion.y,
        baseValues.quaternion.z,
        baseValues.quaternion.w
      );
      const qBase = new THREE.Quaternion(
        baseState.base.quaternion.x,
        baseState.base.quaternion.y,
        baseState.base.quaternion.z,
        baseState.base.quaternion.w
      );
      
      // 计算残差四元数（使用clone避免修改qBase）
      const qResidual = qBase.clone().invert().multiply(qCurrent);
      
      baseResidual = {
        position: positionResidual,
        quaternion: {
          x: qResidual.x,
          y: qResidual.y,
          z: qResidual.z,
          w: qResidual.w
        }
      };
    }

    const isNew = !this.keyframes.has(frameIndex);
    this.keyframes.set(frameIndex, { residual, baseResidual });
    
    return isNew;
  }

  removeKeyframe(frameIndex) {
    this.keyframes.delete(frameIndex);
  }

  clearAllKeyframes() {
    this.keyframes.clear();
    console.log('🗑️ 已清除所有关键帧');
  }

  getExportFileName(format = 'source') {
    if (this.originalFileName) {
      const nameWithoutExt = this.originalFileName.replace(/\.csv$/i, '');
      const exportFormat = this.resolveExportFormat(format);
      const formatSuffix = exportFormat === this.sourceFormat ? '' : `_${exportFormat}`;
      return `${nameWithoutExt}_modified${formatSuffix}.csv`;
    }
    return 'trajectory_modified.csv';
  }

  exportCombinedTrajectory(format = 'source', targetFPS = this.fps) {
    const states = this.getExportFramePositions(targetFPS)
      .map(framePosition => this.getCombinedStateAtFrame(framePosition));

    return exportTrajectoryCSV(states, {
      format: this.resolveExportFormat(format),
      seedJointColumns: this.seedJointColumns
    });
  }

  exportBaseTrajectory(format = 'source', targetFPS = this.fps) {
    const states = this.getExportFramePositions(targetFPS)
      .map(framePosition => this.getInterpolatedBaseState(framePosition));

    return exportTrajectoryCSV(states, {
      format: this.resolveExportFormat(format),
      seedJointColumns: this.seedJointColumns
    });
  }

  getProjectData() {
    // 序列化工程数据：原始轨迹 + 关键帧
    const keyframesArray = Array.from(this.keyframes.entries()).map(([frameIndex, data]) => ({
      frameIndex,
      residual: data.residual,
      baseResidual: data.baseResidual
    }));

    return {
      version: '2.3', // 升级：支持轨迹级固定关节值
      baseTrajectory: this.baseTrajectory,
      keyframes: keyframesArray,
      fixedJointValues: { ...this.fixedJointValues },
      jointCount: this.jointCount,
      originalFileName: this.originalFileName,
      fps: this.fps || 50,
      interpolationMode: this.interpolationMode || 'linear',
      sourceFormat: this.sourceFormat || TRAJECTORY_FORMATS.UNITREE,
      seedHeader: this.seedHeader,
      seedJointColumns: this.seedJointColumns || []
    };
  }

  loadProjectData(projectData) {
    // 先构造并完整校验独立 candidate。此步骤失败时不得修改当前 manager。
    const candidate = this.buildProjectCandidate(projectData);

    // 检查版本兼容性
    const version = candidate.version;
    
    if (version === '1.0') {
      console.warn('⚠️ 检测到旧版本工程文件 (v1.0)');
      console.warn('⚠️ 四元数残差计算方式已改变，建议重新创建关键帧');
      console.warn('⚠️ 继续加载可能导致姿态不正确');
      if (typeof alert !== 'undefined') {
        alert(i18n.t('oldProjectVersion'));
      }
    }
    
    // candidate 已完全校验且深拷贝；以下提交不会再执行可能失败的转换。
    this.baseTrajectory = candidate.baseTrajectory;
    this.keyframes = candidate.keyframes;
    this.fixedJointValues = candidate.fixedJointValues;
    this.jointCount = candidate.jointCount;
    this.originalFileName = candidate.originalFileName;
    this.fps = candidate.fps;
    this.interpolationMode = candidate.interpolationMode;
    this.sourceFormat = candidate.sourceFormat;
    this.seedHeader = candidate.seedHeader;
    this.seedJointColumns = candidate.seedJointColumns;
    
    console.log('✅ 加载工程文件:', this.baseTrajectory.length, '帧,', this.keyframes.size, '个关键帧');
  }

  /**
   * 三次贝塞尔缓动函数 - ease-in-out 效果
   * 参考 CSS cubic-bezier(0.42, 0, 0.58, 1)
   * @param {number} t - 输入值 [0, 1]
   * @returns {number} - 输出值 [0, 1]
   */
  cubicBezierEase(t) {
    // 使用 ease-in-out 曲线: P0(0,0), P1(0.42, 0), P2(0.58, 1), P3(1,1)
    // 简化的三次贝塞尔公式
    return t * t * (3 - 2 * t); // smoothstep 函数，等效于 ease-in-out
  }

  /**
   * 设置插值模式
   * @param {string} mode - 'linear' 或 'bezier'
   */
  setInterpolationMode(mode) {
    if (mode !== 'linear' && mode !== 'bezier') {
      console.warn('无效的插值模式:', mode);
      return;
    }
    this.interpolationMode = mode;
    console.log('✅ 插值模式已设置为:', mode === 'linear' ? '线性' : '贝塞尔曲线');
  }

  /**
   * 获取当前插值模式
   * @returns {string} - 'linear' 或 'bezier'
   */
  getInterpolationMode() {
    return this.interpolationMode;
  }

  clearAll() {
    this.baseTrajectory = [];
    this.keyframes.clear();
    this.fixedJointValues = {};
    this.jointCount = 0;
    this.originalFileName = '';
    this.fps = 50;
    this.interpolationMode = 'linear';
    this.sourceFormat = TRAJECTORY_FORMATS.UNITREE;
    this.seedHeader = null;
    this.seedJointColumns = [];
    console.log('🗑️ 已清除所有轨迹和关键帧');
  }
}
