import * as THREE from 'three';

const STORAGE_KEY = 'robotEditor_viewport';
const GHOST_RENDER_ORDER = 0;
const EDITED_RENDER_ORDER = 1;

/** 参考模型固定绿色半透明 */
const GHOST_COLOR = '#6a9955';
const GHOST_OPACITY = 0.4;

const DEFAULTS = {
  mode: 'overlay',
  ghostOpacity: GHOST_OPACITY,
  ghostColor: GHOST_COLOR,
  showGhost: true,
  showEdited: true
};

export class ViewportManager {
  constructor(editor) {
    this.editor = editor;
    this.mode = DEFAULTS.mode;
    this.ghostOpacity = DEFAULTS.ghostOpacity;
    this.ghostColor = DEFAULTS.ghostColor;
    this.showGhost = DEFAULTS.showGhost;
    this.showEdited = DEFAULTS.showEdited;
    this.sceneMain = null;
    this.cameraMain = null;
    this._ghostMaterials = [];
    this.loadFromStorage();
  }

  loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.mode === 'overlay' || data.mode === 'split') this.mode = data.mode;
      if (typeof data.ghostOpacity === 'number') {
        this.ghostOpacity = Math.min(0.5, Math.max(0.35, data.ghostOpacity));
      }
      if (typeof data.ghostColor === 'string') this.ghostColor = data.ghostColor;
      if (typeof data.showGhost === 'boolean') this.showGhost = data.showGhost;
      if (typeof data.showEdited === 'boolean') this.showEdited = data.showEdited;
    } catch (e) {
      console.warn('viewport settings load failed', e);
    }
  }

  saveToStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      mode: this.mode,
      ghostOpacity: this.ghostOpacity,
      ghostColor: this.ghostColor,
      showGhost: this.showGhost,
      showEdited: this.showEdited
    }));
  }

  getSettingsForProject() {
    return {
      mode: this.mode,
      ghostOpacity: this.ghostOpacity,
      ghostColor: this.ghostColor,
      showGhost: this.showGhost,
      showEdited: this.showEdited
    };
  }

  applyProjectSettings(viewport) {
    if (!viewport) return;
    if (viewport.mode === 'overlay' || viewport.mode === 'split') this.mode = viewport.mode;
    if (typeof viewport.ghostOpacity === 'number') {
      this.ghostOpacity = Math.min(0.5, Math.max(0.35, viewport.ghostOpacity));
    }
    if (typeof viewport.ghostColor === 'string') this.ghostColor = viewport.ghostColor;
    if (typeof viewport.showGhost === 'boolean') this.showGhost = viewport.showGhost;
    if (typeof viewport.showEdited === 'boolean') this.showEdited = viewport.showEdited;
    this.saveToStorage();
    this.syncUiFromState();
    this.setMode(this.mode, { skipStorage: true });
  }

  initScenes(theme, frustumSize = 5) {
    const editor = this.editor;
    this.sceneMain = new THREE.Scene();
    this._applySceneBackground(this.sceneMain, theme, 'main');
    this._addSceneHelpers(this.sceneMain);

    const viewport = document.getElementById('viewport');
    const fullWidth = Math.max(viewport?.clientWidth || 1, 1);
    const fullHeight = Math.max(viewport?.clientHeight || 1, 1);
    const aspect = fullWidth / fullHeight;
    const fs = frustumSize || editor.frustumSize || 5;

    this.cameraMain = new THREE.OrthographicCamera(
      fs * aspect / -2,
      fs * aspect / 2,
      fs / 2,
      fs / -2,
      0.1,
      1000
    );
    const refCam = editor.cameraRight || editor.camera;
    if (refCam) {
      this.cameraMain.position.copy(refCam.position);
      this.cameraMain.quaternion.copy(refCam.quaternion);
      this.cameraMain.zoom = refCam.zoom;
    } else {
      this.cameraMain.position.set(3, 3, 2);
    }
    this.cameraMain.up.set(0, 0, 1);
    this.cameraMain.updateProjectionMatrix();
  }

  syncOverlayCameraFromActive() {
    const e = this.editor;
    const src = e.controls?.object || e.cameraRight;
    if (!this.cameraMain || !src) return;
    this.cameraMain.position.copy(src.position);
    this.cameraMain.quaternion.copy(src.quaternion);
    this.cameraMain.zoom = src.zoom;
    this.cameraMain.updateProjectionMatrix();
  }

  _addSceneHelpers(scene) {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(5, 5, 10);
    scene.add(directional);
    const grid = new THREE.GridHelper(10, 20, 0x555555, 0x333333);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);
    const axes = new THREE.AxesHelper(1);
    scene.add(axes);
  }

  _applySceneBackground(scene, theme, which) {
    if (!scene) return;
    if (theme === 'light') {
      if (which === 'left' || which === 'main') scene.background = new THREE.Color(0xf0f0f0);
      else scene.background = new THREE.Color(0xe8e8e8);
    } else {
      if (which === 'left' || which === 'main') scene.background = new THREE.Color(0x1a1a1a);
      else scene.background = new THREE.Color(0x263238);
    }
  }

  updateSceneBackgrounds(theme) {
    const e = this.editor;
    this._applySceneBackground(this.sceneMain, theme, 'main');
    this._applySceneBackground(e.sceneLeft, theme, 'left');
    this._applySceneBackground(e.sceneRight, theme, 'right');
  }

  applyGhostMaterial(robot) {
    if (!robot) return;
    this.ghostColor = GHOST_COLOR;
    this.ghostOpacity = GHOST_OPACITY;
    this._ghostMaterials = [];
    const color = new THREE.Color(GHOST_COLOR);
    robot.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const newMats = mats.map((m) => {
        if (!m || typeof m.clone !== 'function') return m;
        const cloned = m.clone();
        cloned.color = color.clone();
        if (cloned.emissive) cloned.emissive = color.clone().multiplyScalar(0.15);
        cloned.transparent = true;
        cloned.opacity = GHOST_OPACITY;
        cloned.depthWrite = false;
        this._ghostMaterials.push(cloned);
        return cloned;
      });
      obj.material = Array.isArray(obj.material) ? newMats : newMats[0];
      obj.renderOrder = GHOST_RENDER_ORDER;
      obj.raycast = () => {};
    });
    robot.renderOrder = GHOST_RENDER_ORDER;
  }

  /** URDF 网格可能异步加载，加载完成后再着色 */
  applyGhostMaterialWhenReady(robot, attempt = 0) {
    if (!robot) return;
    this.applyGhostMaterial(robot);
    let meshCount = 0;
    robot.traverse((obj) => {
      if (obj.isMesh) meshCount++;
    });
    if (meshCount === 0 && attempt < 20) {
      requestAnimationFrame(() => this.applyGhostMaterialWhenReady(robot, attempt + 1));
    }
  }

  applyEditedRenderOrder(robot) {
    if (!robot) return;
    robot.traverse((obj) => {
      if (obj.isMesh) {
        obj.renderOrder = EDITED_RENDER_ORDER;
      }
    });
    robot.renderOrder = EDITED_RENDER_ORDER;
  }

  attachRobots() {
    const e = this.editor;
    const ghost = e.robotLeft;
    const edited = e.robotRight;
    if (!ghost && !edited) return;

    [e.sceneLeft, e.sceneRight, this.sceneMain].forEach((s) => {
      if (ghost && s?.children.includes(ghost)) s.remove(ghost);
      if (edited && s?.children.includes(edited)) s.remove(edited);
    });

    if (this.mode === 'overlay') {
      if (ghost) this.sceneMain.add(ghost);
      if (edited) this.sceneMain.add(edited);
      e.comVisualizerLeft?.setScene(this.sceneMain);
      e.comVisualizerRight?.setScene(this.sceneMain);
    } else {
      if (ghost) e.sceneLeft.add(ghost);
      if (edited) e.sceneRight.add(edited);
      e.comVisualizerLeft?.setScene(e.sceneLeft);
      e.comVisualizerRight?.setScene(e.sceneRight);
    }

    this.applyVisibility();
  }

  applyVisibility() {
    const e = this.editor;
    if (e.robotLeft) e.robotLeft.visible = this.showGhost;
    if (e.robotRight) e.robotRight.visible = this.showEdited;
    if (e.comVisualizerLeft) {
      e.comVisualizerLeft.setVisible(this.showGhost && e.showCOM);
    }
    if (e.comVisualizerRight) {
      e.comVisualizerRight.setVisible(this.showEdited && e.showCOM);
    }
  }

  setMode(mode, options = {}) {
    this.mode = mode;
    if (!options.skipStorage) this.saveToStorage();
    this.updateDomVisibility();
    this.attachRobots();

    const e = this.editor;
    if (mode === 'overlay') {
      this.syncOverlayCameraFromActive();
      if (e.controls && this.cameraMain) {
        e.controls.object = this.cameraMain;
        e.camera = this.cameraMain;
      }
      if (e.axisGizmo) {
        e.axisGizmo.camera = this.cameraMain;
      }
    } else {
      if (e.controls && e.cameraRight) {
        e.controls.object = e.cameraRight;
        e.camera = e.cameraRight;
      }
      if (e.axisGizmo) {
        e.axisGizmo.camera = e.cameraRight;
      }
      e.cameraLeft.position.copy(e.cameraRight.position);
      e.cameraLeft.quaternion.copy(e.cameraRight.quaternion);
      e.cameraLeft.zoom = e.cameraRight.zoom;
      e.cameraLeft.updateProjectionMatrix();
    }

    this.handleResize();
    if (e.endEffectorControls) {
      e.endEffectorControls.onViewportModeChanged();
    }
  }

  updateDomVisibility() {
    const overlay = this.mode === 'overlay';
    const splitDivider = document.getElementById('viewport-split-divider');
    const labelLeft = document.getElementById('viewport-label-left');
    const labelRight = document.getElementById('viewport-label-right');
    const overlayBar = document.getElementById('viewport-overlay-controls');

    if (splitDivider) splitDivider.style.display = overlay ? 'none' : 'block';
    if (labelLeft) labelLeft.style.display = overlay ? 'none' : 'block';
    if (labelRight) labelRight.style.display = overlay ? 'none' : 'block';
    // 视口模式 / Ghost 控制在两种模式下均需可见，否则分屏后无法切回 overlay
    if (overlayBar) overlayBar.style.display = 'flex';
  }

  syncUiFromState() {
    const modeOverlay = document.getElementById('viewport-mode-overlay');
    const modeSplit = document.getElementById('viewport-mode-split');
    if (modeOverlay) modeOverlay.checked = this.mode === 'overlay';
    if (modeSplit) modeSplit.checked = this.mode === 'split';

    const showGhost = document.getElementById('show-ghost-model');
    const showEdited = document.getElementById('show-edited-model');
    if (showGhost) showGhost.checked = this.showGhost;
    if (showEdited) showEdited.checked = this.showEdited;

  }

  setupUi() {
    const modeOverlay = document.getElementById('viewport-mode-overlay');
    const modeSplit = document.getElementById('viewport-mode-split');
    const onMode = () => {
      const next = modeOverlay?.checked ? 'overlay' : 'split';
      this.setMode(next);
    };
    modeOverlay?.addEventListener('change', onMode);
    modeSplit?.addEventListener('change', onMode);

    document.getElementById('show-ghost-model')?.addEventListener('change', (e) => {
      this.showGhost = e.target.checked;
      this.saveToStorage();
      this.applyVisibility();
    });
    document.getElementById('show-edited-model')?.addEventListener('change', (e) => {
      this.showEdited = e.target.checked;
      this.saveToStorage();
      this.applyVisibility();
    });

    this.syncUiFromState();
    this.updateDomVisibility();
  }

  getRenderCamera() {
    return this.mode === 'overlay' ? this.cameraMain : this.editor.cameraRight;
  }

  getActiveScene() {
    return this.mode === 'overlay' ? this.sceneMain : this.editor.sceneRight;
  }

  handleResize() {
    const e = this.editor;
    const viewport = document.getElementById('viewport');
    if (!viewport || !e.renderer) return;

    const fullWidth = viewport.clientWidth;
    const fullHeight = viewport.clientHeight;
    e.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    e.renderer.setSize(fullWidth, fullHeight, false);

    if (this.mode === 'overlay' && this.cameraMain) {
      const aspect = fullWidth / fullHeight;
      this.cameraMain.left = e.frustumSize * aspect / -2;
      this.cameraMain.right = e.frustumSize * aspect / 2;
      this.cameraMain.top = e.frustumSize / 2;
      this.cameraMain.bottom = e.frustumSize / -2;
      this.cameraMain.updateProjectionMatrix();
    } else {
      const halfWidth = fullWidth / 2;
      const aspect = halfWidth / fullHeight;
      e.cameraLeft.left = e.frustumSize * aspect / -2;
      e.cameraLeft.right = e.frustumSize * aspect / 2;
      e.cameraLeft.top = e.frustumSize / 2;
      e.cameraLeft.bottom = e.frustumSize / -2;
      e.cameraLeft.updateProjectionMatrix();
      e.cameraRight.left = e.frustumSize * aspect / -2;
      e.cameraRight.right = e.frustumSize * aspect / 2;
      e.cameraRight.top = e.frustumSize / 2;
      e.cameraRight.bottom = e.frustumSize / -2;
      e.cameraRight.updateProjectionMatrix();
    }
  }

  render() {
    const e = this.editor;
    const viewport = document.getElementById('viewport');
    if (!viewport || !e.renderer) return;

    const fullWidth = Math.max(viewport.clientWidth, 1);
    const fullHeight = Math.max(viewport.clientHeight, 1);

    const canvas = e.renderer.domElement;
    const dpr = e.renderer.getPixelRatio();
    const needW = Math.floor(fullWidth * dpr);
    const needH = Math.floor(fullHeight * dpr);
    if (canvas.width !== needW || canvas.height !== needH) {
      e.renderer.setSize(fullWidth, fullHeight, false);
    }

    e.renderer.setScissorTest(false);
    e.renderer.setViewport(0, 0, fullWidth, fullHeight);

    if (this.mode === 'overlay') {
      const scene = this.sceneMain || e.sceneRight;
      const camera = this.cameraMain || e.cameraRight;
      if (!scene || !camera) return;

      if (scene.background) {
        e.renderer.setClearColor(scene.background);
      }
      e.renderer.clear(true, true, true);
      e.renderer.render(scene, camera);
    } else {
      const halfWidth = Math.floor(fullWidth / 2);
      if (e.sceneLeft?.background) {
        e.renderer.setClearColor(e.sceneLeft.background);
      }
      e.renderer.clear(true, true, true);

      e.renderer.setViewport(0, 0, halfWidth, fullHeight);
      e.renderer.setScissor(0, 0, halfWidth, fullHeight);
      e.renderer.setScissorTest(true);
      e.renderer.render(e.sceneLeft, e.cameraLeft);

      e.renderer.setViewport(halfWidth, 0, halfWidth, fullHeight);
      e.renderer.setScissor(halfWidth, 0, halfWidth, fullHeight);
      e.renderer.render(e.sceneRight, e.cameraRight);

      e.renderer.setScissorTest(false);
      e.renderer.setViewport(0, 0, fullWidth, fullHeight);
    }

    if (e.axisGizmo) {
      e.axisGizmo.update();
      e.axisGizmo.render(e.renderer);
    }

    e.renderer.setScissorTest(false);
    e.renderer.setViewport(0, 0, fullWidth, fullHeight);
  }
}

export { GHOST_COLOR, GHOST_OPACITY };
