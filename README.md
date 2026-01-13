# 机器人关键帧编辑器

基于 Web 的机器人运动编辑工具，支持 URDF 加载、CSV 轨迹编辑、双视口对比和工程文件管理。

**Other language:** [English](README.en.md)

## 🌐 在线体验

[motion-editor.cyoahs.dev](https://motion-editor.cyoahs.dev) | 托管于 Cloudflare Pages

## 🔒 隐私安全

✅ **完全本地运行** — 所有数据处理在浏览器完成，无服务器上传

## ✨ 核心特性

- **双视口对比**: 左侧显示原始轨迹，右侧显示编辑结果，相机同步
- **轨迹编辑**: 基于残差的关键帧系统，支持关节和基体编辑
- **工程保存/加载**: 保存完整工程状态（URDF、轨迹、关键帧、编辑历史）
- **动力学可视化**: 实时显示重心位置和支撑多边形投影
- **URDF 解析**: 自动加载文件夹中的 URDF 和 mesh 文件
- **轨迹导出**: 导出融合后的完整 CSV 轨迹

## 快速开始

```bash
npm install           # 安装依赖
npm run dev           # 启动开发服务器
npm run build         # 生产构建
```

## 使用说明

### 基本流程

1. **加载 URDF**: 选择包含 URDF 和 mesh 文件的文件夹
2. **加载轨迹**: 加载 CSV 文件（前 7 列为 base xyz + 四元数 xyzw，后续为关节角度）
3. **编辑关键帧**: 在时间轴上调整关节和基体参数，添加关键帧
4. **保存工程**: 保存完整的编辑状态（支持加载恢复）
5. **导出轨迹**: 导出融合后的 CSV 轨迹

### 工程管理

- **保存工程**: 导出包含 URDF、轨迹、关键帧、编辑历史的工程文件
- **加载工程**: 恢复已保存的完整编辑状态
- **增量编辑**: 基于残差系统，仅存储修改部分

### 动力学可视化

- **重心显示**: 实时计算并显示机器人重心位置
- **支撑多边形**: 显示底面接触点构成的凸包投影
- **稳定性指示**: 直观判断当前姿态的静态稳定性

## 技术栈

- Vite: 前端构建工具
- Three.js: 3D 图形渲染
- urdf-loader: URDF 解析
- 原生 JavaScript: 无框架依赖

## 项目结构

```
src/
├── main.js              # 应用主入口（双视口渲染）
├── urdfLoader.js        # URDF 加载和解析
├── trajectoryManager.js # 轨迹和关键帧管理
├── jointController.js   # 关节控制 UI
├── baseController.js    # 基体控制 UI
├── comVisualizer.js     # 重心和支撑多边形可视化
└── timelineController.js # 时间轴控制
```

## License

MIT

