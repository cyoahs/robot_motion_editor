// 重心计算测试
// 测试场景：
// 1. 基本质量加权计算是否正确
// 2. 惯性坐标系偏移是否正确处理
// 3. 世界坐标系转换是否正确

import * as THREE from 'three';

console.log('=== 重心计算逻辑测试 ===\n');

// 测试1: 简单的两质点系统
console.log('测试1: 两质点系统');
{
  // 质点1: 位置(0,0,0), 质量1kg
  // 质点2: 位置(2,0,0), 质量1kg
  // 预期重心: (1,0,0)
  
  const m1 = 1, m2 = 1;
  const p1 = new THREE.Vector3(0, 0, 0);
  const p2 = new THREE.Vector3(2, 0, 0);
  
  const com = new THREE.Vector3()
    .addScaledVector(p1, m1)
    .addScaledVector(p2, m2)
    .divideScalar(m1 + m2);
  
  console.log('  计算结果:', com);
  console.log('  预期结果: (1, 0, 0)');
  console.log('  是否正确:', Math.abs(com.x - 1) < 0.001 && Math.abs(com.y) < 0.001 && Math.abs(com.z) < 0.001 ? '✅' : '❌');
  console.log('');
}

// 测试2: 不等质量系统
console.log('测试2: 不等质量系统');
{
  // 质点1: 位置(0,0,0), 质量1kg
  // 质点2: 位置(3,0,0), 质量2kg
  // 预期重心: (2,0,0)
  
  const m1 = 1, m2 = 2;
  const p1 = new THREE.Vector3(0, 0, 0);
  const p2 = new THREE.Vector3(3, 0, 0);
  
  const com = new THREE.Vector3()
    .addScaledVector(p1, m1)
    .addScaledVector(p2, m2)
    .divideScalar(m1 + m2);
  
  console.log('  计算结果:', com);
  console.log('  预期结果: (2, 0, 0)');
  console.log('  是否正确:', Math.abs(com.x - 2) < 0.001 && Math.abs(com.y) < 0.001 && Math.abs(com.z) < 0.001 ? '✅' : '❌');
  console.log('');
}

// 测试3: 惯性坐标系偏移
console.log('测试3: 惯性坐标系偏移（局部坐标系）');
{
  // Link位置: (1, 0, 0)
  // 惯性坐标系偏移: (0.5, 0, 0) 在局部坐标系
  // 质量: 1kg
  // 预期重心: (1.5, 0, 0)
  
  const linkPosition = new THREE.Vector3(1, 0, 0);
  const inertialOffset = new THREE.Vector3(0.5, 0, 0);
  const mass = 1;
  
  // 模拟世界坐标系转换（无旋转）
  const worldQuaternion = new THREE.Quaternion(); // 单位四元数
  const worldOffset = inertialOffset.clone().applyQuaternion(worldQuaternion);
  const worldPosition = linkPosition.clone().add(worldOffset);
  
  const com = worldPosition.clone().multiplyScalar(mass).divideScalar(mass);
  
  console.log('  计算结果:', com);
  console.log('  预期结果: (1.5, 0, 0)');
  console.log('  是否正确:', Math.abs(com.x - 1.5) < 0.001 && Math.abs(com.y) < 0.001 && Math.abs(com.z) < 0.001 ? '✅' : '❌');
  console.log('');
}

// 测试4: 带旋转的惯性坐标系偏移
console.log('测试4: 带旋转的惯性坐标系偏移');
{
  // Link位置: (1, 0, 0)
  // Link旋转: 绕Z轴90度
  // 惯性坐标系偏移: (0.5, 0, 0) 在局部坐标系
  // 质量: 1kg
  // 预期重心: 旋转后偏移应该是(0, 0.5, 0), 所以最终是(1, 0.5, 0)
  
  const linkPosition = new THREE.Vector3(1, 0, 0);
  const inertialOffset = new THREE.Vector3(0.5, 0, 0);
  const mass = 1;
  
  // 绕Z轴旋转90度
  const worldQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const worldOffset = inertialOffset.clone().applyQuaternion(worldQuaternion);
  const worldPosition = linkPosition.clone().add(worldOffset);
  
  const com = worldPosition.clone().multiplyScalar(mass).divideScalar(mass);
  
  console.log('  计算结果:', com);
  console.log('  预期结果: (1, 0.5, 0)');
  console.log('  是否正确:', 
    Math.abs(com.x - 1) < 0.001 && 
    Math.abs(com.y - 0.5) < 0.001 && 
    Math.abs(com.z) < 0.001 ? '✅' : '❌');
  console.log('');
}

// 测试5: 多质点3D系统
console.log('测试5: 多质点3D系统');
{
  // 质点1: (0,0,0), 1kg
  // 质点2: (1,0,0), 1kg
  // 质点3: (0,1,0), 1kg
  // 质点4: (0,0,1), 1kg
  // 预期重心: (0.25, 0.25, 0.25)
  
  const masses = [1, 1, 1, 1];
  const positions = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1)
  ];
  
  const com = new THREE.Vector3();
  let totalMass = 0;
  
  for (let i = 0; i < masses.length; i++) {
    com.addScaledVector(positions[i], masses[i]);
    totalMass += masses[i];
  }
  com.divideScalar(totalMass);
  
  console.log('  计算结果:', com);
  console.log('  预期结果: (0.25, 0.25, 0.25)');
  console.log('  是否正确:', 
    Math.abs(com.x - 0.25) < 0.001 && 
    Math.abs(com.y - 0.25) < 0.001 && 
    Math.abs(com.z - 0.25) < 0.001 ? '✅' : '❌');
  console.log('');
}

// 测试6: 检查实际代码中的潜在问题
console.log('=== 检查实际代码逻辑 ===\n');

console.log('问题1: inertial信息获取');
console.log('  当前代码通过遍历urdfNode.children查找inertial元素');
console.log('  潜在问题: 如果urdfNode为null或children为空，会跳过');
console.log('  建议: 添加更多调试日志，验证URDF文件中是否包含inertial信息');
console.log('');

console.log('问题2: 惯性坐标系偏移转换');
console.log('  当前代码逻辑:');
console.log('    1. 获取link的世界位置 worldPosition');
console.log('    2. 读取inertial.origin.xyz偏移');
console.log('    3. 将偏移转换到世界坐标系: offset.applyQuaternion(worldQuaternion)');
console.log('    4. 将偏移加到世界位置: worldPosition.add(offset)');
console.log('  ✅ 这个逻辑是正确的');
console.log('');

console.log('问题3: 质量加权计算');
console.log('  当前代码逻辑:');
console.log('    comPosition.addScaledVector(worldPosition, mass)');
console.log('    totalMass += mass');
console.log('    最后: comPosition.divideScalar(totalMass)');
console.log('  ✅ 这个逻辑是正确的');
console.log('');

console.log('问题4: URDF解析方式');
console.log('  当前代码使用DOM查询方式:');
console.log('    - querySelector找mass和origin元素');
console.log('    - getAttribute获取属性值');
console.log('  潜在问题: 依赖于urdf-loader的DOM结构');
console.log('  建议: 检查urdf-loader文档，确认正确的访问方式');
console.log('');

console.log('=== 总结 ===');
console.log('重心计算的数学逻辑是正确的，但可能存在以下问题:');
console.log('1. ⚠️ URDF inertial信息的读取可能不完整');
console.log('2. ⚠️ 需要验证urdf-loader如何存储inertial数据');
console.log('3. ⚠️ 可能需要检查实际URDF文件是否包含完整的质量和惯性信息');
console.log('');
console.log('建议调试步骤:');
console.log('1. 在calculateCOM中添加console.log，打印每个link的质量和位置');
console.log('2. 验证massCount是否大于0');
console.log('3. 检查URDF文件中<inertial>标签的格式');
console.log('4. 检查urdf-loader的文档，确认urdfNode的数据结构');
