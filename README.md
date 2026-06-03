# 机器人关键帧编辑器

基于 Web 的机器人运动编辑工具，支持 **URDF 文件夹拖入**、CSV 轨迹编辑、双视口对比、IK 末端编辑与工程文件管理。

**Other language:** [English](README.en.md)

## 🌐 在线体验

[robot-motion-ik-editor.fandesfyf.workers.dev](https://robot-motion-ik-editor.fandesfyf.workers.dev/) | 托管于 Cloudflare Workers

## 🎬 功能演示

录屏经 ffmpeg 压缩（1280px / H.264）后存放于 `docs/assets/demo/`。

### IK 末端编辑

拖拽末端位姿、写入关键帧与求解参数调节。

<video src="docs/assets/demo/end-effector-ik-edit.mp4" controls width="100%"></video>

### 关节编辑

侧栏关节滑条、关键帧与曲线面板联动编辑。

<video src="docs/assets/demo/joint-edit.mp4" controls width="100%"></video>

### 可视化设置

视口工具栏：Ghost 参考模型、叠显/分屏、播放倍率等。

<video src="docs/assets/demo/viewport-settings.mp4" controls width="100%"></video>

## 🔒 隐私安全

✅ **完全本地运行** — 所有数据处理在浏览器完成，无服务器上传

## ✨ 核心特性

### 轨迹与关键帧

- **残差关键帧**：在 CSV 基线轨迹上叠加关节/基座位姿残差，支持线性/贝塞尔插值
- **关键帧剪贴板**：复制、粘贴、删除；支持拖拽移动关键帧（保留绝对编辑内容）
- **快捷键**：`Ctrl+C` / `Ctrl+V` 复制粘贴，`Delete` / `Backspace` 删除（右键菜单内显示对应提示）

### 拖入导入（URDF / CSV）

- **URDF 整包拖入**：将机器人资源**文件夹**（含 `.urdf` 与 `meshes/` 等）直接拖到浏览器窗口，无需先点「选择文件夹」
- **递归读取**：自动遍历子目录，保留相对路径，mesh（STL/DAE 等）与 `package://` 引用可正常解析
- **CSV 拖入**：可将 `.csv` 轨迹文件单独拖入；若文件夹内同时含 URDF 与 CSV，会按类型分别加载
- **拖入遮罩提示**：拖入时全屏提示「拖放 URDF 文件夹或 CSV 轨迹文件到此处」

### 3D 视口

- **同屏叠显 / 左右分屏**：参考轨迹以 Ghost 半透明叠加，或左右对比；相机可同步
- **视口工具栏**：Ghost 显隐与透明度、播放倍率、叠显/分屏切换等
- **坐标轴指示器**：右下角快速切换正交视角

### IK 末端编辑

- **IK 末端编辑面板**：基于 [closed-chain-ik](https://www.npmjs.com/package/closed-chain-ik) 的末端位姿拖拽
- **位置/姿态分离**：统一权重与参考四元数增量，避免姿态求解破坏已收敛位置
- **在线调参**：求解迭代、阻尼、收敛阈值等；可选调试日志与可视化
- **URDF↔IK 校验**：运动链注册与 FK 闭环辅助（见 `tests/`）

### 曲线与时间轴

- **按需显示曲线**：点击关节名称显示该关节曲线（无需先有关键帧）；右上角图例显示当前关节与 CSV 基线说明
- **时间轴缩放/平移**：滚轮缩放、Shift+滚轮或横向滚动平移；与曲线面板 **X 轴视图双向同步**
- **可编辑工程 FPS**：加载后可在时间轴区域修改 FPS（影响播放与导出重采样）

### 其他

- **工程保存/加载**、**自动保存**（Cookie + IndexedDB）
- **动力学可视化**：重心与支撑多边形
- **多语言**：中文 / 英文界面

## 📋 相对原仓库的功能更新

本分支在 [cyoahs/robot_motion_editor](https://github.com/cyoahs/robot_motion_editor) 基线之上扩展了 IK 末端编辑、视口与关键帧工作流等能力。

| 项目 | 说明 |
|------|------|
| **对比基线** | 提交 [`48ee549`](https://github.com/cyoahs/robot_motion_editor/commit/48ee549e25042c9d4859139ef4ddb03f7b332701)（2026-05-12，`Merge branch 'dev'`） |
| **分支最近更新** | **2026-06-03**（含合并至 `main` 的 IK/关键帧/曲线等提交） |
| **在线演示** | [robot-motion-ik-editor.fandesfyf.workers.dev](https://robot-motion-ik-editor.fandesfyf.workers.dev/)（Cloudflare Workers） |



### 按日期

| 日期 | 更新内容 |
|------|----------|
| **2026-05-30** | 引入 `closed-chain-ik`；视口同屏叠显 / 左右分屏与 Ghost 参考模型；IK 末端编辑面板与求解接入；拖拽导入 URDF/CSV；视口与 IK 面板 UI；`DEVELOPMENT.md` / `USAGE.md` |
| **2026-05-31** | IK 双 Gizmo（姿态编辑时锁定位置）；位置优先、姿态弱权重策略 |
| **2026-06-01** | 视口可视化配置工具栏、播放倍率；时间轴滚轮缩放与交互性能；可编辑工程 FPS |
| **2026-06-03** | IK 求解器重构、权重面板、调试日志与可视化；位置/姿态统一求解；关键帧剪贴板与快捷键、拖拽移动；曲线按需显示、图例、与时间轴双向同步；无关键帧时预览关节曲线；部署名 `robot-motion-ik-editor` |

### 功能清单（相对原仓库新增或显著增强）

1. **IK 末端编辑** — 3D 手柄拖拽末端位姿，松手写入关键帧；面板调权重/迭代；可选调试日志与 FK 校验测试（`npm run test:ik-fk`）。
2. **视口** — Ghost 半透明参考轨迹、叠显/分屏、右上角可视化配置（倍率、Ghost 透明度等）。
3. **拖入导入** — URDF 文件夹或 CSV 拖入页面加载（保留 mesh 相对路径）。
4. **关键帧** — 复制/粘贴/删除（右键 + `Ctrl+C` / `Ctrl+V` / `Delete`）；拖动改帧号；绝对位姿编解码保证复制/移动语义正确。
5. **时间轴** — 滚轮缩放、Shift+滚轮平移；与曲线面板 X 轴视图双向同步。
6. **曲线面板** — 点击关节名显示曲线（可无关键帧）；右上角图例；

### 按模块速览

| 模块 | 主要变更 |
|------|----------|
| **IK** | `closed-chain-ik`、`IkSolverService`、末端面板、权重/日志/调试可视化、参考四元数姿态编辑 |
| **视口** | `ViewportManager`、Ghost、工具栏、播放倍率 |
| **导入** | `fileDropHandler` 拖放 URDF/CSV |
| **时间轴 / 关键帧** | 缩放平移、FPS、剪贴板、快捷键、拖拽、视图同步 |
| **曲线** | 按需绘制、图例、基线预览、性能优化 |

## 💾 自动保存机制

- **localStorage**：轨迹、关键帧、UI 状态、小型配置
- **IndexedDB**：大型 mesh（STL/DAE 等）
- **增量保存**：URDF 未变时仅更新轨迹与关键帧
- 刷新页面可恢复上次工作状态（需启用自动保存）

## 快速开始

**环境**：Node.js 18+（推荐 20+），支持 WebGL 的现代浏览器。

```bash
npm install              # 安装依赖
npm run dev              # 开发 → http://localhost:3000
npm run build            # 构建 dist/
npm run preview          # 预览构建结果
npm run test:ik-fk       # IK/FK 闭环集成测试（需本地 URDF 路径，见 DEVELOPMENT.md）
```

本地开发、排错与测试说明见 **[DEVELOPMENT.md](./DEVELOPMENT.md)**。操作步骤见 **[USAGE.md](./USAGE.md)**。视口与 IK 需求说明见 **[docs/REQUIREMENTS-viewport-ik.md](./docs/REQUIREMENTS-viewport-ik.md)**。

## 使用说明

### 基本流程

1. **加载 URDF**（二选一）  
   - **推荐**：从资源管理器将机器人文件夹拖到页面  
   - 或点击「加载 URDF 文件夹」选择目录（须包含 `.urdf` 及 mesh 相对路径）
2. **加载轨迹**：拖入 `.csv`，或点击选择；支持 unitree（m + 弧度）与 seed（Frame + cm/°）
3. **编辑**：调整关节/基座，或启用 IK 拖拽末端；在目标帧 **添加关键帧**
4. **曲线（可选）**：点击侧栏 **关节名称** 在曲线面板查看该关节整段轨迹；有关键帧后可见编辑曲线与基线差异
5. **保存 / 导出**：工程文件或导出融合后的 CSV（可选格式与 FPS）

### IK 末端编辑（摘要）

1. 加载 URDF 与 CSV 后，展开 **IK末端编辑**
2. 启用末端拖拽 IK，选择 **末端 Link**（可用快捷按钮）
3. 在 3D 视口拖动手柄；松手后在当前帧写入关键帧
4. 面板内可调位置/姿态权重与求解参数；需要时可开启调试日志

### 关键帧操作

| 操作 | 方式 |
|------|------|
| 添加 | 工具栏「添加关键帧」；关节/基座/IK 编辑后自动更新当前帧关键帧 |
| 复制 | 右键关键帧 → 复制，或 `Ctrl+C`（当前帧或已选关键帧） |
| 粘贴 | 右键目标位置 → 粘贴到帧 N，或 `Ctrl+V`（粘贴到播放头） |
| 删除 | 右键删除、`Delete` / `Backspace`，或「删除当前关键帧」 |
| 移动 | 拖动时间轴上的关键帧竖条 |

### 曲线面板

- 点击关节名：显示/隐藏该关节曲线（`Shift+点击` 可多选）
- 右上角 **图例**：当前曲线名称、颜色及 CSV 原始轨迹说明
- 滚轮缩放、Shift+拖拽平移；与时间轴缩放/滚动 **同步**
- 「重置缩放」同时重置时间轴与曲线 X 轴视图

### 时间轴

- 滚轮：缩放（以指针位置为锚点）
- `Shift+滚轮` 或横向滚动：平移
- `🔍+` / `🔍-` / `1:1`：缩放与重置（`1:1` 与曲线面板联动重置）

### 播放与视口

- **空格**：播放 / 暂停；**← / →**：上一帧 / 下一帧
- 视口工具栏：Ghost、倍率、叠显/分屏等

## 技术栈

| 依赖 | 用途 |
|------|------|
| [Vite](https://vitejs.dev/) | 构建与开发服务器 |
| [Three.js](https://threejs.org/) | 3D 渲染 |
| [urdf-loader](https://github.com/gkjohnson/urdf-loaders) | URDF 解析 |
| [closed-chain-ik](https://www.npmjs.com/package/closed-chain-ik) | 闭链 / 末端 IK 求解 |

应用主体为原生 ES 模块 JavaScript，无 React/Vue 框架。

## 项目结构

```
robot_motion_editor/
├── index.html                 # 页面与样式
├── docs/
│   ├── assets/demo/           # README 演示视频（mp4）
│   └── REQUIREMENTS-viewport-ik.md
├── tests/
│   ├── ik-fk-loop-biped-s70-test.js
│   └── ik-chain-registry-test.js
├── DEVELOPMENT.md             # 本地开发与测试
├── USAGE.md                   # 使用说明（含 CSV 格式）
└── src/
    ├── main.js                # 应用入口
    ├── viewportManager.js     # 视口叠显/分屏
    ├── viewportToolbar.js     # 视口工具栏
    ├── timelineController.js  # 时间轴、关键帧 UI
    ├── timelineCurveViewSync.js # 时间轴↔曲线视图同步
    ├── curveEditor.js         # 曲线面板
    ├── trajectoryManager.js   # 轨迹与关键帧（残差/绝对位姿）
    ├── jointController.js     # 关节控制
    ├── baseController.js      # 基座控制
    ├── fileDropHandler.js     # 拖拽导入
    ├── ik/
    │   ├── ikPanel.js         # IK 面板 UI
    │   ├── ikSolverService.js # IK 求解封装
    │   ├── endEffectorControls.js
    │   ├── ikWeightConfig.js
    │   ├── ikSolveLogger.js
    │   ├── ikDebugVisualizer.js
    │   ├── ikKinematicsVerify.js
    │   ├── ikChainRegistry.js
    │   └── eePoseSampler.js   # 末端曲线采样
    └── …                      # urdfLoader, cookieManager, i18n 等
```

## License

MIT
