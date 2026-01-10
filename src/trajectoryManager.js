export class TrajectoryManager {
  constructor() {
    this.baseTrajectory = [];  // CSV 加载的基础轨迹
    this.keyframes = new Map(); // 关键帧残差: frameIndex -> joint values
    this.jointCount = 0;
    this.originalFileName = ''; // 原始CSV文件名
  }

  parseCSV(csvText, fileName = '') {
    const lines = csvText.trim().split('\n');
    this.baseTrajectory = [];
    this.originalFileName = fileName;

    for (const line of lines) {
      // 跳过空行和注释
      if (!line.trim() || line.trim().startsWith('#')) {
        continue;
      }

      const values = line.split(',').map(v => parseFloat(v.trim()));
      
      if (values.length < 7) {
        console.warn('CSV 行数据不足 7 列:', line);
        continue;
      }

      // 前 7 列: x, y, z, qx, qy, qz, qw
      const base = {
        position: { x: values[0], y: values[1], z: values[2] },
        quaternion: { x: values[3], y: values[4], z: values[5], w: values[6] }
      };

      // 后面的列是关节位置
      const joints = values.slice(7);
      
      if (this.jointCount === 0) {
        this.jointCount = joints.length;
      }

      this.baseTrajectory.push({ base, joints });
    }

    console.log('解析 CSV:', this.baseTrajectory.length, '帧,', this.jointCount, '个关节');
  }

  hasTrajectory() {
    return this.baseTrajectory.length > 0;
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

  getCombinedState(frameIndex) {
    const baseState = this.getBaseState(frameIndex);
    if (!baseState) {
      return null;
    }

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
      combinedBase.position.x += baseResidual.position.x;
      combinedBase.position.y += baseResidual.position.y;
      combinedBase.position.z += baseResidual.position.z;
      
      combinedBase.quaternion.x += baseResidual.quaternion.x;
      combinedBase.quaternion.y += baseResidual.quaternion.y;
      combinedBase.quaternion.z += baseResidual.quaternion.z;
      combinedBase.quaternion.w += baseResidual.quaternion.w;
      
      // 归一化四元数
      const q = combinedBase.quaternion;
      const length = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
      if (length > 0.0001) {
        q.x /= length;
        q.y /= length;
        q.z /= length;
        q.w /= length;
      }
    }

    return {
      base: combinedBase,
      joints: combinedJoints
    };
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

    // 在第一个关键帧之前：从 0 插值到第一个关键帧
    if (prevIdx === -1) {
      const firstIdx = keyframeIndices[0];
      const kf = this.keyframes.get(firstIdx);
      const firstResidual = kf.residual || kf;
      
      if (frameIndex < firstIdx) {
        // 线性插值：从 0 到第一个关键帧
        const t = frameIndex / firstIdx;
        return firstResidual.map(val => val * t);
      }
      
      return new Array(this.jointCount).fill(0);
    }

    // 在最后一个关键帧之后：保持最后一个关键帧的值
    if (nextIdx === -1) {
      const kf = this.keyframes.get(prevIdx);
      return kf.residual || kf;
    }

    // 两个关键帧之间：线性插值
    const t = (frameIndex - prevIdx) / (nextIdx - prevIdx);
    const prevKf = this.keyframes.get(prevIdx);
    const nextKf = this.keyframes.get(nextIdx);
    const prevResidual = prevKf.residual || prevKf;
    const nextResidual = nextKf.residual || nextKf;
    
    return prevResidual.map((prevVal, idx) => {
      const nextVal = nextResidual[idx] || 0;
      return prevVal + (nextVal - prevVal) * t;
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
    if (frameIndex <= keyframeIndices[0]) {
      const firstKeyframeIndex = keyframeIndices[0];
      const firstKeyframe = this.keyframes.get(firstKeyframeIndex);
      
      if (!firstKeyframe.baseResidual) return null;
      
      if (frameIndex === firstKeyframeIndex) {
        return JSON.parse(JSON.stringify(firstKeyframe.baseResidual));
      }
      
      const t = frameIndex / firstKeyframeIndex;
      return {
        position: {
          x: firstKeyframe.baseResidual.position.x * t,
          y: firstKeyframe.baseResidual.position.y * t,
          z: firstKeyframe.baseResidual.position.z * t
        },
        quaternion: {
          x: firstKeyframe.baseResidual.quaternion.x * t,
          y: firstKeyframe.baseResidual.quaternion.y * t,
          z: firstKeyframe.baseResidual.quaternion.z * t,
          w: firstKeyframe.baseResidual.quaternion.w * t
        }
      };
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
    
    // 如果两个关键帧都没有基体残差
    if (!prevKeyframe.baseResidual && !nextKeyframe.baseResidual) {
      return null;
    }
    
    const t = (frameIndex - prevIndex) / (nextIndex - prevIndex);
    
    const prev = prevKeyframe.baseResidual || {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 0 }
    };
    const next = nextKeyframe.baseResidual || {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 0 }
    };
    
    return {
      position: {
        x: prev.position.x + (next.position.x - prev.position.x) * t,
        y: prev.position.y + (next.position.y - prev.position.y) * t,
        z: prev.position.z + (next.position.z - prev.position.z) * t
      },
      quaternion: {
        x: prev.quaternion.x + (next.quaternion.x - prev.quaternion.x) * t,
        y: prev.quaternion.y + (next.quaternion.y - prev.quaternion.y) * t,
        z: prev.quaternion.z + (next.quaternion.z - prev.quaternion.z) * t,
        w: prev.quaternion.w + (next.quaternion.w - prev.quaternion.w) * t
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
      baseResidual = {
        position: {
          x: baseValues.position.x - baseState.base.position.x,
          y: baseValues.position.y - baseState.base.position.y,
          z: baseValues.position.z - baseState.base.position.z
        },
        quaternion: {
          x: baseValues.quaternion.x - baseState.base.quaternion.x,
          y: baseValues.quaternion.y - baseState.base.quaternion.y,
          z: baseValues.quaternion.z - baseState.base.quaternion.z,
          w: baseValues.quaternion.w - baseState.base.quaternion.w
        }
      };
    }

    const isNew = !this.keyframes.has(frameIndex);
    this.keyframes.set(frameIndex, { residual, baseResidual });
    
    if (isNew) {
      console.log(`➕ 添加新关键帧 ${frameIndex}`);
    } else {
      console.log(`🔄 更新关键帧 ${frameIndex}`);
    }
    
    return isNew;
  }

  removeKeyframe(frameIndex) {
    this.keyframes.delete(frameIndex);
  }

  clearAllKeyframes() {
    this.keyframes.clear();
    console.log('🗑️ 已清除所有关键帧');
  }

  getExportFileName() {
    if (this.originalFileName) {
      const nameWithoutExt = this.originalFileName.replace(/\.csv$/i, '');
      return `${nameWithoutExt}_modified.csv`;
    }
    return 'trajectory_modified.csv';
  }

  exportCombinedTrajectory() {
    const lines = [];
    
    for (let i = 0; i < this.baseTrajectory.length; i++) {
      const state = this.getCombinedState(i);
      
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
      
      lines.push(values.join(','));
    }
    
    return lines.join('\n');
  }
}
