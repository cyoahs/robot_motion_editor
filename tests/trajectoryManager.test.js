import { TrajectoryManager } from '../src/trajectoryManager.js';
import * as THREE from 'three';

// 辅助函数：检查四元数是否归一化
function isQuaternionNormalized(q, epsilon = 0.001) {
  const length = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  return Math.abs(length - 1.0) < epsilon;
}

// 辅助函数：创建归一化的四元数
function normalizeQuaternion(q) {
  const length = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  return {
    x: q.x / length,
    y: q.y / length,
    z: q.z / length,
    w: q.w / length
  };
}

// 测试套件
describe('TrajectoryManager', () => {
  let manager;

  beforeEach(() => {
    manager = new TrajectoryManager();
  });

  describe('CSV 解析', () => {
    test('应该正确解析有效的CSV数据', () => {
      const csv = `0.0,0.0,0.5,0.0,0.0,0.0,1.0,0.1,0.2,0.3
0.1,0.0,0.5,0.0,0.0,0.0,1.0,0.2,0.3,0.4`;
      
      manager.parseCSV(csv);
      
      expect(manager.hasTrajectory()).toBe(true);
      expect(manager.getFrameCount()).toBe(2);
      expect(manager.jointCount).toBe(3);
    });

    test('应该跳过空行和注释行', () => {
      const csv = `# 这是注释
0.0,0.0,0.5,0.0,0.0,0.0,1.0,0.1,0.2

0.1,0.0,0.5,0.0,0.0,0.0,1.0,0.2,0.3`;
      
      manager.parseCSV(csv);
      
      expect(manager.getFrameCount()).toBe(2);
    });

    test('CSV中的四元数应该被正确解析', () => {
      const csv = `0.0,0.0,0.5,0.707,0.0,0.0,0.707,0.1`;
      
      manager.parseCSV(csv);
      const state = manager.getBaseState(0);
      
      expect(state.base.quaternion.x).toBeCloseTo(0.707, 3);
      expect(state.base.quaternion.w).toBeCloseTo(0.707, 3);
    });
  });

  describe('四元数归一化', () => {
    test('叠加残差后的四元数应该被归一化', () => {
      const csv = `0.0,0.0,0.5,0.0,0.0,0.0,1.0,0.1`;
      manager.parseCSV(csv);
      
      // 添加关键帧，修改四元数
      const baseValues = {
        position: { x: 0.0, y: 0.0, z: 0.5 },
        quaternion: { x: 0.1, y: 0.1, z: 0.1, w: 1.0 } // 未归一化
      };
      
      manager.addKeyframe(0, [0.2], baseValues);
      
      const combined = manager.getCombinedState(0);
      
      // 检查四元数是否归一化
      const isNormalized = isQuaternionNormalized(combined.base.quaternion);
      
      console.log('叠加后的四元数:', combined.base.quaternion);
      console.log('是否归一化:', isNormalized);
      console.log('模长:', Math.sqrt(
        combined.base.quaternion.x ** 2 +
        combined.base.quaternion.y ** 2 +
        combined.base.quaternion.z ** 2 +
        combined.base.quaternion.w ** 2
      ));
      
      expect(isNormalized).toBe(true);
    });

    test('零长度四元数应该被正确处理', () => {
      const csv = `0.0,0.0,0.5,0.0,0.0,0.0,1.0,0.1`;
      manager.parseCSV(csv);
      
      // 创建会产生零长度四元数的残差
      const baseValues = {
        position: { x: 0.0, y: 0.0, z: 0.5 },
        quaternion: { x: 0.0, y: 0.0, z: 0.0, w: 0.0 }
      };
      
      manager.addKeyframe(0, [0.2], baseValues);
      const combined = manager.getCombinedState(0);
      
      // 应该不会崩溃，且有合理的四元数
      expect(combined).not.toBeNull();
      expect(combined.base.quaternion).toBeDefined();
    });
  });

  describe('关键帧插值', () => {
    beforeEach(() => {
      // 创建3帧的测试数据
      const csv = `0.0,0.0,0.5,0.0,0.0,0.0,1.0,0.0,0.0
1.0,0.0,0.5,0.0,0.0,0.0,1.0,0.5,0.5
2.0,0.0,0.5,0.0,0.0,0.0,1.0,1.0,1.0`;
      manager.parseCSV(csv);
    });

    test('在第一个关键帧之前应该从0插值', () => {
      // 在帧10添加关键帧
      manager.addKeyframe(2, [2.0, 2.0]);
      
      // 帧1应该插值
      const residual = manager.getInterpolatedResidual(1);
      
      expect(residual[0]).toBeCloseTo(1.0, 2); // 2.0 * (1/2)
      expect(residual[1]).toBeCloseTo(1.0, 2);
    });

    test('在最后一个关键帧之后应该保持不变', () => {
      manager.addKeyframe(0, [1.0, 1.0]);
      
      const residual = manager.getInterpolatedResidual(1);
      
      expect(residual[0]).toBeCloseTo(1.0, 2);
      expect(residual[1]).toBeCloseTo(1.0, 2);
    });

    test('两个关键帧之间应该线性插值', () => {
      manager.addKeyframe(0, [0.0, 0.0]); // 残差 [0, 0]
      manager.addKeyframe(2, [2.0, 2.0]); // 残差 [1, 1]
      
      const residual = manager.getInterpolatedResidual(1);
      
      // 中间点应该是 [0.5, 0.5]
      expect(residual[0]).toBeCloseTo(0.5, 2);
      expect(residual[1]).toBeCloseTo(0.5, 2);
    });
  });

  describe('基体残差插值', () => {
    beforeEach(() => {
      const csv = `0.0,0.0,0.5,0.0,0.0,0.0,1.0,0.0
1.0,0.0,0.5,0.0,0.0,0.0,1.0,0.5
2.0,0.0,0.5,0.0,0.0,0.0,1.0,1.0`;
      manager.parseCSV(csv);
    });

    test('基体残差应该正确插值', () => {
      const base0 = {
        position: { x: 0.0, y: 0.0, z: 0.5 },
        quaternion: { x: 0.0, y: 0.0, z: 0.0, w: 1.0 }
      };
      const base2 = {
        position: { x: 2.0, y: 0.0, z: 0.5 },
        quaternion: { x: 0.1, y: 0.0, z: 0.0, w: 1.0 }
      };
      
      manager.addKeyframe(0, [0.0], base0);
      manager.addKeyframe(2, [1.0], base2);
      
      const residual = manager.getInterpolatedBaseResidual(1);
      
      expect(residual.position.x).toBeCloseTo(1.0, 2);
      expect(residual.quaternion.x).toBeCloseTo(0.05, 3);
    });

    test('当没有基体残差时应该返回null', () => {
      manager.addKeyframe(0, [0.0]);
      
      const residual = manager.getInterpolatedBaseResidual(0);
      
      expect(residual).toBeNull();
    });
  });

  describe('导出功能', () => {
    test('应该正确导出合并后的轨迹', () => {
      const csv = `0.0,0.0,0.5,0.0,0.0,0.0,1.0,0.0
1.0,0.0,0.5,0.0,0.0,0.0,1.0,0.5`;
      manager.parseCSV(csv);
      
      manager.addKeyframe(0, [0.1]);
      
      const exported = manager.exportCombinedTrajectory();
      const lines = exported.trim().split('\n');
      
      expect(lines.length).toBe(2);
      
      // 检查第一行的关节值是否包含残差
      const values = lines[0].split(',').map(v => parseFloat(v));
      expect(values[7]).toBeCloseTo(0.1, 2); // 0.0 + 0.1残差
    });

    test('导出的四元数应该是归一化的', () => {
      const csv = `0.0,0.0,0.5,0.0,0.0,0.0,1.0,0.0`;
      manager.parseCSV(csv);
      
      const baseValues = {
        position: { x: 0.0, y: 0.0, z: 0.5 },
        quaternion: { x: 0.1, y: 0.1, z: 0.1, w: 1.0 }
      };
      manager.addKeyframe(0, [0.1], baseValues);
      
      const exported = manager.exportCombinedTrajectory();
      const values = exported.split('\n')[0].split(',').map(v => parseFloat(v));
      
      const q = {
        x: values[3],
        y: values[4],
        z: values[5],
        w: values[6]
      };
      
      expect(isQuaternionNormalized(q)).toBe(true);
    });
  });
});

describe('四元数数学问题', () => {
  test('直接相加四元数分量是错误的', () => {
    // 演示问题：两个归一化四元数相加后不再归一化
    const q1 = { x: 0, y: 0, z: 0, w: 1 }; // 单位四元数
    const q2 = { x: 0.707, y: 0, z: 0, w: 0.707 }; // 90度旋转
    
    // 直接相加（当前代码的做法）
    const qSum = {
      x: q1.x + q2.x,
      y: q1.y + q2.y,
      z: q1.z + q2.z,
      w: q1.w + q2.w
    };
    
    console.log('q1 (单位):', q1);
    console.log('q2 (90度):', q2);
    console.log('直接相加结果:', qSum);
    console.log('相加后的模长:', Math.sqrt(qSum.x**2 + qSum.y**2 + qSum.z**2 + qSum.w**2));
    
    // 直接相加的结果不是归一化的
    expect(isQuaternionNormalized(qSum, 0.1)).toBe(false);
  });

  test('正确的四元数组合应该用乘法', () => {
    const q1 = new THREE.Quaternion(0, 0, 0, 1); // 单位
    const q2 = new THREE.Quaternion(0.707, 0, 0, 0.707); // 90度
    
    // 四元数乘法
    const qMul = q1.clone().multiply(q2);
    
    console.log('q1:', q1);
    console.log('q2:', q2);
    console.log('乘法结果:', qMul);
    console.log('乘法结果模长:', qMul.length());
    
    // 四元数乘法自动保持归一化
    expect(Math.abs(qMul.length() - 1.0)).toBeLessThan(0.001);
  });
});

// 运行测试
console.log('=== 开始测试 ===\n');

// 简化的测试运行器
function describe(name, fn) {
  console.log(`\n📦 ${name}`);
  fn();
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (error) {
    console.log(`  ❌ ${name}`);
    console.error(`     错误: ${error.message}`);
  }
}

function beforeEach(fn) {
  // 在实际测试框架中会自动调用
}

function expect(value) {
  return {
    toBe(expected) {
      if (value !== expected) {
        throw new Error(`Expected ${value} to be ${expected}`);
      }
    },
    toBeCloseTo(expected, digits) {
      const diff = Math.abs(value - expected);
      const tolerance = Math.pow(10, -digits);
      if (diff > tolerance) {
        throw new Error(`Expected ${value} to be close to ${expected} (diff: ${diff})`);
      }
    },
    toBeNull() {
      if (value !== null) {
        throw new Error(`Expected ${value} to be null`);
      }
    },
    toBeDefined() {
      if (value === undefined) {
        throw new Error(`Expected value to be defined`);
      }
    },
    not: {
      toBeNull() {
        if (value === null) {
          throw new Error(`Expected ${value} not to be null`);
        }
      }
    },
    toBeLessThan(expected) {
      if (value >= expected) {
        throw new Error(`Expected ${value} to be less than ${expected}`);
      }
    }
  };
}
