# 本地开发环境

本文说明如何在本机安装依赖、启动开发服务器、构建与验证。应用为纯前端项目，数据在浏览器内处理，无需后端服务。

## 环境要求

| 依赖 | 版本建议 |
|------|----------|
| Node.js | **18+** 或 **20+**（Vite 5 要求 `^18.0.0 \|\| >=20.0.0`） |
| npm | 9+（随 Node 自带即可） |
| 浏览器 | 支持 WebGL 的现代浏览器（Chrome / Firefox / Edge 等） |

检查版本：

```bash
node -v   # 应 >= v18
npm -v
```

推荐使用 [nvm](https://github.com/nvm-sh/nvm) 管理 Node 版本。若系统默认 `node` 过旧，可先执行 `nvm use 20` 或 `nvm install 20`。

## 安装依赖

在项目根目录执行：

```bash
cd /path/to/robot_motion_editor
npm install
```

首次安装会拉取 `vite`、`three`、`urdf-loader` 等依赖，生成 `node_modules/` 与 `package-lock.json`。

## 启动开发服务器

```bash
npm run dev
```

或使用仓库提供的脚本（等价于 `npm run dev`）：

```bash
chmod +x run.sh   # 首次需要
./run.sh
```

成功启动后终端会显示：

```
➜  Local:   http://localhost:3000/
```

- 默认端口：**3000**（见 `vite.config.js`）
- 配置中 `open: true`，部分环境会自动打开浏览器；否则请手动访问 [http://localhost:3000](http://localhost:3000)
- 修改 `src/` 下代码会热更新，无需重启

### 局域网访问（可选）

若需从其他设备访问本机开发服务：

```bash
npm run dev -- --host
```

然后使用终端显示的 Network 地址访问。

## 生产构建与预览

```bash
npm run build    # 输出到 dist/
npm run preview  # 本地预览构建结果（默认另一端口，以终端为准）
```

构建产物用于静态托管（如 Cloudflare Pages，见根目录 `wrangler.jsonc`）。

## 本地验证清单

1. 打开 http://localhost:3000 ，页面无报错
2. 使用仓库内 `example_trajectory.csv` 或自备 CSV 测试「加载轨迹」
3. 加载包含 URDF 与 mesh 的文件夹测试 3D 显示（需完整模型目录）
4. 打开浏览器开发者工具（F12）确认 Console 无持续报错

更详细的操作步骤见 [USAGE.md](./USAGE.md)。

## 运行单元测试（可选）

`tests/` 下为独立 Node 脚本，不依赖 Vite，可在项目根目录执行，例如：

```bash
node tests/simple-test.js
node tests/trajectory-format-converter-test.js
node tests/com-calculation-test.js
node tests/ik-chain-registry-test.js
```

## 视口与 IK 模块

- `src/viewportManager.js`：同屏叠显 / 左右分屏、Ghost 材质与显隐。
- `src/ik/`：`closed-chain-ik` 末端求解（子路径导入，避免旧版 Three 辅助几何体）、`TransformControls` 拖拽、自动关键帧。
- 工程 JSON 可含 `viewport`、`ik` 字段（见 [docs/REQUIREMENTS-viewport-ik.md](./docs/REQUIREMENTS-viewport-ik.md)）。

## 常见问题

### `npm install` 失败或 Node 版本过低

升级 Node 至 18 或 20 后删除 `node_modules` 再安装：

```bash
rm -rf node_modules
npm install
```

### 端口 3000 已被占用

临时指定端口：

```bash
npm run dev -- --port 3001
```

或在 `vite.config.js` 的 `server.port` 中修改默认端口。

### 开发服务器已启动但页面空白

- 确认访问的是终端打印的 Local 地址
- 查看浏览器 Console 是否有模块加载错误
- 尝试无痕模式或禁用可能拦截本地资源的浏览器扩展

### WSL / 远程文件系统下热更新不生效

`vite.config.js` 已启用 `server.watch.usePolling`，一般可缓解；若仍异常，可重启 `npm run dev`。

### 构建时 git 相关警告

构建会通过 `git` 命令注入提交信息到前端常量；非 git 仓库或浅克隆时可能显示 `unknown`，不影响本地开发与运行。

## 相关文档

- [README.md](./README.md) — 功能概览与项目结构
- [USAGE.md](./USAGE.md) — 编辑器使用说明与 CSV 格式
- [seed_format.md](./seed_format.md) — seed 轨迹格式说明
- [docs/REQUIREMENTS-viewport-ik.md](./docs/REQUIREMENTS-viewport-ik.md) — 同屏叠显视口与末端 IK 需求规格（v1.0）
