# Robot Keyframe Editor

A web-based robot motion editor with **drag-and-drop URDF folders**, CSV trajectory editing, dual-viewport comparison, IK end-effector editing, and project persistence.

**Other language:** [中文](README.md)

## 🌐 Live Demo

[robot-motion-ik-editor.fandesfyf.workers.dev](https://robot-motion-ik-editor.fandesfyf.workers.dev/) | Hosted on Cloudflare Workers

## 🎬 Demos

Screen recordings (ffmpeg-compressed, 1280p H.264) in `docs/assets/demo/`:

| Demo | File |
|------|------|
| IK end-effector editing | `end-effector-ik-edit.mp4` |
| Joint editing | `joint-edit.mp4` |
| Viewport / visualization settings | `viewport-settings.mp4` |

See [README.md](./README.md) for embedded videos.

## 🔒 Privacy & Security

✅ **Runs completely locally** — all processing happens in the browser; nothing is uploaded to a server.

## ✨ Core Features

- **Residual keyframes** on top of a CSV base trajectory; linear / Bezier interpolation
- **Keyframe clipboard** with copy, paste, delete, drag-to-move (absolute pose preserved)
- **Viewport modes**: ghost overlay or side-by-side comparison; toolbar for ghost, playback rate, layout
- **IK end-effector editing** via `closed-chain-ik`: drag handles, unified position/orientation solve, tuning panel, optional debug logging
- **Curve editor**: show a joint’s curve on demand (even before keyframes); legend; X-axis sync with the timeline
- **Timeline**: wheel zoom, pan, editable FPS, shortcuts (`Ctrl+C` / `Ctrl+V` / `Del`)
- **Drag-and-drop import**: drop a robot **folder** (`.urdf` + meshes) or a `.csv` onto the page; nested directories are traversed and relative paths preserved for mesh loading
- **Auto-save**, COM / support polygon visualization, Chinese / English UI

## 📋 Changes vs. Upstream Repository

This branch extends [cyoahs/robot_motion_editor](https://github.com/cyoahs/robot_motion_editor) with IK editing, viewport modes, and an improved keyframe workflow.

| Item | Details |
|------|---------|
| **Baseline** | Commit [`48ee549`](https://github.com/cyoahs/robot_motion_editor/commit/48ee549e25042c9d4859139ef4ddb03f7b332701) (2026-05-12, `Merge branch 'dev'`) |
| **Last updated** | **2026-06-03** (IK / keyframe / curve commits merged to `main`) |
| **Live demo** | [robot-motion-ik-editor.fandesfyf.workers.dev](https://robot-motion-ik-editor.fandesfyf.workers.dev/) |

```bash
git log 48ee549e25042c9d4859139ef4ddb03f7b332701..HEAD --oneline
```

### By date

| Date | Updates |
|------|---------|
| **2026-05-30** | `closed-chain-ik`; viewport overlay/split + ghost; IK EE panel; drag-drop URDF/CSV; docs |
| **2026-05-31** | Dual-gizmo IK; position-first solve tuning |
| **2026-06-01** | Viewport toolbar, playback rate, timeline wheel zoom, editable FPS |
| **2026-06-03** | IK solver refactor, tuning UI, keyframe clipboard/shortcuts, curve legend & timeline sync, Workers deploy name |

### Feature list (new or significantly enhanced)

1. **IK end-effector editing** — drag handles, keyframe on release, panel weights, optional debug/FK tests.
2. **Viewport** — ghost base trajectory, overlay/split, visualization toolbar.
3. **Drag-and-drop import** — URDF folders and CSV files.
4. **Keyframes** — copy/paste/delete, drag to move frames, absolute-pose clipboard semantics.
5. **Timeline** — zoom/pan, bidirectional X-axis sync with the curve panel.
6. **Curve panel** — per-joint plots on demand, legend, no keyframe required for preview.
7. **Docs & demos** — updated README/USAGE, demo videos under `docs/assets/demo/`, in-app help dialog.

See [README.md](./README.md) (Chinese) for the full changelog table.

## Quick Start

**Requirements:** Node.js 18+ (20+ recommended), WebGL-capable browser.

```bash
npm install
npm run dev              # http://localhost:3000
npm run build
npm run preview
npm run test:ik-fk       # IK/FK loop test (see DEVELOPMENT.md)
```

See **[DEVELOPMENT.md](./DEVELOPMENT.md)** for local setup and **[USAGE.md](./USAGE.md)** for workflows and CSV formats.

## Keyframe Shortcuts

| Action | Shortcut |
|--------|----------|
| Copy | `Ctrl+C` / `⌘C` |
| Paste at playhead | `Ctrl+V` / `⌘V` |
| Delete | `Del` / `Backspace` |

Context menu on keyframe markers shows the same hints.

## Tech Stack

- Vite, Three.js, urdf-loader, closed-chain-ik  
- Vanilla ES modules (no UI framework)

## Project Layout

See [README.md](./README.md) (Chinese) for the full `src/` tree including `ik/`, `viewportManager.js`, `timelineCurveViewSync.js`, and `tests/`.

## License

MIT
