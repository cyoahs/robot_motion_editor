# 曲线可视化交互优化

## 修改内容

### 1. 点击关节控制框切换曲线显示

**文件**: `src/jointController.js`

- ✅ 整个关节控制框现在可点击（`control.addEventListener('click', toggleCurve)`）
- ✅ 点击时切换对应关节曲线的显示/隐藏
- ✅ 不再需要点击标签，整个框都可点击

### 2. 显示状态下框框变色

**实现逻辑**:
- 显示曲线时：框框背景色 = 曲线颜色 + 20% 透明度
- 隐藏曲线时：框框背景色 = 透明（默认）

**相关方法**:
- `updateCurveBackgrounds()` - 更新所有关节控制框的背景颜色
- 在 `toggleCurveVisibility()` 时自动调用

### 3. 关键帧状态圈圈指示器

**位置**: 每个关节名字后面

**三种状态**:
- 🔴 **实心圈** (背景: `var(--accent-warning)`) - 当前帧是关键帧且有残差
- ⚪ **空心圈** (透明背景 + 边框) - 有关键帧残差但当前不在关键帧上
- ❌ **不显示** - 该关节在所有关键帧中都没有残差

**更新时机**:
- 切换帧时 (`timelineController.setCurrentFrame`)
- 添加关键帧时 (`main.addKeyframe`)
- 删除关键帧时 (`main.deleteCurrentKeyframe`)
- 更新关节值时 (`jointController.updateJoints`)

### 4. 数据流程

```
用户操作
  ↓
切换帧 / 添加关键帧 / 删除关键帧
  ↓
updateKeyframeIndicators() → 检查所有关节的关键帧残差状态
  ↓
更新圈圈显示（实心/空心/隐藏）
```

```
点击关节控制框
  ↓
toggleCurve() → curveEditor.toggleCurveVisibility()
  ↓
updateCurveBackgrounds() → 更新所有关节框背景色
  ↓
draw() → 重绘曲线
```

## 修改的文件

### `src/jointController.js`
- ✅ 修改 `setupUI()` - 添加关键帧状态圈圈，整个框可点击
- ✅ 新增 `updateKeyframeIndicators()` - 更新关键帧状态圈圈
- ✅ 新增 `updateCurveBackgrounds()` - 更新曲线显示状态背景色
- ✅ 修改 `updateJoints()` - 调用关键帧指示器更新

### `src/curveEditor.js`
- ✅ 修改 `toggleCurveVisibility()` - 切换时更新背景色
- ✅ 修改 `resetToDefault()` - 使用正确的数据结构 + 更新背景色
- ✅ 删除重复的方法定义

### `src/timelineController.js`
- ✅ 修改 `setCurrentFrame()` - 切换帧时更新关键帧指示器

### `src/main.js`
- ✅ 修改 `addKeyframe()` - 添加关键帧后更新指示器
- ✅ 修改 `deleteCurrentKeyframe()` - 删除关键帧后更新指示器

## 样式说明

**关键帧圈圈 CSS**:
```css
display: inline-block;
width: 8px;
height: 8px;
border-radius: 50%;
margin-left: 6px;
border: 1.5px solid var(--accent-warning);
```

**控制框背景色**:
```javascript
control.style.backgroundColor = color + '20'; // 曲线颜色 + 20% 透明度
```

## 用户体验改进

1. **更直观** - 一眼就能看出哪些关节有关键帧，哪些在当前帧上
2. **更方便** - 点击整个框而非小标签，更容易操作
3. **更清晰** - 背景变色让曲线显示状态一目了然
4. **实时反馈** - 圈圈状态随时间轴和关键帧变化实时更新
