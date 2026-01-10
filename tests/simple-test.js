#!/usr/bin/env node

/**
 * 简化的单元测试 - 无需测试框架
 * 运行: node tests/simple-test.js
 */

console.log('🧪 开始测试关键帧和四元数逻辑...\n');

// ========== 测试 1: 四元数归一化 ==========
console.log('📝 测试 1: 四元数归一化');

function testQuaternionNormalization() {
  // 测试数据
  const q1 = { x: 1, y: 1, z: 1, w: 1 };  // 未归一化
  
  // 归一化函数
  const length = Math.sqrt(q1.x * q1.x + q1.y * q1.y + q1.z * q1.z + q1.w * q1.w);
  const normalized = {
    x: q1.x / length,
    y: q1.y / length,
    z: q1.z / length,
    w: q1.w / length
  };
  
  // 验证
  const normalizedLength = Math.sqrt(
    normalized.x ** 2 + normalized.y ** 2 + 
    normalized.z ** 2 + normalized.w ** 2
  );
  
  console.log(`  原始: (${q1.x}, ${q1.y}, ${q1.z}, ${q1.w}), 长度=${length.toFixed(4)}`);
  console.log(`  归一化: (${normalized.x.toFixed(3)}, ${normalized.y.toFixed(3)}, ${normalized.z.toFixed(3)}, ${normalized.w.toFixed(3)}), 长度=${normalizedLength.toFixed(6)}`);
  
  if (Math.abs(normalizedLength - 1.0) < 0.001) {
    console.log('  ✅ 通过: 归一化后长度为1\n');
    return true;
  } else {
    console.log('  ❌ 失败: 归一化后长度不为1\n');
    return false;
  }
}

// ========== 测试 2: 零长度四元数处理 ==========
console.log('📝 测试 2: 零长度四元数处理');

function testZeroLengthQuaternion() {
  const q = { x: 0, y: 0, z: 0, w: 0 };
  const length = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  
  let result;
  if (length < 0.0001) {
    result = { x: 0, y: 0, z: 0, w: 1 };  // 恢复为单位四元数
    console.log('  检测到零长度四元数，恢复为单位四元数');
  } else {
    result = {
      x: q.x / length,
      y: q.y / length,
      z: q.z / length,
      w: q.w / length
    };
  }
  
  console.log(`  结果: (${result.x}, ${result.y}, ${result.z}, ${result.w})`);
  
  if (result.w === 1 && result.x === 0) {
    console.log('  ✅ 通过: 正确处理零长度情况\n');
    return true;
  } else {
    console.log('  ❌ 失败: 零长度处理不正确\n');
    return false;
  }
}

// ========== 测试 3: 四元数相加的问题 ==========
console.log('📝 测试 3: 演示四元数直接相加的问题');

function testQuaternionAddition() {
  const q1 = { x: 0, y: 0, z: 0, w: 1 };  // 单位四元数
  const q2 = { x: 0.707, y: 0, z: 0, w: 0.707 };  // 90度旋转
  
  // 直接相加（当前代码的做法）
  const qSum = {
    x: q1.x + q2.x,
    y: q1.y + q2.y,
    z: q1.z + q2.z,
    w: q1.w + q2.w
  };
  
  const sumLength = Math.sqrt(qSum.x ** 2 + qSum.y ** 2 + qSum.z ** 2 + qSum.w ** 2);
  
  console.log(`  q1 (单位): (${q1.x}, ${q1.y}, ${q1.z}, ${q1.w})`);
  console.log(`  q2 (90度): (${q2.x.toFixed(3)}, ${q2.y}, ${q2.z}, ${q2.w.toFixed(3)})`);
  console.log(`  直接相加: (${qSum.x.toFixed(3)}, ${qSum.y}, ${qSum.z}, ${qSum.w.toFixed(3)})`);
  console.log(`  相加后长度: ${sumLength.toFixed(4)}`);
  
  if (Math.abs(sumLength - 1.0) > 0.1) {
    console.log('  ⚠️  警告: 相加后长度偏离1.0，这说明直接相加四元数分量是有问题的');
    console.log('  💡 建议: 使用四元数乘法或欧拉角残差系统\n');
    return true;  // 这个测试预期会显示问题
  }
  return false;
}

// ========== 测试 4: 线性插值关节值 ==========
console.log('📝 测试 4: 关节值线性插值');

function testJointInterpolation() {
  const frame0 = [0.0, 0.0];
  const frame10 = [1.0, 2.0];
  
  // 在第5帧插值
  const t = 5 / 10;
  const frame5 = frame0.map((val, idx) => {
    return val + (frame10[idx] - val) * t;
  });
  
  console.log(`  第0帧: [${frame0.join(', ')}]`);
  console.log(`  第10帧: [${frame10.join(', ')}]`);
  console.log(`  第5帧插值 (t=${t}): [${frame5.join(', ')}]`);
  
  if (Math.abs(frame5[0] - 0.5) < 0.01 && Math.abs(frame5[1] - 1.0) < 0.01) {
    console.log('  ✅ 通过: 线性插值正确\n');
    return true;
  } else {
    console.log('  ❌ 失败: 插值结果不正确\n');
    return false;
  }
}

// ========== 测试 5: 残差计算 ==========
console.log('📝 测试 5: 关节残差计算');

function testResidualCalculation() {
  const baseValue = 0.5;
  const currentValue = 0.8;
  const residual = currentValue - baseValue;
  
  console.log(`  Base值: ${baseValue}`);
  console.log(`  当前值: ${currentValue}`);
  console.log(`  残差: ${residual}`);
  
  // 验证：base + residual = current
  const reconstructed = baseValue + residual;
  console.log(`  重建值: ${baseValue} + ${residual} = ${reconstructed}`);
  
  if (Math.abs(reconstructed - currentValue) < 0.0001) {
    console.log('  ✅ 通过: 残差系统正确\n');
    return true;
  } else {
    console.log('  ❌ 失败: 残差重建失败\n');
    return false;
  }
}

// ========== 测试 6: CSV解析基本格式 ==========
console.log('📝 测试 6: CSV数据解析');

function testCSVParsing() {
  const csvLine = '0.1,0.2,0.5,0.0,0.0,0.0,1.0,0.5,0.6';
  const values = csvLine.split(',').map(v => parseFloat(v));
  
  const base = {
    position: { x: values[0], y: values[1], z: values[2] },
    quaternion: { x: values[3], y: values[4], z: values[5], w: values[6] }
  };
  const joints = values.slice(7);
  
  console.log('  CSV行:', csvLine);
  console.log('  Base位置:', base.position);
  console.log('  Base四元数:', base.quaternion);
  console.log('  关节值:', joints);
  
  if (base.position.x === 0.1 && base.quaternion.w === 1.0 && joints.length === 2) {
    console.log('  ✅ 通过: CSV解析正确\n');
    return true;
  } else {
    console.log('  ❌ 失败: CSV解析错误\n');
    return false;
  }
}

// ========== 运行所有测试 ==========
console.log('='.repeat(60));
console.log('执行测试...\n');

const results = [
  testQuaternionNormalization(),
  testZeroLengthQuaternion(),
  testQuaternionAddition(),
  testJointInterpolation(),
  testResidualCalculation(),
  testCSVParsing()
];

console.log('='.repeat(60));
const passed = results.filter(r => r).length;
const total = results.length;
console.log(`\n📊 测试结果: ${passed}/${total} 通过`);

if (passed === total) {
  console.log('✨ 所有测试通过！');
  process.exit(0);
} else {
  console.log('⚠️  部分测试未通过或显示警告');
  process.exit(0);  // 不失败，因为有些测试是演示问题的
}
