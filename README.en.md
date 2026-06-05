# Robot Keyframe Editor

A browser-based robot motion trajectory editor with URDF loading, CSV editing, dual-viewport comparison, inverse kinematics (IK) end-effector editing, and project persistence.

**中文:** [README.md](README.md)

## Live Demo

[motion-editor.cyoahs.dev](https://motion-editor.cyoahs.dev) | Hosted on Cloudflare Pages

## Demonstrations

Screen recordings embedded as GIF for inline preview on GitHub and in Markdown viewers.

### IK End-Effector Editing

Drag the end-effector in the 3D viewport, adjust pose, and write keyframes with configurable solver parameters.

![IK end-effector editing](docs/assets/demo/end-effector-ik-edit.gif)

### Joint Editing

Edit joint trajectories via the sidebar and curve panel with keyframe management.

![Joint editing](docs/assets/demo/joint-edit.gif)

### Viewport & Visualization

Configure ghost reference model, overlay/split layout, and playback rate.

![Viewport settings](docs/assets/demo/viewport-settings.gif)

## Privacy

All processing runs locally in the browser. No data is uploaded to a server.

## Features

- Residual keyframes on CSV base trajectories; linear / Bezier interpolation
- Keyframe clipboard, drag-to-move, keyboard shortcuts
- Drag-and-drop URDF folders and CSV files
- Viewport overlay/split with ghost reference model
- IK end-effector editing via `closed-chain-ik`
- On-demand curve plots with legend; timeline sync
- Project save/load, auto-save, COM visualization, EN/ZH UI

## Changelog

The following features were developed and contributed by **fandes** ([@fandesfyf](https://github.com/fandesfyf)).

| Date | Summary |
|------|---------|
| 2026-05-30 | IK end-effector editing with `closed-chain-ik`; viewport overlay/split and ghost model; drag-and-drop URDF/CSV import |
| 2026-05-31 | Dual IK gizmos and position-priority solve strategy |
| 2026-06-01 | Viewport toolbar, playback rate, timeline zoom, editable FPS |
| 2026-06-03 | IK solver refactor and tuning panel; keyframe clipboard and shortcuts; on-demand curves with legend; timeline–curve view sync |

See [README.md](README.md) for the full feature list (Chinese).

## Quick Start

```bash
npm install
npm run dev
npm run build
```

See [DEVELOPMENT.md](DEVELOPMENT.md) and [USAGE.md](USAGE.md).

## License

MIT
