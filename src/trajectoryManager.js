import * as THREE from 'three';

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
      
      // 位置线性插值
      const position = {
        x: firstKeyframe.baseResidual.position.x * t,
        y: firstKeyframe.baseResidual.position.y * t,
        z: firstKeyframe.baseResidual.position.z * t
      };
      
      // 四元数从单位四元数插值到目标残差
      const qIdentity = new THREE.Quaternion(0, 0, 0, 1); // 单位四元数
      const qTarget = new THREE.Quaternion(
        firstKeyframe.baseResidual.quaternion.x,
        firstKeyframe.baseResidual.quaternion.y,
        firstKeyframe.baseResidual.quaternion.z,
        firstKeyframe.baseResidual.quaternion.w
      );
      const qInterpolated = qIdentity.clone().slerp(qTarget, t);
      
      return {
        position,
        quaternion: {
          x: qInterpolated.x,
          y: qInterpolated.y,
          z: qInterpolated.z,
          w: qInterpolated.w
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
      quaternion: { x: 0, y: 0, z: 0, w: 1 }
    };
    const next = nextKeyframe.baseResidual || {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 }
    };
    
    // 位置线性插值
    const interpolatedPosition = {
      x: prev.position.x + (next.position.x - prev.position.x) * t,
      y: prev.position.y + (next.position.y - prev.position.y) * t,
      z: prev.position.z + (next.position.z - prev.position.z) * t
    };
    
    // 四元数球面线性插值 (SLERP)
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
    const qInterpolated = qPrev.clone().slerp(qNext, t);
    
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

  exportBaseTrajectory() {
    const lines = [];
    
    for (let i = 0; i < this.baseTrajectory.length; i++) {
      const state = this.baseTrajectory[i];
      
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

  getProjectData() {
    // 序列化工程数据：原始轨迹 + 关键帧
    const keyframesArray = Array.from(this.keyframes.entries()).map(([frameIndex, data]) => ({
      frameIndex,
      residual: data.residual,
      baseResidual: data.baseResidual
    }));

    return {
      version: '2.0', // 升级：使用Three.js Quaternion运算
      baseTrajectory: this.baseTrajectory,
      keyframes: keyframesArray,
      jointCount: this.jointCount,
      originalFileName: this.originalFileName,
      fps: this.fps || 50
    };
  }

  loadProjectData(projectData) {
    // 检查版本兼容性
    const version = projectData.version || '1.0';
    
    if (version === '1.0') {
      console.warn('⚠️ 检测到旧版本工程文件 (v1.0)');
      console.warn('⚠️ 四元数残差计算方式已改变，建议重新创建关键帧');
      console.warn('⚠️ 继续加载可能导致姿态不正确');
      // 可以选择提醒用户
      if (typeof alert !== 'undefined') {
        alert('⚠️ 检测到旧版本工程文件！\n\n四元数运算已优化，建议：\n1. 重新加载CSV轨迹\n2. 重新创建所有关键帧\n\n否则可能出现姿态错误。');
      }
    }
    
    // 清除当前数据
    this.baseTrajectory = [];
    this.keyframes.clear();
    
    // 加载新数据
    if (projectData.baseTrajectory) {
      this.baseTrajectory = projectData.baseTrajectory;
    }
    
    if (projectData.keyframes) {
      projectData.keyframes.forEach(kf => {
        this.keyframes.set(kf.frameIndex, {
          residual: kf.residual,
          baseResidual: kf.baseResidual
        });
      });
    }
    
    this.jointCount = projectData.jointCount || 0;
    this.originalFileName = projectData.originalFileName || '';
    this.fps = projectData.fps || 50;
    
    console.log('✅ 加载工程文件:', this.baseTrajectory.length, '帧,', this.keyframes.size, '个关键帧');
  }

  clearAll() {
    this.baseTrajectory = [];
    this.keyframes.clear();
    this.jointCount = 0;
    this.originalFileName = '';
    console.log('🗑️ 已清除所有轨迹和关键帧');
  }
}
