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

    this.baseTrajectory = parsed.baseTrajectory;
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
    this.fps = fps;
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
    // 计算残差（当前值 - base 值）
    const baseState = this.getBaseState(frameIndex);
    if (!baseState) {
      console.warn('无效的帧索引:', frameIndex);
      return;
    }

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

  _cloneKeyframeData(data) {
    return {
      residual: [...data.residual],
      baseResidual: data.baseResidual
        ? {
            position: { ...data.baseResidual.position },
            quaternion: { ...data.baseResidual.quaternion }
          }
        : null
    };
  }

  /**
   * 将关键帧残差还原为绝对关节角与基座位姿（在 fromFrame 的 base 轨迹上解码）
   */
  _decodeKeyframeAbsolute(fromFrame, data) {
    const baseState = this.getBaseState(fromFrame);
    if (!baseState || !data?.residual) return null;

    const joints = baseState.joints.map((baseValue, idx) => {
      return baseValue + (data.residual[idx] ?? 0);
    });

    let position = { ...baseState.base.position };
    let quaternion = { ...baseState.base.quaternion };

    if (data.baseResidual?.position) {
      position = {
        x: baseState.base.position.x + data.baseResidual.position.x,
        y: baseState.base.position.y + data.baseResidual.position.y,
        z: baseState.base.position.z + data.baseResidual.position.z
      };
    }

    if (data.baseResidual?.quaternion) {
      const qBase = new THREE.Quaternion(
        baseState.base.quaternion.x,
        baseState.base.quaternion.y,
        baseState.base.quaternion.z,
        baseState.base.quaternion.w
      );
      const qResidual = new THREE.Quaternion(
        data.baseResidual.quaternion.x,
        data.baseResidual.quaternion.y,
        data.baseResidual.quaternion.z,
        data.baseResidual.quaternion.w
      );
      const qCombined = qBase.clone().multiply(qResidual).normalize();
      quaternion = {
        x: qCombined.x,
        y: qCombined.y,
        z: qCombined.z,
        w: qCombined.w
      };
    }

    return { joints, position, quaternion };
  }

  /**
   * 将绝对关节/基座位姿编码为相对 toFrame 的 CSV base 的残差
   */
  _encodeKeyframeResiduals(toFrame, absolute) {
    const baseState = this.getBaseState(toFrame);
    if (!baseState || !absolute?.joints) return null;

    const residual = absolute.joints.map((value, idx) => {
      return value - baseState.joints[idx];
    });

    const positionResidual = {
      x: absolute.position.x - baseState.base.position.x,
      y: absolute.position.y - baseState.base.position.y,
      z: absolute.position.z - baseState.base.position.z
    };

    const qCurrent = new THREE.Quaternion(
      absolute.quaternion.x,
      absolute.quaternion.y,
      absolute.quaternion.z,
      absolute.quaternion.w
    );
    const qBase = new THREE.Quaternion(
      baseState.base.quaternion.x,
      baseState.base.quaternion.y,
      baseState.base.quaternion.z,
      baseState.base.quaternion.w
    );
    const qResidual = qBase.clone().invert().multiply(qCurrent);

    return {
      residual,
      baseResidual: {
        position: positionResidual,
        quaternion: {
          x: qResidual.x,
          y: qResidual.y,
          z: qResidual.z,
          w: qResidual.w
        }
      }
    };
  }

  /** 将关键帧从 fromFrame 移动到 toFrame（保留绝对编辑内容，按目标帧重算残差） */
  moveKeyframe(fromFrame, toFrame) {
    const from = Math.round(fromFrame);
    let to = Math.round(toFrame);
    if (!this.keyframes.has(from) || !this.hasTrajectory()) return false;

    const maxFrame = this.baseTrajectory.length - 1;
    to = Math.max(0, Math.min(maxFrame, to));
    if (from === to) return true;

    const absolute = this._decodeKeyframeAbsolute(from, this.keyframes.get(from));
    if (!absolute) return false;

    this.keyframes.delete(from);
    const encoded = this._encodeKeyframeResiduals(to, absolute);
    if (!encoded) return false;

    this.keyframes.set(to, encoded);
    return true;
  }

  /** 将 fromFrame 的关键帧内容复制到 toFrame（不删除源关键帧） */
  copyKeyframeToFrame(fromFrame, toFrame) {
    const absolute = this.getKeyframeAbsolute(fromFrame);
    if (!absolute) return false;
    return this.setKeyframeFromAbsolute(toFrame, absolute);
  }

  /** 读取关键帧的绝对关节/基座内容 */
  getKeyframeAbsolute(frameIndex) {
    const frame = Math.round(frameIndex);
    const data = this.keyframes.get(frame);
    if (!data || !this.hasTrajectory()) return null;
    return this._decodeKeyframeAbsolute(frame, data);
  }

  /** 在 toFrame 写入绝对关节/基座内容（自动重算残差） */
  setKeyframeFromAbsolute(toFrame, absolute) {
    let to = Math.round(toFrame);
    if (!absolute || !this.hasTrajectory()) return false;

    const maxFrame = this.baseTrajectory.length - 1;
    to = Math.max(0, Math.min(maxFrame, to));

    const encoded = this._encodeKeyframeResiduals(to, absolute);
    if (!encoded) return false;

    this.keyframes.set(to, encoded);
    return true;
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
      version: '2.2', // 升级：支持轨迹 CSV 格式元数据
      baseTrajectory: this.baseTrajectory,
      keyframes: keyframesArray,
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
    // 检查版本兼容性
    const version = projectData.version || '1.0';
    
    if (version === '1.0') {
      console.warn('⚠️ 检测到旧版本工程文件 (v1.0)');
      console.warn('⚠️ 四元数残差计算方式已改变，建议重新创建关键帧');
      console.warn('⚠️ 继续加载可能导致姿态不正确');
      if (typeof alert !== 'undefined') {
        alert(i18n.t('oldProjectVersion'));
      }
    }
    
    // 清除当前数据
    this.baseTrajectory = [];
    this.keyframes.clear();
    
    // 先设置基本属性（关键帧处理需要用到 jointCount）
    this.jointCount = projectData.jointCount || 0;
    this.originalFileName = projectData.originalFileName || '';
    this.fps = projectData.fps || 50;
    // 加载插值模式（兼容旧版本，默认为线性）
    this.interpolationMode = projectData.interpolationMode || 'linear';
    this.sourceFormat = normalizeTrajectoryFormat(projectData.sourceFormat);
    this.seedHeader = projectData.seedHeader || null;
    this.seedJointColumns = projectData.seedJointColumns || [];
    
    // 加载基础轨迹数据
    if (projectData.baseTrajectory) {
      this.baseTrajectory = projectData.baseTrajectory;
    }
    
    // 加载关键帧数据
    if (projectData.keyframes) {
      projectData.keyframes.forEach(kf => {
        // 提取 residual 和 baseResidual
        let residual = kf.residual;
        let baseResidual = kf.baseResidual;
        
        // 验证并修复 residual
        if (!Array.isArray(residual)) {
          console.warn(`关键帧 ${kf.frameIndex} 的 residual 不是数组，使用零值`);
          residual = new Array(this.jointCount).fill(0);
        } else if (residual.length === 0) {
          console.warn(`关键帧 ${kf.frameIndex} 的 residual 长度为0，使用零值`);
          residual = new Array(this.jointCount).fill(0);
        }
        
        // 验证 baseResidual（可以为 null）
        if (baseResidual !== null && baseResidual !== undefined) {
          if (!baseResidual.position || !baseResidual.quaternion) {
            console.warn(`关键帧 ${kf.frameIndex} 的 baseResidual 数据无效，设为 null`);
            baseResidual = null;
          }
        }
        
        // 使用统一的数据结构保存
        this.keyframes.set(kf.frameIndex, {
          residual: residual,
          baseResidual: baseResidual
        });
      });
    }
    
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
    this.jointCount = 0;
    this.originalFileName = '';
    this.sourceFormat = TRAJECTORY_FORMATS.UNITREE;
    this.seedHeader = null;
    this.seedJointColumns = [];
    console.log('🗑️ 已清除所有轨迹和关键帧');
  }
}
