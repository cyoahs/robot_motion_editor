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
- **Auto-Save**: Hybrid storage with Cookie + IndexedDB, automatically saves work state
- **Curve Editor**: Visualize joint and base changes over time with Bezier interpolation support
- **Dynamics Visualization**: Real-time display of center of mass position and contact polygon projection
- **Axis Gizmo**: 3D axis indicator in the bottom-right corner, click to switch orthogonal views
- **URDF Parsing**: Automatic loading of URDF and mesh files from a folder
- **Multi-language**: Chinese/English interface switching

## 💾 Auto-Save Mechanism

The application uses an intelligent layered storage strategy:

- **localStorage (5MB)**: Stores trajectories, keyframes, UI state, and small config files (<50KB)
- **IndexedDB (50MB+)**: Stores large mesh files (e.g., .stl, .dae)
- **Incremental Auto-Save**: Full save only when URDF changes, otherwise saves only trajectory and keyframes
- **Authorization Management**: Synchronously clears all storage when enabling/disabling auto-save

When auto-save is enabled, refreshing the page automatically restores the last editing state.

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
3. **Edit Keyframes**: Click DOF names to show curves, adjust parameters and add keyframes (Shift+click for multiple curves)
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

### Quick Features

- **Align Lowest**: The "Align Lowest" button in base control auto-adjusts XYZ to align the edited robot's lowest point with the base trajectory
- **Axis Gizmo**: The 3D axis indicator in the bottom-right corner allows quick switching to orthogonal views by clicking X/Y/Z axes

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
├── baseController.js    # Base control UI (with align feature)
├── curveEditor.js       # Curve editor
├── comVisualizer.js     # Center of mass and support polygon visualization
├── axisGizmo.js         # Axis indicator gizmo
├── timelineController.js # Timeline control
└── i18n.js              # Internationalization (Chinese/English)
```

## License

MIT
