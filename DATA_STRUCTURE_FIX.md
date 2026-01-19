# 数据结构修复说明

## 问题描述

工程文件保存时，关键帧数据结构存在不一致：
- **保存时**：使用 `{ baseValues, residuals: { joints, base } }` 结构
- **期望结构**：`{ residual, baseResidual }` 结构

导致保存的工程文件中 keyframes 只有 `frameIndex`，没有 `residual` 和 `baseResidual` 数据。

## 修复内容

### 1. 统一关键帧数据结构

**标准结构**（src/trajectoryManager.js）：
```javascript
{
  residual: number[],           // 关节角度残差数组
  baseResidual: {               // 基体残差（可为 null）
    position: {x, y, z},
    quaternion: {x, y, z, w}
  } | null
}
```

### 2. 修复的方法

#### `addKeyframe()` - Line 323
- ✅ 使用正确的结构保存：`{ residual, baseResidual }`

#### `getInterpolatedResidual()` - Line 145
- ✅ 简化数据读取，移除旧结构兼容代码
- ✅ 统一使用 `kf.residual`

#### `getInterpolatedBaseResidual()` - Line 211  
- ✅ 简化数据读取
- ✅ 统一使用 `kf.baseResidual`

#### `loadProjectData()` - Line 476
- ✅ 直接加载为正确结构：`{ residual, baseResidual }`
- ✅ 添加数据验证和错误处理
- ✅ 移除旧结构转换代码

#### `getProjectData()` - Line 445
- ✅ 已经是正确的（无需修改）

#### `getKeyframes()` - Line 66
- ✅ 返回正确的结构字段

### 3. 添加的注释

在类顶部添加了详细的数据结构说明：
```javascript
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
```

## 验证

创建了 `tests/data-structure-test.js` 来验证：
- ✅ 保存流程：addKeyframe → getProjectData
- ✅ 加载流程：loadProjectData → keyframes.get
- ✅ 数据一致性：保存前后数据完全匹配

测试结果：🎉 所有测试通过！

## 影响范围

- ✅ **TrajectoryManager**: 内部数据结构已统一
- ✅ **其他模块**: 只访问 `keyframes.keys()`，不受影响
- ✅ **向后兼容**: 保留了版本检测，旧文件会提示用户

## 建议

1. 如果有旧的工程文件（version 1.0），建议重新创建关键帧
2. 新的工程文件（version 2.0）已完全修复，可正常保存/加载
3. 数据结构已文档化，方便后续维护
