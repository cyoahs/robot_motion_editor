#!/usr/bin/env node

/**
 * 验证四元数残差系统的正确性
 * 测试：base + residual = current 是否成立
 */

import * as THREE from 'three';

console.log('🔍 验证四元数残差系统...\n');

// 测试用例：45度 -> 90度的旋转
console.log('📝 测试案例：45度 -> 90度 (绕Z轴)');
console.log('='.repeat(60));

// Base姿态：45度绕Z轴
const qBase = new THREE.Quaternion();
qBase.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4);
console.log(`\n1️⃣ Base姿态 (45度):`);
console.log(`   四元数: (${qBase.x.toFixed(4)}, ${qBase.y.toFixed(4)}, ${qBase.z.toFixed(4)}, ${qBase.w.toFixed(4)})`);
console.log(`   角度: ${(2 * Math.acos(qBase.w) * 180 / Math.PI).toFixed(2)}度`);

// Current姿态：90度绕Z轴
const qCurrent = new THREE.Quaternion();
qCurrent.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
console.log(`\n2️⃣ Current姿态 (90度):`);
console.log(`   四元数: (${qCurrent.x.toFixed(4)}, ${qCurrent.y.toFixed(4)}, ${qCurrent.z.toFixed(4)}, ${qCurrent.w.toFixed(4)})`);
console.log(`   角度: ${(2 * Math.acos(qCurrent.w) * 180 / Math.PI).toFixed(2)}度`);

// 方法1：qResidual = qBase^(-1) * qCurrent
console.log(`\n3️⃣ 方法1: qResidual = qBase^(-1) * qCurrent`);
const qResidual1 = qBase.clone().invert().multiply(qCurrent);
console.log(`   残差: (${qResidual1.x.toFixed(4)}, ${qResidual1.y.toFixed(4)}, ${qResidual1.z.toFixed(4)}, ${qResidual1.w.toFixed(4)})`);
console.log(`   残差角度: ${(2 * Math.acos(Math.abs(qResidual1.w)) * 180 / Math.PI).toFixed(2)}度`);

// 重建：qReconstructed = qBase * qResidual
const qReconstructed1 = qBase.clone().multiply(qResidual1);
console.log(`   重建: (${qReconstructed1.x.toFixed(4)}, ${qReconstructed1.y.toFixed(4)}, ${qReconstructed1.z.toFixed(4)}, ${qReconstructed1.w.toFixed(4)})`);
console.log(`   重建角度: ${(2 * Math.acos(qReconstructed1.w) * 180 / Math.PI).toFixed(2)}度`);

const error1 = Math.abs(qReconstructed1.x - qCurrent.x) + 
              Math.abs(qReconstructed1.y - qCurrent.y) + 
              Math.abs(qReconstructed1.z - qCurrent.z) + 
              Math.abs(qReconstructed1.w - qCurrent.w);
console.log(`   误差: ${error1.toFixed(8)}`);

if (error1 < 0.0001) {
  console.log('   ✅ 方法1正确！');
} else {
  console.log('   ❌ 方法1有误差');
}

// 方法2：qResidual = qCurrent * qBase^(-1)
console.log(`\n4️⃣ 方法2: qResidual = qCurrent * qBase^(-1)`);
const qResidual2 = qCurrent.clone().multiply(qBase.clone().invert());
console.log(`   残差: (${qResidual2.x.toFixed(4)}, ${qResidual2.y.toFixed(4)}, ${qResidual2.z.toFixed(4)}, ${qResidual2.w.toFixed(4)})`);
console.log(`   残差角度: ${(2 * Math.acos(Math.abs(qResidual2.w)) * 180 / Math.PI).toFixed(2)}度`);

// 如果用方法2，重建应该是：qReconstructed = qResidual * qBase
const qReconstructed2 = qResidual2.clone().multiply(qBase);
console.log(`   重建 (qResidual * qBase): (${qReconstructed2.x.toFixed(4)}, ${qReconstructed2.y.toFixed(4)}, ${qReconstructed2.z.toFixed(4)}, ${qReconstructed2.w.toFixed(4)})`);
console.log(`   重建角度: ${(2 * Math.acos(qReconstructed2.w) * 180 / Math.PI).toFixed(2)}度`);

const error2 = Math.abs(qReconstructed2.x - qCurrent.x) + 
              Math.abs(qReconstructed2.y - qCurrent.y) + 
              Math.abs(qReconstructed2.z - qCurrent.z) + 
              Math.abs(qReconstructed2.w - qCurrent.w);
console.log(`   误差: ${error2.toFixed(8)}`);

if (error2 < 0.0001) {
  console.log('   ✅ 方法2正确！');
} else {
  console.log('   ❌ 方法2有误差');
}

console.log('\n' + '='.repeat(60));
console.log('\n📊 结论:');
console.log('   方法1 (推荐): qResidual = qBase^(-1) * qCurrent, 重建 = qBase * qResidual');
console.log('   方法2: qResidual = qCurrent * qBase^(-1), 重建 = qResidual * qBase');
console.log('\n   两种方法都正确，但方法1更符合变换的物理意义：');
console.log('   先有base旋转，再应用residual增量旋转。');

// 测试反向情况（90度 -> 45度）
console.log('\n\n📝 测试反向案例：90度 -> 45度');
console.log('='.repeat(60));

const qBase2 = new THREE.Quaternion();
qBase2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);

const qCurrent2 = new THREE.Quaternion();
qCurrent2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4);

console.log(`\nBase: 90度, Current: 45度`);

const qResidual3 = qBase2.clone().invert().multiply(qCurrent2);
const qReconstructed3 = qBase2.clone().multiply(qResidual3);

console.log(`残差角度: ${(2 * Math.acos(Math.abs(qResidual3.w)) * 180 / Math.PI).toFixed(2)}度`);
console.log(`重建角度: ${(2 * Math.acos(qReconstructed3.w) * 180 / Math.PI).toFixed(2)}度`);

const error3 = Math.abs(qReconstructed3.x - qCurrent2.x) + 
              Math.abs(qReconstructed3.y - qCurrent2.y) + 
              Math.abs(qReconstructed3.z - qCurrent2.z) + 
              Math.abs(qReconstructed3.w - qCurrent2.w);

if (error3 < 0.0001) {
  console.log('✅ 反向旋转也正确！\n');
} else {
  console.log('❌ 反向旋转有问题\n');
}
