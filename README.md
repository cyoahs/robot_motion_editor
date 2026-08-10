# 机器人关键帧编辑器

基于 Web 的机器人与场景运动编辑工具，支持独立机器人/场景 URDF 与编辑轨道、机器人 CSV 轨迹、关键帧与固定自由度、双视口对比、单视口轨迹创建和工程文件管理。

**Other language:** [English](README.en.md)

## 🌐 在线体验

[motion-editor.cyoahs.dev](https://motion-editor.cyoahs.dev) | 托管于 Cloudflare Pages

## 🔒 隐私安全

✅ **完全本地运行** — 所有数据处理在浏览器完成，无服务器上传

## ✨ 核心特性

- **双视口对比**: 左侧显示原始轨迹，右侧显示编辑结果，相机同步
- **机器人/场景双轨**: 独立加载机器人/场景 URDF，通过机器人 CSV 建立共享时钟，并分别编辑和导出两条轨迹
- **场景自由度固定**: 每个场景自由度可启用 `Fix`，使其在整条轨迹中保持指定值
- **从零创建轨迹**: 创建模式使用单视口，可生成零轨迹并随时修改帧数与 FPS
- **轨迹编辑**: 基于残差的关键帧系统，支持关节和基体编辑
- **工程保存/加载**: 保存完整工程状态（URDF、轨迹、关键帧、编辑历史）
- **自动保存**: Cookie + IndexedDB 混合存储，自动保存工作状态
- **曲线编辑器**: 可视化关节和基体随时间的变化曲线，支持贝塞尔插值
- **动力学可视化**: 实时显示重心位置和支撑多边形投影
- **坐标轴指示器**: 右下角3D指示器，点击快速切换正交视角
- **URDF 解析**: 自动加载文件夹中的 URDF 和 mesh 文件
- **多语言支持**: 中文/英文界面切换

## 💾 自动保存机制

应用采用智能分层存储策略：

- **localStorage (5MB)**: 存储轨迹、关键帧、UI状态和小型配置文件（<50KB）
- **IndexedDB (50MB+)**: 存储大型 mesh 文件（如 .stl, .dae）
- **自动增量保存**: 仅在 URDF 变化时完整保存，否则仅保存轨迹和关键帧
- **授权管理**: 启用/禁用自动保存时同步清理所有存储

启用自动保存后，刷新页面将自动恢复上次编辑状态。

## 快速开始

项目固定使用 Node.js 24.12.0 与 npm 11。推荐通过 NVM 初始化：

```bash
nvm use               # 读取 .nvmrc，切换到项目 Node 版本
npm ci                # 按 package-lock.json 干净安装依赖
npm run dev           # 启动开发服务器（默认 http://localhost:3000）
npm run build         # 生产构建
npm test              # 完整回归测试
```

## 使用说明

### 基本流程

1. **加载模型**: 从“添加机器人”直接选择内置 G1/H2，或上传机器人 URDF 文件夹；场景通过“上传场景”单独加载。“本地处理，数据安全”设置中的上传 Mesh 优化默认开启
2. **加载轨迹**: 通过“加载 CSV 轨迹”导入机器人 unitree 或 seed CSV；场景轨迹与机器人共用帧数和 FPS
3. **选择编辑对象**: 在“机器人/场景”之间切换，时间轴、关节面板和曲线会跟随当前轨道
4. **编辑关键帧**: 点击自由度名称显示曲线，调整参数后添加关键帧（Shift+点击多选曲线）；场景自由度可勾选 `Fix`
5. **从零创建**: 切到“创建模式”，用唯一一组帧数/FPS 同时创建或调整已加载的机器人与场景轨迹
6. **独立导出**: 机器人和场景各有“编辑后/原始”导出按钮；机器人可选 unitree/seed，场景导出 unitree
7. **保存工程**: 工程文件和自动保存会保留两条轨迹、场景固定值及当前工作模式

### 两种轨迹 CSV 格式

编辑器加载后统一使用米、弧度和四元数进行内部计算。机器人轨迹可导入/导出 Unitree 或 Seed；格式由 Seed 的固定表头自动识别。

| 项目 | Unitree | Seed |
|---|---|---|
| 表头 | 无，第一行就是数值 | 必须有固定表头 |
| 基体位置 | `x,y,z`，单位 m | `root_translateX/Y/Z`，单位 cm |
| 基体姿态 | `qx,qy,qz,qw` | `root_rotateX/Y/Z`，单位 degree，分别表示 roll/pitch/yaw，按 ZYX 组合 |
| 关节值 | 第 8 列起，单位 rad | 固定 7 列之后，单位 degree |
| 默认导入 FPS | 50 | 120 |

Unitree 是无表头的纯数值格式。下面是包含 3 个关节的缩写示例；以 `#` 开头的是可选注释，不是表头：

```csv
# x,y,z,qx,qy,qz,qw,joint_1,joint_2,joint_3
0,0,0.8,0,0,0,1,0.1,-0.2,0.3
```

Seed 的前七列表头必须依次为 `Frame,root_translateX,root_translateY,root_translateZ,root_rotateX,root_rotateY,root_rotateZ`，其后是关节列：

```csv
Frame,root_translateX,root_translateY,root_translateZ,root_rotateX,root_rotateY,root_rotateZ,joint_1_dof,joint_2_dof,joint_3_dof
0,0,0,80,0,0,0,5,-10,15
```

Seed 的 `Frame` 必须是数值，但导入以数据行顺序为准，导出时重新编号为 `0..N-1`。两种格式都不在文件中保存可靠的时间间隔：加载时会提示确认 FPS，之后机器人和场景共用该帧数/FPS。空行和以 `#` 开头的注释行会被忽略；所有数据行必须列数一致、全部为有限数值，且关节列数量必须等于已加载机器人 URDF 的可动关节数。关节值始终按 URDF 控制面板中的顺序对应；Seed 关节表头只作为标签。导出格式不会改变共享 FPS。场景自由度可能包含平移关节，因此场景轨迹仅导出 Unitree。

### 内置 Mesh 优化

内置 G1/H2 使用按部件分层的可视化预算，而不是统一面数上限：普通部件为 6k，手、腿部轮廓和大型外壳按重要性提高到 8k–50k。当前 URDF 可视网格总量为 G1 234,121 面、H2 286,451 面。可复现参数位于 `scripts/mesh_optimization_profile.json`，离线处理与固定机位渲染脚本分别为 `scripts/optimize_stl_assets.py` 和 `scripts/render_urdf_visuals.py`。

### 工程管理

- **保存工程**: 导出包含 URDF、轨迹、关键帧、编辑历史的工程文件
- **加载工程**: 恢复已保存的完整编辑状态
- **增量编辑**: 基于残差系统，仅存储修改部分

### 动力学可视化

- **重心显示**: 实时计算并显示机器人重心位置
- **支撑多边形**: 显示底面接触点构成的凸包投影
- **稳定性指示**: 直观判断当前姿态的静态稳定性

### 快捷功能

- **平移对齐**: 基座控制中的"平移对齐"按钮可自动调整XYZ，使编辑后机器人的最低点与原始轨迹对齐
- **坐标轴指示器**: 右下角的3D轴指示器，点击X/Y/Z轴可快速切换到对应的正交视角

## 技术栈

- Vite: 前端构建工具
- Three.js: 3D 图形渲染
- urdf-loader: URDF 解析
- meshoptimizer: 上传模型的浏览器端 Mesh 简化
- 原生 JavaScript: 无框架依赖

## 项目结构

```
src/
├── main.js              # 应用主入口（双视口渲染）
├── urdfLoader.js        # URDF 加载和解析
├── trajectoryManager.js # 轨迹和关键帧管理
├── trajectoryFormatConverter.js # unitree/seed CSV 格式转换
├── jointController.js   # 关节控制 UI
├── baseController.js    # 基体控制 UI（含平移对齐）
├── curveEditor.js       # 曲线编辑器
├── comVisualizer.js     # 重心和支撑多边形可视化
├── axisGizmo.js         # 坐标轴指示器
├── timelineController.js # 时间轴控制
├── cookieManager.js     # 自动保存管理（localStorage）
├── indexedDBManager.js  # 大文件存储（IndexedDB）
├── themeManager.js      # 主题管理
└── i18n.js              # 多语言支持
```

## License

MIT
