/**
 * 数据结构一致性测试
 * 验证 TrajectoryManager 中的数据保存和加载流程
 */

import * as THREE from 'three';

// 简化版 TrajectoryManager，不依赖 i18n
class SimpleTrajectoryManager {
  constructor() {
    this.baseTrajectory = [];
    this.keyframes = new Map();
    this.jointCount = 0;
    this.originalFileName = '';
    this.fps = 50;
  }

  parseCSV(csvText, fileName = '') {
    const lines = csvText.trim().split('\n');
    this.baseTrajectory = [];
    this.originalFileName = fileName;

    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith('#')) continue;

      const values = line.split(',').map(v => parseFloat(v.trim()));
      if (values.length < 7) continue;

      const base = {
        position: { x: values[0], y: values[1], z: values[2] },
        quaternion: { x: values[3], y: values[4], z: values[5], w: values[6] }
      };

      const joints = values.slice(7);
      if (this.jointCount === 0) this.jointCount = joints.length;

      this.baseTrajectory.push({ base, joints });
    }
  }

  getBaseState(frameIndex) {
    if (frameIndex < 0 || frameIndex >= this.baseTrajectory.length) return null;
    return this.baseTrajectory[frameIndex];
  }

  addKeyframe(frameIndex, jointValues, baseValues = null) {
    const baseState = this.getBaseState(frameIndex);
    if (!baseState) return;

    const residual = jointValues.map((value, idx) => value - baseState.joints[idx]);

    let baseResidual = null;
    if (baseValues) {
      const positionResidual = {
        x: baseValues.position.x - baseState.base.position.x,
        y: baseValues.position.y - baseState.base.position.y,
        z: baseValues.position.z - baseState.base.position.z
      };

      const qCurrent = new THREE.Quaternion(
        baseValues.quaternion.x, baseValues.quaternion.y,
        baseValues.quaternion.z, baseValues.quaternion.w
      );
      const qBase = new THREE.Quaternion(
        baseState.base.quaternion.x, baseState.base.quaternion.y,
        baseState.base.quaternion.z, baseState.base.quaternion.w
      );

      const qResidual = qBase.clone().invert().multiply(qCurrent);

      baseResidual = {
        position: positionResidual,
        quaternion: { x: qResidual.x, y: qResidual.y, z: qResidual.z, w: qResidual.w }
      };
    }

    this.keyframes.set(frameIndex, { residual, baseResidual });
  }

  getProjectData() {
    const keyframesArray = Array.from(this.keyframes.entries()).map(([frameIndex, data]) => ({
      frameIndex,
      residual: data.residual,
      baseResidual: data.baseResidual
    }));

    return {
      version: '2.0',
      baseTrajectory: this.baseTrajectory,
      keyframes: keyframesArray,
      jointCount: this.jointCount,
      originalFileName: this.originalFileName,
      fps: this.fps || 50
    };
  }

  loadProjectData(projectData) {
    this.baseTrajectory = [];
    this.keyframes.clear();
    this.jointCount = projectData.jointCount || 0;
    this.originalFileName = projectData.originalFileName || '';
    this.fps = projectData.fps || 50;

    if (projectData.baseTrajectory) {
      this.baseTrajectory = projectData.baseTrajectory;
    }

    if (projectData.keyframes) {
      projectData.keyframes.forEach(kf => {
        let residual = kf.residual;
        let baseResidual = kf.baseResidual;

        if (!Array.isArray(residual)) {
          residual = new Array(this.jointCount).fill(0);
        } else if (residual.length === 0) {
          residual = new Array(this.jointCount).fill(0);
        }

        if (baseResidual !== null && baseResidual !== undefined) {
          if (!baseResidual.position || !baseResidual.quaternion) {
            baseResidual = null;
          }
        }

        this.keyframes.set(kf.frameIndex, {
          residual: residual,
          baseResidual: baseResidual
        });
      });
    }
  }
}

// 创建一个简单的测试
const manager = new SimpleTrajectoryManager();

// 1. 加载测试 CSV
const csvData = `0,0,1,0,0,0,1,0.1,0.2,0.3
1,0,1,0,0,0,1,0.15,0.25,0.35
2,0,1,0,0,0,1,0.2,0.3,0.4`;

manager.parseCSV(csvData, 'test.csv');
console.log('✅ CSV 已加载:', manager.baseTrajectory.length, '帧');

// 2. 添加关键帧
const jointValues = [0.5, 0.6, 0.7];
const baseValues = {
  position: { x: 0.1, y: 0.2, z: 1.1 },
  quaternion: { x: 0, y: 0, z: 0.1, w: 0.995 }
};

manager.addKeyframe(1, jointValues, baseValues);
console.log('✅ 已添加关键帧 1');

// 3. 检查内部数据结构
const kf = manager.keyframes.get(1);
console.log('关键帧数据结构:', {
  hasResidual: kf.hasOwnProperty('residual'),
  hasBaseResidual: kf.hasOwnProperty('baseResidual'),
  residualIsArray: Array.isArray(kf.residual),
  baseResidualHasPosition: kf.baseResidual?.position !== undefined,
  baseResidualHasQuaternion: kf.baseResidual?.quaternion !== undefined
});

// 4. 导出工程数据
const projectData = manager.getProjectData();
console.log('✅ 工程数据已导出');
console.log('Keyframes 结构:', projectData.keyframes[0]);

// 5. 加载工程数据
const manager2 = new SimpleTrajectoryManager();
manager2.loadProjectData(projectData);
console.log('✅ 工程数据已加载');

// 6. 验证加载后的数据
const kf2 = manager2.keyframes.get(1);
console.log('加载后的关键帧数据结构:', {
  hasResidual: kf2.hasOwnProperty('residual'),
  hasBaseResidual: kf2.hasOwnProperty('baseResidual'),
  residualIsArray: Array.isArray(kf2.residual),
  baseResidualHasPosition: kf2.baseResidual?.position !== undefined,
  baseResidualHasQuaternion: kf2.baseResidual?.quaternion !== undefined
});

// 7. 验证数据一致性
const residualsMatch = JSON.stringify(kf.residual) === JSON.stringify(kf2.residual);
const baseResidualsMatch = JSON.stringify(kf.baseResidual) === JSON.stringify(kf2.baseResidual);

console.log('\n数据一致性检查:');
console.log('  Residuals 匹配:', residualsMatch ? '✅' : '❌');
console.log('  BaseResiduals 匹配:', baseResidualsMatch ? '✅' : '❌');

if (residualsMatch && baseResidualsMatch) {
  console.log('\n🎉 所有测试通过！数据结构一致！');
} else {
  console.log('\n❌ 测试失败！数据结构不一致！');
  console.log('原始 residual:', kf.residual);
  console.log('加载后 residual:', kf2.residual);
  console.log('原始 baseResidual:', kf.baseResidual);
  console.log('加载后 baseResidual:', kf2.baseResidual);
}
