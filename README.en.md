# Robot Keyframe Editor

A web-based robot and scene motion editor with independent URDF/CSV tracks, keyframes and fixed scene DOFs, dual-viewport comparison, single-viewport trajectory creation, and project management.

**其他语言:** [中文](README.md)

## 🌐 Live Demo

[motion-editor.cyoahs.dev](https://motion-editor.cyoahs.dev) | Hosted on Cloudflare Pages

## 🔒 Privacy & Security

✅ **Runs Completely Locally** — All data processing happens in your browser, nothing is uploaded to any server

## ✨ Core Features

- **Dual-Viewport Comparison**: Original trajectory on the left, edited results on the right with synchronized camera
- **Independent Robot and Scene Tracks**: Load robot/scene URDFs independently, establish one shared clock from the robot CSV, then edit and export both tracks separately
- **Fixed Scene DOFs**: Enable `Fix` on any scene DOF to hold its chosen value over the entire trajectory
- **Create from Zero**: Generate a zero trajectory in single-viewport Create mode, then change its frame count and FPS
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

The project is pinned to Node.js 24.12.0 and npm 11. NVM is recommended:

```bash
nvm use               # Select the version from .nvmrc
npm ci                # Clean install from package-lock.json
npm run dev           # Start the dev server (default http://localhost:3000)
npm run build         # Production build
npm test              # Full regression suite
```

## Usage Guide

### Basic Workflow

1. **Load Models**: Choose the built-in G1/H2 from Add Robot, or upload a robot URDF folder; upload an independent scene separately. Uploaded-mesh optimization is enabled by default under Local Processing / Data Security
2. **Load Trajectory**: Use Load CSV Trajectory for a robot unitree or seed CSV; the scene trajectory shares the same frame count and FPS
3. **Choose the Editing Target**: Switch between Robot and Scene; the timeline, controls, and curves follow the active track
4. **Edit Keyframes**: Select DOF curves, adjust values, and add keyframes (Shift+click selects multiple curves). Scene DOFs also expose `Fix`
5. **Create from Zero**: Enter Create mode and use one frame-count/FPS setting to create or resize aligned robot and scene trajectories together
6. **Export Independently**: Robot and scene each have edited/base export actions. Robot supports unitree/seed; scene exports unitree
7. **Save Project**: Project files and auto-save preserve both tracks, fixed scene values, and the active workspace mode

### Built-in Mesh Optimization

The bundled G1/H2 assets use per-part visualization budgets instead of one global face cap: ordinary parts use 6k, while hands, long-leg silhouettes, and dominant shells receive 8k–50k. The current URDF visual totals are 234,121 faces for G1 and 286,451 for H2. Reproducible budgets live in `scripts/mesh_optimization_profile.json`; offline simplification and fixed-camera rendering are provided by `scripts/optimize_stl_assets.py` and `scripts/render_urdf_visuals.py`.

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
- meshoptimizer: In-browser simplification for uploaded meshes
- Vanilla JavaScript: Framework-free development

## Project Structure

```
src/
├── main.js              # Application entry point (dual-viewport rendering)
├── urdfLoader.js        # URDF loading and parsing
├── trajectoryManager.js # Trajectory and keyframe management
├── trajectoryFormatConverter.js # unitree/seed CSV format conversion
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
