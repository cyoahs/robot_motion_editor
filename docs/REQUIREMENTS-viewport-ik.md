# 需求规格说明：同屏叠显视口与末端 IK 编辑

| 属性 | 内容 |
|------|------|
| 文档版本 | v1.0 |
| 状态 | 待评审 / 待开发 |
| 适用产品 | 机器人关键帧编辑器（robot_motion_editor） |
| 主要参考机型 | **Unitree G1**（URDF + seed/unitree 轨迹） |
| 关联文档 | [DEVELOPMENT.md](../DEVELOPMENT.md)、[USAGE.md](../USAGE.md)、[seed_format.md](../seed_format.md) |

---

## 1. 背景与目标

### 1.1 背景

当前版本在同一页面内采用**左右分屏**双视口：左侧仅显示 CSV 原始轨迹（Base），右侧显示叠加关键帧残差后的编辑轨迹（Modified）。该方式占用横向空间、对比时需视线左右切换，且无法在同一视角下直观感受姿态偏差。

编辑能力以**关节空间**（侧栏滑块、曲线编辑器）和**基座空间**为主，**不具备**末端连杆位姿拖拽与逆运动学（IK）求解。

### 1.2 目标

1. **默认同屏叠显**：参考轨迹与编辑轨迹处于**同一 3D 画面**；参考模型为**半透明 Ghost**，可调颜色，降低遮挡。
2. **保留左右分屏**为可选项，满足习惯旧交互的用户。
3. 基于 **closed-chain-ik** 实现**手臂与腿部**的末端空间编辑；末端 **Link** 通过**下拉框**配置。
4. 以 **Unitree G1** 为主要验收机型；拖拽末端结束时**自动写入当前帧关键帧**（残差体系与现有一致）。

### 1.3 非目标（本期不做）

- 多机器人/多 URDF 同场景编辑
- 全身同时多末端 IK（仅**单激活链**求解；其余链静止）
- 云端 IK 服务、实时硬件下发
- 自动从 GLB 生成 URDF
- 足底闭链双足约束（可作为后续增强项）

---

## 2. 术语

| 术语 | 定义 |
|------|------|
| Base 轨迹 | CSV 加载的只读原始运动数据 |
| 编辑轨迹 | Base + 关键帧残差插值后的结果 |
| Ghost 参考模型 | 仅展示 Base 状态的机器人实例，半透明、可配色 |
| 编辑模型 | 展示编辑后状态的机器人实例，不透明（或略高于 Ghost 的不透明度） |
| 末端 Link | URDF 运动链末端 `URDFLink`，作为 IK 目标位姿附着点 |
| IK 链 | 从某固定关节到末端 Link 的串联关节集合 |
| 关键帧残差 | 现有 `trajectoryManager` 中 `residual` / `baseResidual` 机制 |

---

## 3. 用户故事

| ID | 作为… | 我希望… | 以便… |
|----|--------|---------|--------|
| US-01 | 动画师 | 默认在同一画面看到半透明参考姿态和实心编辑姿态 | 直接对比偏差而不用左右看 |
| US-02 | 动画师 | 用复选框开关参考/编辑模型及各自重心显示 | 聚焦单条轨迹或减少视觉干扰 |
| US-03 | 动画师 | 自定义参考 Ghost 颜色 | 在不同主题/背景下仍清晰可辨 |
| US-04 | 动画师 | 切换回左右分屏模式 | 沿用旧工作流 |
| US-05 | 动画师 | 在侧栏选择末端 Link 并拖拽 3D 手柄 | 用末端空间直觉调整手臂/腿 |
| US-06 | 动画师 | 拖完末端自动在当前帧打关键帧 | 少点一次按钮、与滑块编辑一致 |
| US-07 | 工程师 | 工程文件保存 IK 链配置（末端 Link 等） | 重开工程无需重新配置 G1 |

---

## 4. 功能需求：视口与模型显示（FR-V）

### FR-V-01 视口模式

| 项 | 说明 |
|----|------|
| 模式 | `overlay`（同屏叠显）、`split`（左右分屏） |
| **默认值** | **`overlay`** |
| 切换入口 | 3D 视口顶部工具条：单选或下拉「视口：同屏叠显 / 左右分屏」 |
| 持久化 | 写入 `localStorage`（键名建议 `viewportMode`），与自动保存 Cookie 逻辑独立；加载工程时可选择是否覆盖（默认沿用用户上次选择） |

**同屏叠显（overlay）**

- 单一 `THREE.Scene`、单一 `OrthographicCamera`、单一 `OrbitControls`。
- 同一画布全宽渲染，**不使用** `setScissor` 左右切分。
- 同时存在 `robotGhost`（Base）与 `robotEdited`（Modified）两个 `URDFRobot` 实例。

**左右分屏（split）**

- 行为与**当前线上版本**等价：左 Base、右 Modified，相机同步，中间分隔线。
- 实现上可保留现有双场景路径，或由 `viewportManager` 在两种拓扑间切换。

### FR-V-02 Ghost 参考模型

| 属性 | 要求 |
|------|------|
| 数据来源 | 当前帧 `trajectoryManager.getBaseState(frame)` |
| 不透明度 | **0.35 ~ 0.50**，默认 **0.40**；可在视口工具条用滑块调节（步进 0.05） |
| 深度写入 | `depthWrite: false`（推荐），减轻与编辑模型重叠时的 z-fighting |
| 渲染顺序 | Ghost `renderOrder` 低于编辑模型，保证编辑模型优先显示 |
| 颜色 | 用户可选预设色 + 自定义颜色（`<input type="color">`） |
| 预设色（建议） | 青 `#4ec9b0`、绿 `#6a9955`、蓝 `#569cd6`、紫 `#c586c0`（需适配深/浅主题对比度） |
| 交互 | Ghost **不可**被 TransformControls / 射线选中；`raycast` 对 Ghost 子网格关闭或单独 layer |

### FR-V-03 编辑模型

| 属性 | 要求 |
|------|------|
| 数据来源 | 当前帧 `trajectoryManager.getCombinedState(frame)` |
| 外观 | 保持 URDF 原始材质为主，可做轻微色调区分（可选，默认不改色） |
| 不透明度 | 1.0（不透明） |
| 交互 | IK 手柄、跟随相机、COM/包络线默认绑定编辑模型 |

### FR-V-04 显示开关（复选框）

视口左上角（或工具条内）提供：

| 控件 | 控制对象 | 默认 |
|------|----------|------|
| ☑ 显示参考轨迹 (Ghost) | `robotGhost.visible`、Ghost 关联 COM（若开启） | 开 |
| ☑ 显示编辑轨迹 | `robotEdited.visible`、编辑模型 COM | 开 |

- 切换即时生效，无需刷新。
- 图例展示当前 Ghost 色块 + 文案，与复选框对齐。

### FR-V-05 重心与包络线

| 模式 | Ghost | 编辑 |
|------|-------|------|
| COM 标记颜色 | 与 Ghost 主色一致或降饱和 | 保持现有红色系或主题警告色 |
| 包络线 | 可选：仅编辑模型计算；Ghost 不画包络线（默认） | 与现逻辑一致 |
| 复选框关闭 | 对应实例 COM 隐藏 | 同左 |

### FR-V-06 相机与辅助 UI

- 移除 overlay 模式下左右角标「原始轨迹 / 编辑后」；改为**图例 + 复选框**（FR-V-04）。
- split 模式保留左右角标。
- 右下角 `axisGizmo` 在两种模式下均使用**全宽视口**计算位置。
- `followRobot` 仅跟踪 **编辑模型** 根位姿。

### FR-V-07 视频导出

- `overlay`：导出画面为同屏双色（与屏幕一致，尊重复选框状态）。
- `split`：保持现有左右拼接导出逻辑。

### FR-V-08 工程保存 / 自动保存

工程 JSON 扩展字段（向后兼容，旧工程缺省则用默认值）：

```json
{
  "viewport": {
    "mode": "overlay",
    "ghostOpacity": 0.4,
    "ghostColor": "#4ec9b0",
    "showGhost": true,
    "showEdited": true
  }
}
```

---

## 5. 功能需求：末端 IK（FR-IK）

### FR-IK-01 技术选型

| 项 | 要求 |
|----|------|
| 库 | **closed-chain-ik**（`gkjohnson/closed-chain-ik-js`） |
| URDF 桥接 | `URDFUtils.urdfRobotToIKRoot`、`setIKFromUrdf`、`setUrdfFromIK` |
| 3D 交互 | `THREE.TransformControls`（平移 + 旋转，空间：世界或局部可配置，默认**世界**） |
| 求解时机 | `objectChange` / `dragging-changed` 节流；`dragging-changed` 结束且求解成功时触发关键帧（见 FR-IK-06） |

依赖新增需在 `package.json` 声明；实施前完成与 `three@0.160`、`urdf-loader@0.12.x` 的 Spike 兼容性验证。

### FR-IK-02 IK 链与末端 Link 配置

**配置 UI（侧栏区块「IK 编辑」）**

| 控件 | 说明 |
|------|------|
| 启用 IK | 主开关；关闭时隐藏 TransformControls |
| 末端 Link | **下拉框**，选项为当前 URDF 中所有 `URDFLink` 名称（按字母或树序排序） |
| 链根关节（高级，可折叠） | 可选下拉：自动推断 / 手动选择链上某一 `URDFJoint`；默认**自动** |

**自动推断规则（G1 及通用人形）**

从所选末端 Link 向上遍历 URDF 树，直到遇到以下**停止关节**之一：

- 躯干：`waist_*`、`torso`、`pelvis`、`base_link` 的父关节
- 或对侧分支（遇到非当前肢体的 `left_` / `right_` 前缀切换）

链上仅包含 `revolute` / `continuous` / `prismatic` 关节；`fixed` 跳过。

**G1 默认预设（加载 G1 URDF 后自动填充下拉默认值，可改）**

| 预设名 | 建议末端 Link（示例，以实际 URDF 为准） | 备注 |
|--------|----------------------------------------|------|
| 左手 | 含 `left` + `wrist` / `hand` / `palm` 的 link | 7 DOF 臂 |
| 右手 | 含 `right` + `wrist` / `hand` / `palm` | 同上 |
| 左脚 | 含 `left` + `ankle` / `foot` | 腿链 |
| 右脚 | 含 `right` + `ankle` / `foot` | 同上 |

seed 轨迹关节名参考：[seed_format.md](../seed_format.md)（`left_*_joint_dof` 等），**IK 链以 URDF Link/Joint 名为准**，与 CSV 列通过现有 `jointController` 名称对齐。

用户可从下拉框任选 Link（不限于四肢），以满足非标准 mesh 命名。

### FR-IK-03 求解行为

| 项 | 说明 |
|----|------|
| 求解对象 | **仅 `robotEdited`** |
| 浮动基座 | 当前帧 **combined** 的 root 位姿作为固定约束，**不参与**该链 IK（腰关节若在链内则参与） |
| 关节限位 | 使用 URDF `<limit lower/upper>` |
| 目标 | TransformControls 的位姿 → `Goal` 附着末端 link |
| 失败 | 位置/姿态误差超阈值：不提交关节角、Toast/状态栏提示「IK 无解或超限」、不自动关键帧 |
| 性能 | 单链 DOF ≥ 6 时优先 `WorkerSolver`；拖拽过程 ≤ 30ms/帧 为目标（G1 实机 URDF 测定） |

### FR-IK-04 腿链附加选项（与臂共用面板）

| 选项 | 默认 | 说明 |
|------|------|------|
| 锁定足底高度 | 关 | 开启时求解后强制末端 link 原点 z = 拖拽开始时 z（软约束或后处理） |
| 仅位置 / 位置+姿态 | 位置+姿态 | 腿预设默认「位置+姿态」；臂同 |

### FR-IK-05 与残差 / 关节 UI 同步

求解成功后：

1. `URDFUtils.setUrdfFromIK(robotEdited, ikRoot)`
2. `robotEdited.updateMatrixWorld(true)`
3. `jointController` 从 `robotEdited` 同步滑块数值
4. `baseController` 若腰/基座在链外则保持 combined 基座不变

### FR-IK-06 自动关键帧（已确认）

| 事件 | 行为 |
|------|------|
| TransformControls **`pointerup` 且 `dragging === false`** | 若 IK 成功且相对求解前有可感知变化（关节角 Δ > 1e-4 rad） |
| 调用 | `trajectoryManager.addKeyframe(currentFrame, jointValues, baseValues)`，逻辑与 `jointController.autoUpdateKeyframe` / 手动「添加关键帧」一致 |
| UI 反馈 | 时间轴当前帧出现关键帧标记；曲线编辑器刷新 |
| 拖动中 | 仅预览，**不**每帧写入关键帧 Map |

若当前帧**已有**关键帧：视为**更新**该帧残差（覆盖），不新增帧号。

### FR-IK-07 播放与时间轴

- 播放动画时：**禁用** TransformControls，避免与插值冲突。
-  scrub 时间轴：若 IK 开启，将手柄同步到当前帧末端 link 世界位姿（`forward kinematics` 由 `robotEdited` 姿态得出）。

### FR-IK-08 工程持久化

```json
{
  "ik": {
    "enabled": false,
    "endEffectorLink": "left_wrist_yaw_link",
    "chainRootJoint": null,
    "legLockFootZ": false,
    "goalMode": "positionAndOrientation"
  }
}
```

### FR-IK-09 单激活链

- 同时仅 **1 条** IK 链激活（一个末端下拉选择）。
- 切换末端下拉时：重建 IK 树、重定位 TransformControls。

---

## 6. Unitree G1 验收基准

### 6.1 资产

- URDF：官方或团队提供的 **G1** 完整包（mesh + urdf），关节数与 seed 示例一致（腰 3 + 腿 6×2 + 臂 7×2 = 29 可动轴，以实际 URDF 为准）。
- 轨迹：至少 1 条 **seed 格式** G1 CSV（见 `seed_format.md`）及 1 条 unitree 格式。

### 6.2 验收场景

| # | 场景 | 通过标准 |
|---|------|----------|
| G1-01 | 加载 G1 URDF + seed CSV，默认 overlay | Ghost 半透明，编辑模型实心，同视角可对比 |
| G1-02 | 调整 Ghost 颜色与不透明度 | 实时生效，工程保存可恢复 |
| G1-03 | 切换 split | 与现版左右分屏行为一致 |
| G1-04 | 左手末端下拉 + 拖拽 | 肩肘腕随动，关节限位不爆 |
| G1-05 | 左脚末端下拉 + 拖拽 | 髋膝踝随动；可选锁足高度 |
| G1-06 | 拖末端松手 | 当前帧自动关键帧，导出 CSV 含修改 |
| G1-07 | 播放中 | 无 TransformControls；播放结束可继续 IK |
| G1-08 | 换右臂/右腿预设 | 下拉切换后链正确 |

---

## 7. UI 线框（逻辑布局）

```
┌─ 工具栏（加载 URDF / CSV / 工程…）────────────────────────────┐
├─ main-content ─────────────────────────────────────────────────┤
│ ┌─ #viewport ─────────────────────────────┐ ┌─ sidebar ────────┐ │
│ │ [视口: ●同屏叠显 ○左右分屏]              │ │ …基体/关节…      │ │
│ │ ☑参考(Ghost) ☑编辑  Ghost色 [■] 透明[===]│ │ ▶ IK 编辑        │ │
│ │ ┌图例: ■ 参考  ■ 编辑────────────────┐  │ │  ☑ 启用 IK       │ │
│ │ │     [ 3D：Ghost + 实心编辑模型 ]    │  │ │  末端 Link [▼]  │ │
│ │ │     [ TransformControls @ 末端 ]   │  │ │  ☐ 锁足高度      │ │
│ │ └────────────────────────────────────┘  │ │  目标: ○位姿 ●位姿+姿态│
│ │ [相机 / COM / 包络线 … 现有按钮]         │ └──────────────────┘ │
│ └────────────────────────────────────────┘                       │
├─ timeline + curve editor（现有）───────────────────────────────┤
└────────────────────────────────────────────────────────────────┘
```

---

## 8. 架构与模块划分

| 模块 | 职责 |
|------|------|
| `src/viewportManager.js` | 模式切换、单/双场景、Ghost 材质、复选框、localStorage |
| `src/main.js` | 编排；`updateRobotState` 重命名为语义化 `robotGhost` / `robotEdited` |
| `src/ik/ikChainRegistry.js` | Link 列表、自动链推断、G1 预设 |
| `src/ik/ikSolverService.js` | closed-chain-ik 封装、Worker、误差判定 |
| `src/ik/endEffectorControls.js` | TransformControls、拖拽生命周期、自动关键帧 |
| `src/ik/ikPanel.js` | 侧栏 DOM 与 i18n |
| `index.html` / `i18n.js` | 新控件与文案 |

**数据流（IK 一次拖拽）**

```
用户拖 TransformControls
  → ikSolverService.solve(goal)
  → setUrdfFromIK(robotEdited)
  → jointController 同步
  → pointerup → trajectoryManager.addKeyframe
  → timeline / curveEditor 刷新
```

---

## 9. 非功能需求（NFR）

| ID | 类别 | 要求 |
|----|------|------|
| NFR-01 | 隐私 | IK 仅在浏览器本地计算，无上传 |
| NFR-02 | 兼容 | Chrome / Edge 最近两个大版本；WebGL2 |
| NFR-03 | 性能 | G1 overlay 下 60fps 预览（无 IK 拖拽时） |
| NFR-04 | 可维护 | 视口与 IK 解耦，split 模式回归测试清单固定 |
| NFR-05 | 国际化 | 中文/英文键值入 `i18n.js` |
| NFR-06 | 向后兼容 | 旧工程无 `viewport`/`ik` 字段时使用文档默认值 |

---

## 10. 实施阶段与交付物

| 阶段 | 范围 | 交付物 | 建议工期 |
|------|------|--------|----------|
| **P1** | FR-V 全部 + 工程字段 | overlay 默认、Ghost、复选框、split 可选、导出 | 3~5 天 |
| **P2** | FR-IK Spike + 单链臂 | closed-chain-ik 集成、下拉 Link、自动关键帧 | 4~6 天 |
| **P3** | 腿链 + G1 验收 | 锁足、预设、Worker、G1-01~08 通过 | 4~5 天 |
| **P4** | 文档与回归 | USAGE/DEVELOPMENT 更新、测试脚本 | 1~2 天 |

---

## 11. 验收标准（总表）

### 11.1 视口

- [ ] 首次打开默认为**同屏叠显**
- [ ] Ghost 不透明度在 **0.35~0.5** 可调，默认 0.4
- [ ] Ghost **颜色可选**且可保存到工程
- [ ] 复选框可独立隐藏参考/编辑模型
- [ ] **左右分屏**可从 UI 切换且功能与现版一致
- [ ] 视频导出与当前视口模式一致

### 11.2 IK

- [ ] 使用 **closed-chain-ik** 实现求解
- [ ] **下拉框**可选择任意末端 Link；臂、腿均可配置
- [ ] 拖拽末端松手后**自动** `addKeyframe`（更新或新建当前帧）
- [ ] 求解失败有提示且不写关键帧
- [ ] **G1** URDF + seed CSV 通过第 6.2 节全部场景

---

## 12. 风险与依赖

| 风险 | 缓解 |
|------|------|
| closed-chain-ik 与 three 版本不兼容 | P2 首日 Spike；必要时锁版本 |
| G1 URDF Link 命名与预设不一致 | 预设仅作初始值；以下拉手动选择为准 |
| Ghost + 实心模型 z-fighting | depthWrite off + renderOrder |
| 自动关键帧过于频繁 | 仅在 pointerup + 变化阈值通过时写入 |
| split/overlay 双路径维护成本 | 统一 `viewportManager` API，避免 main.js 分支膨胀 |

---

## 13. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-05-30 | 初稿：视口叠显 + Ghost + closed-chain-ik + G1 + 自动关键帧 |

---

## 14. 已确认产品决策（评审锁定）

1. 参考模型：**半透明 Ghost**，opacity **0.35~0.5**，**可选颜色**。
2. 默认视口：**同屏叠显**；**左右分屏**保留为可选项。
3. IK：**closed-chain-ik**；末端 **Link 下拉配置**；**手臂与腿**均支持。
4. 主验收机型：**Unitree G1**。
5. 拖末端：**自动打关键帧**（pointerup，更新当前帧残差）。
