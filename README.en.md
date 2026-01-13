# Robot Keyframe Editor

A web-based robot motion editing tool with support for URDF loading, CSV trajectory editing, dual-viewport comparison, and project file management.

**其他语言:** [中文](README.md)

## 🌐 Live Demo

[motion-editor.cyoahs.dev](https://motion-editor.cyoahs.dev) | Hosted on Cloudflare Pages

## 🔒 Privacy & Security

✅ **Runs Completely Locally** — All data processing happens in your browser, nothing is uploaded to any server

## ✨ Core Features

- **Dual-Viewport Comparison**: Original trajectory on the left, edited results on the right with synchronized camera
- **Trajectory Editing**: Residual-based keyframe system with support for joint and base editing
- **Project Save/Load**: Save complete project state (URDF, trajectories, keyframes, edit history)
- **Dynamics Visualization**: Real-time display of center of mass position and contact polygon projection
- **URDF Parsing**: Automatic loading of URDF and mesh files from a folder
- **Trajectory Export**: Export combined complete CSV trajectories

## Quick Start

```bash
npm install           # Install dependencies
npm run dev           # Start development server
npm run build         # Production build
```

## Usage Guide

### Basic Workflow

1. **Load URDF**: Select a folder containing URDF and mesh files
2. **Load Trajectory**: Load a CSV file (first 7 columns: base xyz + quaternion xyzw, followed by joint angles)
3. **Edit Keyframes**: Adjust joint and base parameters on the timeline, add keyframes
4. **Save Project**: Save the complete editing state (can be loaded to restore)
5. **Export Trajectory**: Export the combined CSV trajectory

### Project Management

- **Save Project**: Export a project file containing URDF, trajectories, keyframes, and edit history
- **Load Project**: Restore a complete editing state from a saved project file
- **Incremental Editing**: Based on the residual system, only modified portions are stored

### Dynamics Visualization

- **Center of Mass Display**: Real-time calculation and display of robot center of mass
- **Support Polygon**: Display the convex hull projection of contact points on the ground
- **Stability Indication**: Intuitively assess the static stability of the current pose

## Tech Stack

- Vite: Frontend build tool
- Three.js: 3D graphics rendering
- urdf-loader: URDF parsing
- Vanilla JavaScript: Framework-free development

## Project Structure

```
src/
├── main.js              # Application entry point (dual-viewport rendering)
├── urdfLoader.js        # URDF loading and parsing
├── trajectoryManager.js # Trajectory and keyframe management
├── jointController.js   # Joint control UI
├── baseController.js    # Base control UI
├── comVisualizer.js     # Center of mass and support polygon visualization
├── timelineController.js # Timeline control
└── i18n.js              # Internationalization (Chinese/English)
```

## License

MIT
