import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { URDFLoader } from './urdfLoader.js';
import { TrajectoryManager, assertSharedTimelineInvariant } from './trajectoryManager.js';
import { JointController } from './jointController.js';
import { BaseController } from './baseController.js';
import { TimelineController } from './timelineController.js';
import { COMVisualizer } from './comVisualizer.js';
import { i18n } from './i18n.js';
import { ThemeManager } from './themeManager.js';
import { CurveEditor } from './curveEditor.js';
import { AxisGizmo } from './axisGizmo.js';
import { VideoExporter } from './videoExporter.js';
import { CookieManager } from './cookieManager.js';
import { TRAJECTORY_FORMATS } from './trajectoryFormatConverter.js';
import { getBuiltinRobotFiles } from './builtinRobots.js';
import { optimizeObject3DMeshes } from './meshOptimizer.js';

class RobotKeyframeEditor {
  constructor() {
    // 初始化主题管理器
    this.themeManager = new ThemeManager();
    this.themeManager.watchSystemTheme();
    
    // 初始化 Cookie 管理器
    this.cookieManager = new CookieManager();
    
    // i18n 引用（用于 CookieManager 显示状态）
    this.i18n = i18n;
    
    // 左侧场景 (原始轨迹)
    this.sceneLeft = null;
    this.cameraLeft = null;
    this.controlsLeft = null;
    this.robotLeft = null;
    
    // 右侧场景 (编辑后轨迹)
    this.sceneRight = null;
    this.cameraRight = null;
    this.controlsRight = null;
    this.robotRight = null;

    // 独立场景模型（例如可运动平台），同样保留原始/编辑后两份实例
    this.sceneModelLeft = null;
    this.sceneModelRight = null;
    
    // 共享渲染器
    this.renderer = null;
    
    // 兼容旧代码的引用
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.robot = null;
    
    this.urdfLoader = new URDFLoader();
    this.sceneURDFLoader = new URDFLoader();
    this.robotTrajectoryManager = new TrajectoryManager();
    this.sceneTrajectoryManager = new TrajectoryManager();
    // 兼容机器人专用的旧代码路径
    this.trajectoryManager = this.robotTrajectoryManager;
    this.jointController = null;
    this.sceneJointController = null;
    this.baseController = null;
    this.timelineController = null;
    this.curveEditor = null;
    
    // 防止递归更新的标志
    this.isUpdatingKeyframe = false;
    
    // COM可视化器
    this.comVisualizerLeft = null;
    this.comVisualizerRight = null;
    this.showCOM = true; // 默认显示COM
    
    // 坐标轴指示器
    this.axisGizmo = null;
    
    // 视频导出器
    this.videoExporter = null;
    
    // 文件名存储
    this.currentURDFFolder = '';
    this.currentURDFFile = '';
    this.currentProjectFile = '';
    this.currentSceneURDFFolder = '';
    this.currentSceneURDFFile = '';
    this.robotLoadGeneration = 0;
    this.sceneLoadGeneration = 0;

    // 编辑对象与工作区模式
    this.activeTrack = 'robot';
    this.workspaceMode = 'compare';
    
    // 相机控制状态
    this.cameraMode = 'rotate'; // 'rotate' 或 'pan'
    this.followRobot = false;
    this.showCOM = true; // 默认显示重心
    this.autoRefreshFootprint = false; // 自动刷新包络线开关，默认关闭
    this.footprintUpdateTimer = null; // 包络线更新防抖定时器
    this.footprintHeightThresholdCm = 10; // 包络线link高度阈值（cm）
    this.defaultCameraPosition = new THREE.Vector3(3, 3, 2);
    this.defaultCameraTarget = new THREE.Vector3(0, 0, 0.5);
    
    // 脚部识别数据：[{ linkName, ankleJoints: [] }]
    this.identifiedFeet = [];

    this.initialRestorePromise = null;
    this.init();
    this.initialRestorePromise = this.restoreStateIfAvailable().catch(err => {
      console.error('恢复状态错误:', err);
    });
    this.setupEventListeners();
    this.setActiveTrack('robot', { resetTimeline: false });
    this.setWorkspaceMode('compare');
    this.animate();
  }

  getTrajectoryManager(track = 'robot') {
    return track === 'scene' ? this.sceneTrajectoryManager : this.robotTrajectoryManager;
  }

  async waitForInitialRestore() {
    const pendingRestore = this.initialRestorePromise;
    if (pendingRestore) await pendingRestore;
  }

  getActiveTrajectoryManager() {
    return this.getTrajectoryManager(this.activeTrack);
  }

  getSharedTimelineSpec(declaredTimeline = null, managers = null) {
    const timelineManagers = managers || [
      this.robotTrajectoryManager,
      this.sceneTrajectoryManager
    ];
    return assertSharedTimelineInvariant(timelineManagers, declaredTimeline);
  }

  getSharedTimelineManager() {
    if (this.robotTrajectoryManager?.hasTrajectory()) return this.robotTrajectoryManager;
    if (this.sceneTrajectoryManager?.hasTrajectory()) return this.sceneTrajectoryManager;
    return null;
  }

  getTrackEntries() {
    return [
      {
        track: 'robot',
        manager: this.robotTrajectoryManager,
        controller: this.jointController,
        defaultFileName: 'robot_zero.csv'
      },
      {
        track: 'scene',
        manager: this.sceneTrajectoryManager,
        controller: this.sceneJointController,
        defaultFileName: 'scene_zero.csv'
      }
    ];
  }

  createAlignedTrajectoryCandidate(entry, timeline, { reset = false } = {}) {
    const sourceManager = entry.manager;
    const hasSourceTrajectory = sourceManager?.hasTrajectory();
    const hasController = !!entry.controller;
    if (!hasSourceTrajectory && !hasController) return null;

    if (!reset && hasSourceTrajectory && hasController &&
        sourceManager.jointCount !== entry.controller.joints.length) {
      throw new Error(
        `${entry.track} 轨迹关节数 ${sourceManager.jointCount} 与模型关节数 ` +
        `${entry.controller.joints.length} 不一致`
      );
    }

    const jointCount = hasController
      ? entry.controller.joints.length
      : sourceManager.jointCount;
    const candidate = new TrajectoryManager();

    if (reset || !hasSourceTrajectory) {
      candidate.createZeroTrajectory(
        timeline.frameCount,
        jointCount,
        timeline.fps,
        entry.defaultFileName
      );
    } else {
      candidate.loadProjectData(sourceManager.getProjectData());
      candidate.setFPS(timeline.fps);
      candidate.resizeTrajectory(timeline.frameCount);
    }

    candidate.currentFile = sourceManager?.currentFile || candidate.originalFileName;
    return candidate;
  }

  commitTrajectoryCandidate(track, candidate) {
    if (!candidate) return;
    const manager = this.getTrajectoryManager(track);
    manager.loadProjectData(candidate.getProjectData());
    manager.currentFile = candidate.currentFile || candidate.originalFileName;
  }

  buildAlignedTrackCandidates(timeline, options = {}) {
    const candidates = {};
    this.getTrackEntries().forEach(entry => {
      candidates[entry.track] = this.createAlignedTrajectoryCandidate(entry, timeline, options);
    });
    assertSharedTimelineInvariant(
      Object.values(candidates).filter(Boolean),
      timeline
    );
    return candidates;
  }

  ensureLoadedTrackHasSharedTimeline(track) {
    const manager = this.getTrajectoryManager(track);
    const controller = this.getJointController(track);
    if (!controller) return false;

    // Capture the clock before clearing an incompatible old track so loading a
    // replacement model does not destroy the common duration.
    const timeline = this.getSharedTimelineSpec();
    if (manager.hasTrajectory() && manager.jointCount !== controller.joints.length) {
      manager.clearAll();
    }

    if (!manager.hasTrajectory() && timeline) {
      const entry = this.getTrackEntries().find(item => item.track === track);
      const candidate = this.createAlignedTrajectoryCandidate(entry, timeline, { reset: true });
      this.commitTrajectoryCandidate(track, candidate);
      return true;
    }

    this.getSharedTimelineSpec();
    return false;
  }

  getJointController(track = 'robot') {
    return track === 'scene' ? this.sceneJointController : this.jointController;
  }

  getActiveJointController() {
    return this.getJointController(this.activeTrack);
  }

  getActiveBaseController() {
    return this.activeTrack === 'robot' ? this.baseController : null;
  }

  setActiveTrack(track, options = {}) {
    if (track !== 'robot' && track !== 'scene') return;
    const previousFrame = this.timelineController?.getCurrentFrame?.() || 0;
    const trackChanged = this.activeTrack !== track;
    this.activeTrack = track;

    // 关键帧选择属于当前轨道，切换后不能继续引用另一条轨迹的帧。
    if (trackChanged) {
      this.timelineController?.clearSelectedKeyframes?.();
    }

    const robotButton = document.getElementById('edit-target-robot');
    const sceneButton = document.getElementById('edit-target-scene');
    const robotPanel = document.getElementById('robot-control-panel');
    const scenePanel = document.getElementById('scene-control-panel');

    if (robotButton) {
      robotButton.classList.toggle('active', track === 'robot');
      robotButton.setAttribute('aria-pressed', String(track === 'robot'));
    }
    if (sceneButton) {
      sceneButton.classList.toggle('active', track === 'scene');
      sceneButton.setAttribute('aria-pressed', String(track === 'scene'));
    }
    if (robotPanel) robotPanel.style.display = track === 'robot' ? 'flex' : 'none';
    if (scenePanel) scenePanel.style.display = track === 'scene' ? 'flex' : 'none';

    if (options.resetTimeline !== false && this.timelineController) {
      this.refreshTimelineForActiveTrack(previousFrame);
    }

    if (this.curveEditor) {
      this.curveEditor.resetForActiveTrack();
    }
    this.updateCreateModeInputs();
  }

  refreshTimelineForActiveTrack(frame = 0) {
    const manager = this.getActiveTrajectoryManager();
    const timeline = this.getSharedTimelineSpec();
    const frameCount = timeline?.frameCount || 0;
    const fps = timeline?.fps || 50;
    // 刷新意味着轨迹身份或长度可能已变化，旧选择不能跨数据集复用。
    this.timelineController.clearSelectedKeyframes?.();
    this.timelineController.setFPS(fps);
    this.timelineController.updateTimeline(frameCount, frameCount / fps);
    this.timelineController.updateKeyframeMarkers(
      manager ? Array.from(manager.keyframes.keys()) : []
    );
    if (frameCount > 0) {
      this.timelineController.setCurrentFrame(Math.min(frame, frameCount - 1));
    }
  }

  setWorkspaceMode(mode) {
    if (mode !== 'compare' && mode !== 'create') return;
    this.workspaceMode = mode;

    const compareButton = document.getElementById('compare-mode-button');
    const createButton = document.getElementById('create-mode-button');
    const createControls = document.getElementById('create-mode-controls');
    const baseLabel = document.getElementById('base-viewport-label');
    const divider = document.getElementById('viewport-divider');

    if (compareButton) {
      compareButton.classList.toggle('active', mode === 'compare');
      compareButton.setAttribute('aria-pressed', String(mode === 'compare'));
    }
    if (createButton) {
      createButton.classList.toggle('active', mode === 'create');
      createButton.setAttribute('aria-pressed', String(mode === 'create'));
    }
    if (createControls) createControls.style.display = mode === 'create' ? 'flex' : 'none';
    if (baseLabel) baseLabel.style.display = mode === 'compare' ? 'block' : 'none';
    if (divider) divider.style.display = mode === 'compare' ? 'block' : 'none';

    this.updateCreateModeInputs();
    this.handleResize();
  }

  updateCreateModeInputs() {
    const timeline = this.getSharedTimelineSpec();
    const frameInput = document.getElementById('create-frame-count');
    const fpsInput = document.getElementById('create-fps');
    if (frameInput && timeline) frameInput.value = timeline.frameCount;
    if (fpsInput && timeline) fpsInput.value = timeline.fps;
  }

  updateStatus(message, type = 'info') {
    const statusText = document.getElementById('status-text');
    if (statusText) {
      statusText.textContent = message;
      // 只修改文字颜色
      if (type === 'error') {
        statusText.style.color = 'var(--warning-color)';
      } else if (type === 'warning') {
        statusText.style.color = 'var(--warning-color)';
      } else if (type === 'success') {
        statusText.style.color = 'var(--success-color)';
      } else {
        statusText.style.color = 'var(--text-secondary)';
      }
    }
  }

  shouldOptimizeUploadedMeshes() {
    return document.getElementById('optimize-mesh-on-upload')?.checked !== false;
  }

  setMeshOptimizationPreference(enabled) {
    const checkbox = document.getElementById('optimize-mesh-on-upload');
    if (checkbox) checkbox.checked = enabled !== false;
  }

  /**
   * 更新当前文件名显示
   * @param {string} fileName - 文件名
   * @param {string} type - 文件类型 ('csv' 或 'project')
   */
  updateCurrentFileName(fileName, type = 'csv') {
    const fileNameElement = document.getElementById('current-file-name');
    const fileNameText = document.getElementById('file-name-text');
    
    if (fileNameElement && fileNameText && fileName) {
      const icon = type === 'project' ? '📦' : '📄';
      fileNameElement.querySelector('span').textContent = icon;
      
      // 如果文件名太长，显示缩略版本
      const maxLength = 30;
      const displayName = fileName.length > maxLength 
        ? fileName.substring(0, maxLength - 3) + '...' 
        : fileName;
      
      fileNameText.textContent = displayName;
      fileNameText.title = fileName; // 鼠标悬停显示完整文件名
      fileNameElement.style.display = 'flex';
    }
  }

  /**
   * 清除文件名显示
   */
  clearCurrentFileName() {
    const fileNameElement = document.getElementById('current-file-name');
    if (fileNameElement) {
      fileNameElement.style.display = 'none';
    }
  }

  init() {
    // 创建左侧场景 (原始轨迹)
    this.sceneLeft = new THREE.Scene();
    this.sceneLeft.background = new THREE.Color(0x1a1a1a);
    
    // 创建右侧场景 (编辑后轨迹)
    this.sceneRight = new THREE.Scene();
    this.sceneRight.background = new THREE.Color(0x263238);
    
    // 应用当前主题到场景背景
    this.updateSceneBackgrounds(this.themeManager.getCurrentTheme());
    
    // 兼容旧代码
    this.scene = this.sceneRight;    
    // 创建COM可视化器
    this.comVisualizerLeft = new COMVisualizer(this.sceneLeft);
    this.comVisualizerRight = new COMVisualizer(this.sceneRight);
    // 创建相机 (Z-up 坐标系，正交投影)
    const viewport = document.getElementById('viewport');
    const fullWidth = viewport.clientWidth;
    const fullHeight = viewport.clientHeight;
    const halfWidth = fullWidth / 2;
    const aspect = halfWidth / fullHeight;
    const frustumSize = 5; // 可视范围大小
    
    this.cameraLeft = new THREE.OrthographicCamera(
      frustumSize * aspect / -2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      frustumSize / -2,
      0.1,
      1000
    );
    this.cameraLeft.position.set(3, 3, 2);
    this.cameraLeft.up.set(0, 0, 1);
    
    this.cameraRight = new THREE.OrthographicCamera(
      frustumSize * aspect / -2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      frustumSize / -2,
      0.1,
      1000
    );
    this.cameraRight.position.set(3, 3, 2);
    this.cameraRight.up.set(0, 0, 1);
    
    // 存储frustumSize用于窗口调整
    this.frustumSize = frustumSize;
    
    // 兼容旧代码
    this.camera = this.cameraRight;

    // 创建渲染器
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(fullWidth, fullHeight);
    this.renderer.autoClear = false; // 手动控制清除，用于多视口渲染
    viewport.appendChild(this.renderer.domElement);

    // 添加轨道控制器 - 只使用一个控制器，但同步两个相机
    this.controls = new OrbitControls(this.cameraRight, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 0, 0.5);
    
    // 同步左侧相机跟随右侧相机（位置、旋转、缩放）
    this.controls.addEventListener('change', () => {
      this.cameraLeft.position.copy(this.cameraRight.position);
      this.cameraLeft.quaternion.copy(this.cameraRight.quaternion);
      this.cameraLeft.zoom = this.cameraRight.zoom;
      this.cameraLeft.updateProjectionMatrix();
    });
    
    // 兼容双控制器引用
    this.controlsLeft = this.controls;
    this.controlsRight = this.controls;

    // 添加光源到两个场景
    // 左侧场景
    const ambientLightLeft = new THREE.AmbientLight(0xffffff, 0.6);
    this.sceneLeft.add(ambientLightLeft);
    const directionalLightLeft = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLightLeft.position.set(5, 5, 10);
    directionalLightLeft.castShadow = true;
    this.sceneLeft.add(directionalLightLeft);
    const gridHelperLeft = new THREE.GridHelper(10, 20);
    gridHelperLeft.rotation.x = Math.PI / 2;
    this.sceneLeft.add(gridHelperLeft);
    const axesHelperLeft = new THREE.AxesHelper(1);
    this.sceneLeft.add(axesHelperLeft);
    
    // 右侧场景
    const ambientLightRight = new THREE.AmbientLight(0xffffff, 0.6);
    this.sceneRight.add(ambientLightRight);
    const directionalLightRight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLightRight.position.set(5, 5, 10);
    directionalLightRight.castShadow = true;
    this.sceneRight.add(directionalLightRight);
    const gridHelperRight = new THREE.GridHelper(10, 20);
    gridHelperRight.rotation.x = Math.PI / 2;
    this.sceneRight.add(gridHelperRight);
    const axesHelperRight = new THREE.AxesHelper(1);
    this.sceneRight.add(axesHelperRight);

    // 初始化时间轴控制器
    this.timelineController = new TimelineController(this);

    // 初始化曲线编辑器
    this.curveEditor = new CurveEditor(this);
    
    // 初始化坐标轴指示器（右侧视口）
    this.axisGizmo = new AxisGizmo(this, this.cameraRight, this.controls, 'right');

    // 窗口大小调整
    window.addEventListener('resize', () => this.handleResize());
    
  }

  handleResize() {
    const viewport = document.getElementById('viewport');
    const fullWidth = viewport.clientWidth;
    const fullHeight = viewport.clientHeight;
    const viewWidth = this.workspaceMode === 'create' ? fullWidth : fullWidth / 2;
    const aspect = viewWidth / fullHeight;
    
    // 更新正交相机的frustum
    this.cameraLeft.left = this.frustumSize * aspect / -2;
    this.cameraLeft.right = this.frustumSize * aspect / 2;
    this.cameraLeft.top = this.frustumSize / 2;
    this.cameraLeft.bottom = this.frustumSize / -2;
    this.cameraLeft.updateProjectionMatrix();
    
    this.cameraRight.left = this.frustumSize * aspect / -2;
    this.cameraRight.right = this.frustumSize * aspect / 2;
    this.cameraRight.top = this.frustumSize / 2;
    this.cameraRight.bottom = this.frustumSize / -2;
    this.cameraRight.updateProjectionMatrix();
    
    this.renderer.setSize(fullWidth, fullHeight);
  }

  setupEventListeners() {
    document.getElementById('upload-robot-urdf')?.addEventListener('click', () => {
      document.getElementById('urdf-folder')?.click();
    });

    document.querySelectorAll('[data-robot-preset]').forEach(button => {
      button.addEventListener('click', () => {
        this.loadBuiltinRobot(button.dataset.robotPreset);
      });
    });

    // URDF 文件夹加载
    document.getElementById('urdf-folder').addEventListener('change', (e) => {
      this.loadURDFFolder(Array.from(e.target.files), {
        optimizeMeshes: this.shouldOptimizeUploadedMeshes()
      });
      e.target.value = '';
    });

    document.getElementById('scene-urdf-folder')?.addEventListener('change', (e) => {
      this.loadSceneURDFFolder(Array.from(e.target.files), {
        optimizeMeshes: this.shouldOptimizeUploadedMeshes()
      });
      e.target.value = '';
    });

    document.getElementById('optimize-mesh-on-upload')?.addEventListener('change', async event => {
      const enabled = event.target.checked;
      await this.waitForInitialRestore();
      this.setMeshOptimizationPreference(enabled);
      this.triggerAutoSave();
    });

    // CSV 文件加载
    document.getElementById('csv-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.loadCSV(file);
      }
      e.target.value = '';
    });

    document.getElementById('edit-target-robot')?.addEventListener('click', () => {
      this.setActiveTrack('robot');
    });

    document.getElementById('edit-target-scene')?.addEventListener('click', () => {
      this.setActiveTrack('scene');
    });

    document.getElementById('compare-mode-button')?.addEventListener('click', () => {
      this.setWorkspaceMode('compare');
    });

    document.getElementById('create-mode-button')?.addEventListener('click', () => {
      this.setWorkspaceMode('create');
    });

    document.getElementById('create-zero-trajectory')?.addEventListener('click', () => {
      this.createZeroTrajectory();
    });

    document.getElementById('apply-trajectory-length')?.addEventListener('click', () => {
      this.applyTrajectoryLength();
    });

    // 添加关键帧
    document.getElementById('add-keyframe').addEventListener('click', () => {
      this.addKeyframe();
    });

    // 删除当前关键帧
    document.getElementById('delete-keyframe').addEventListener('click', () => {
      this.deleteCurrentKeyframe();
    });

    // 平滑关键帧
    document.getElementById('smooth-keyframes').addEventListener('click', () => {
      this.smoothSelectedKeyframes();
    });

    // 重置关节
    document.getElementById('reset-joints').addEventListener('click', () => {
      const jointController = this.getActiveJointController();
      if (jointController) {
        jointController.resetToBase();
      }
      if (this.activeTrack === 'robot' && this.baseController) {
        this.baseController.resetToBase();
      }
    });

    document.getElementById('reset-scene-joints')?.addEventListener('click', () => {
      this.sceneJointController?.resetToBase();
    });

    // 播放/暂停
    document.getElementById('play-pause').addEventListener('click', () => {
      this.timelineController.togglePlayPause();
    });

    // 导出编辑后的轨迹
    document.getElementById('export-trajectory').addEventListener('click', () => {
      this.exportTrajectory();
    });

    // 导出原始轨迹
    document.getElementById('export-base-trajectory').addEventListener('click', () => {
      this.exportBaseTrajectory();
    });

    document.getElementById('export-scene-trajectory')?.addEventListener('click', () => {
      this.exportSceneTrajectory();
    });

    document.getElementById('export-scene-base-trajectory')?.addEventListener('click', () => {
      this.exportSceneBaseTrajectory();
    });

    // 导出视频
    document.getElementById('export-video').addEventListener('click', () => {
      if (!this.videoExporter) {
        this.videoExporter = new VideoExporter(this);
      }
      this.videoExporter.startExport();
    });

    // 保存工程文件
    document.getElementById('save-project').addEventListener('click', () => {
      this.saveProject();
    });

    // 加载工程文件
    document.getElementById('load-project').addEventListener('change', (e) => {
      this.loadProject(e);
    });

    // 切换相机模式（旋转/平移）
    document.getElementById('toggle-camera-mode').addEventListener('click', () => {
      this.toggleCameraMode();
    });

    // 重置相机视角
    document.getElementById('reset-camera').addEventListener('click', () => {
      this.resetCamera();
    });

    // 切换跟随机器人
    document.getElementById('follow-robot').addEventListener('click', () => {
      this.toggleFollowRobot();
    });

    // 切换重心显示
    document.getElementById('toggle-com').addEventListener('click', () => {
      this.toggleCOM();
    });

    // 刷新地面投影包络线
    document.getElementById('refresh-footprint').addEventListener('click', () => {
      this.refreshFootprint();
    });

    const footprintHeightInput = document.getElementById('footprint-height-threshold');
    if (footprintHeightInput) {
      // 防止输入框点击触发按钮刷新
      footprintHeightInput.addEventListener('click', (event) => {
        event.stopPropagation();
      });
      footprintHeightInput.addEventListener('keydown', (event) => {
        event.stopPropagation();
      });
    }

    // 切换自动刷新包络线
    document.getElementById('toggle-auto-refresh').addEventListener('click', () => {
      this.toggleAutoRefreshFootprint();
    });

    // 自动旋转按钮
    document.getElementById('auto-rotate-major').addEventListener('click', () => {
      this.autoRotateToFootprint('major');
    });

    document.getElementById('auto-rotate-minor').addEventListener('click', () => {
      this.autoRotateToFootprint('minor');
    });
    
    // 脚部识别和控制
    document.getElementById('identify-feet').addEventListener('click', () => {
      this.identifyFeet();
    });
    
    document.getElementById('level-feet').addEventListener('click', () => {
      this.levelFeet();
    });
    
    // 脚部控制面板折叠
    document.getElementById('foot-control-header').addEventListener('click', () => {
      const controls = document.getElementById('foot-controls');
      const isHidden = controls.style.display === 'none';
      controls.style.display = isHidden ? 'block' : 'none';
      const header = document.getElementById('foot-control-header');
      header.querySelector('h3').textContent = isHidden ? '▼ ' + header.querySelector('h3').textContent.slice(2) : '▶ ' + header.querySelector('h3').textContent.slice(2);
    });
    
    // 重置应用
    document.getElementById('reset-button').addEventListener('click', () => {
      this.resetApplication();
    });
    
    // Cookie 自动保存开关
    const autoSaveToggle = document.getElementById('auto-save-toggle');
    if (autoSaveToggle) {
      // 初始化开关状态
      autoSaveToggle.checked = this.cookieManager.isAutoSaveEnabled();
      
      autoSaveToggle.addEventListener('change', (e) => {
        this.toggleAutoSave(e.target.checked);
      });
    }
    
    // 清除 Cookies 按钮
    document.getElementById('clear-cookies').addEventListener('click', () => {
      this.clearCookies();
    });

    // 主题切换
    document.getElementById('theme-toggle').addEventListener('click', () => {
      const newTheme = this.themeManager.toggleTheme();
      this.updateThemeIcon(newTheme);
      this.updateSceneBackgrounds(newTheme);
    });

    // 监听主题变化事件（比如系统主题变化）
    window.addEventListener('themeChanged', (e) => {
      this.updateThemeIcon(e.detail.theme);
      this.updateSceneBackgrounds(e.detail.theme);
    });

    // 初始化主题图标
    this.updateThemeIcon(this.themeManager.getCurrentTheme());

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      // 如果焦点在输入框内，不触发快捷键
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      switch(e.code) {
        case 'Space':
          e.preventDefault(); // 防止页面滚动
          if (this.timelineController) {
            this.timelineController.togglePlayPause();
          }
          break;
        
        case 'ArrowLeft':
          e.preventDefault();
          if (this.timelineController) {
            const currentFrame = this.timelineController.getCurrentFrame();
            if (currentFrame > 0) {
              this.timelineController.setCurrentFrame(currentFrame - 1);
            }
          }
          break;
        
        case 'ArrowRight':
          e.preventDefault();
          if (this.timelineController) {
            const currentFrame = this.timelineController.getCurrentFrame();
            const maxFrame = (this.getSharedTimelineSpec()?.frameCount || 0) - 1;
            if (currentFrame < maxFrame) {
              this.timelineController.setCurrentFrame(currentFrame + 1);
            }
          }
          break;
      }
    });
  }

  getCreateTrajectorySettings() {
    const frameInput = document.getElementById('create-frame-count');
    const fpsInput = document.getElementById('create-fps');
    const frameCount = Math.max(1, Math.floor(Number(frameInput?.value) || 1));
    const fps = Math.max(1, Math.min(240, Math.floor(Number(fpsInput?.value) || 50)));

    if (frameInput) frameInput.value = frameCount;
    if (fpsInput) fpsInput.value = fps;
    return { frameCount, fps };
  }

  async createZeroTrajectory() {
    await this.waitForInitialRestore();
    const entries = this.getTrackEntries();
    if (!entries.some(entry => entry.controller || entry.manager.hasTrajectory())) {
      alert(i18n.t('needRobot'));
      return;
    }

    const { frameCount, fps } = this.getCreateTrajectorySettings();
    const timeline = { frameCount, fps };
    const candidates = this.buildAlignedTrackCandidates(timeline, { reset: true });
    Object.entries(candidates).forEach(([track, candidate]) => {
      this.commitTrajectoryCandidate(track, candidate);
    });

    this.setWorkspaceMode('create');
    this.refreshTimelineForActiveTrack(0);
    this.curveEditor?.resetForActiveTrack();
    this.updateRobotState(0);
    this.updateStatus(i18n.t('zeroTrajectoryCreated', { frames: frameCount, fps }), 'success');
    this.triggerAutoSave();
  }

  async applyTrajectoryLength() {
    await this.waitForInitialRestore();
    if (!this.getSharedTimelineSpec()) {
      await this.createZeroTrajectory();
      return;
    }

    const { frameCount, fps } = this.getCreateTrajectorySettings();
    const currentFrame = this.timelineController.getCurrentFrame();
    const timeline = { frameCount, fps };
    const candidates = this.buildAlignedTrackCandidates(timeline);
    Object.entries(candidates).forEach(([track, candidate]) => {
      this.commitTrajectoryCandidate(track, candidate);
    });
    this.refreshTimelineForActiveTrack(Math.min(currentFrame, frameCount - 1));
    this.curveEditor?.updateCurves();
    this.curveEditor?.draw();
    this.updateStatus(i18n.t('trajectoryLengthUpdated', { frames: frameCount, fps }), 'success');
    this.triggerAutoSave();
  }

  async optimizeLoadedModelMeshes(model, modelLabel) {
    if (!model) return null;

    try {
      return await optimizeObject3DMeshes(model, {
        onProgress: (_detail, stats) => {
          this.updateStatus(i18n.t('optimizingMeshes', {
            model: modelLabel,
            current: stats.details.length,
            total: stats.totalMeshes
          }), 'info');
        }
      });
    } catch (error) {
      // Mesh 优化是上传加速项，不应该因为某种不常见几何而阻断 URDF。
      console.warn(`${modelLabel} Mesh 优化失败，保留原始几何:`, error);
      return null;
    }
  }

  summarizeMeshOptimization(...results) {
    const validResults = results.filter(Boolean);
    if (validResults.length === 0) return null;
    return validResults.reduce((summary, stats) => {
      summary.beforeTriangles += stats.beforeTriangles || 0;
      summary.afterTriangles += stats.afterTriangles || 0;
      summary.optimizedMeshes += stats.optimizedMeshes || 0;
      summary.failedMeshes += stats.failedMeshes || 0;
      return summary;
    }, {
      beforeTriangles: 0,
      afterTriangles: 0,
      optimizedMeshes: 0,
      failedMeshes: 0
    });
  }

  shareModelGeometries(sourceRoot, targetRoot) {
    const collectMeshes = root => {
      const meshes = [];
      root?.traverse?.(object => {
        if (object?.isMesh && object.geometry?.isBufferGeometry) meshes.push(object);
      });
      return meshes;
    };
    const sourceMeshes = collectMeshes(sourceRoot);
    const targetMeshes = collectMeshes(targetRoot);
    if (sourceMeshes.length !== targetMeshes.length) return false;

    const pairsMatch = sourceMeshes.every((sourceMesh, index) => {
      const targetMesh = targetMeshes[index];
      return sourceMesh.name === targetMesh.name
        && sourceMesh.geometry?.type === targetMesh.geometry?.type;
    });
    if (!pairsMatch) return false;

    const sourceGeometries = new Set(sourceMeshes.map(mesh => mesh.geometry));
    const replacedGeometries = new Set();
    sourceMeshes.forEach((sourceMesh, index) => {
      const targetMesh = targetMeshes[index];
      if (targetMesh.geometry !== sourceMesh.geometry) {
        replacedGeometries.add(targetMesh.geometry);
        targetMesh.geometry = sourceMesh.geometry;
      }
    });
    replacedGeometries.forEach(geometry => {
      if (!sourceGeometries.has(geometry)) geometry?.dispose?.();
    });
    return true;
  }

  disposeObject3DResources(...roots) {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();

    roots.filter(Boolean).forEach(root => {
      root.traverse?.(object => {
        if (object.geometry?.dispose) geometries.add(object.geometry);
        const objectMaterials = Array.isArray(object.material)
          ? object.material
          : (object.material ? [object.material] : []);
        objectMaterials.forEach(material => {
          if (!material) return;
          materials.add(material);
          Object.values(material).forEach(value => {
            if (value?.isTexture && value.dispose) textures.add(value);
          });
        });
        if (object.skeleton?.boneTexture?.dispose) textures.add(object.skeleton.boneTexture);
      });
    });

    textures.forEach(texture => texture.dispose());
    materials.forEach(material => material.dispose?.());
    geometries.forEach(geometry => geometry.dispose());
  }

  async loadBuiltinRobot(robotId) {
    await this.waitForInitialRestore();
    const normalizedId = String(robotId || '').toLowerCase();
    const robotName = normalizedId.toUpperCase();
    // The intent starts before asset fetches. Reset, a manual upload, or a
    // newer preset selection can therefore invalidate a slow built-in fetch.
    const requestGeneration = ++this.robotLoadGeneration;
    const presetButtons = Array.from(document.querySelectorAll('[data-robot-preset]'));
    const addRobotButton = document.getElementById('add-robot-button');

    presetButtons.forEach(button => { button.disabled = true; });
    if (addRobotButton) addRobotButton.disabled = true;
    addRobotButton?.setAttribute('aria-busy', 'true');
    this.updateStatus(i18n.t('loadingBuiltinRobot', { robot: robotName }), 'info');

    try {
      const files = await getBuiltinRobotFiles(normalizedId);
      if (requestGeneration !== this.robotLoadGeneration) return false;
      const loaded = await this.loadURDFFolder(files, {
        optimizeMeshes: false,
        requestGeneration
      });
      if (loaded) {
        this.updateStatus(i18n.t('builtinRobotLoadSuccess', { robot: robotName }), 'success');
      }
      return loaded;
    } catch (error) {
      if (requestGeneration !== this.robotLoadGeneration) return false;
      console.error(`内置机器人 ${robotName} 加载失败:`, error);
      this.updateStatus(i18n.t('builtinRobotLoadFailed', { robot: robotName }), 'error');
      alert(i18n.t('builtinRobotLoadFailed', { robot: robotName }) + ': ' + error.message);
      return false;
    } finally {
      presetButtons.forEach(button => { button.disabled = false; });
      if (addRobotButton) addRobotButton.disabled = false;
      addRobotButton?.removeAttribute('aria-busy');
    }
  }

  async loadURDFFolder(files, {
    optimizeMeshes = true,
    requestGeneration: suppliedGeneration = null
  } = {}) {
    await this.waitForInitialRestore();
    if (!files || files.length === 0) return false;
    const requestGeneration = suppliedGeneration ?? ++this.robotLoadGeneration;
    if (requestGeneration !== this.robotLoadGeneration) return false;
    this.updateStatus(i18n.t('loadingURDFFolder'), 'info');

    const urdfFile = Array.from(files).find(f => f.name.endsWith('.urdf'));
    const nextURDFFile = urdfFile?.name || '';
    const nextURDFFolder = urdfFile?.webkitRelativePath
      ? urdfFile.webkitRelativePath.split('/')[0]
      : '';
    const candidateLoader = new URDFLoader();
    let nextRobotRight = null;
    let nextRobotLeft = null;
    let committed = false;

    try {
      await candidateLoader.loadFromFolder(files);
      nextRobotRight = candidateLoader.getRobotModel();
      if (!nextRobotRight) throw new Error(i18n.t('robotModelCreateFailed'));
      if (requestGeneration !== this.robotLoadGeneration) {
        this.disposeObject3DResources(nextRobotRight);
        return false;
      }

      nextRobotLeft = await candidateLoader.loadFromMap(
        new Map(candidateLoader.fileMap)
      );
      if (requestGeneration !== this.robotLoadGeneration) {
        this.disposeObject3DResources(nextRobotRight, nextRobotLeft);
        return false;
      }

      let meshOptimization = null;
      if (optimizeMeshes) {
        const rightStats = await this.optimizeLoadedModelMeshes(
          nextRobotRight,
          i18n.t('robot')
        );
        if (requestGeneration !== this.robotLoadGeneration) {
          this.disposeObject3DResources(nextRobotRight, nextRobotLeft);
          return false;
        }
        // 左右视口来自同一份 URDF。共享右侧已优化 geometry，既保持
        // 两侧完全一致，也避免把高面数简化工作重复执行两遍。
        if (this.shareModelGeometries(nextRobotRight, nextRobotLeft)) {
          meshOptimization = rightStats;
        } else {
          const leftStats = await this.optimizeLoadedModelMeshes(
            nextRobotLeft,
            i18n.t('robot')
          );
          meshOptimization = this.summarizeMeshOptimization(rightStats, leftStats);
        }
      }
      if (requestGeneration !== this.robotLoadGeneration) {
        this.disposeObject3DResources(nextRobotRight, nextRobotLeft);
        return false;
      }

      const previousRobotLeft = this.robotLeft;
      const previousRobotRight = this.robotRight;
      if (this.robotLeft) this.sceneLeft.remove(this.robotLeft);
      if (this.robotRight) this.sceneRight.remove(this.robotRight);
      this.urdfLoader = candidateLoader;
      this.robotRight = nextRobotRight;
      this.robotLeft = nextRobotLeft;
      this.robot = this.robotRight;
      this.currentURDFFile = nextURDFFile;
      this.currentURDFFolder = nextURDFFolder;
      this.sceneRight.add(this.robotRight);
      this.sceneLeft.add(this.robotLeft);
      committed = true;
      this.disposeObject3DResources(previousRobotLeft, previousRobotRight);

      const joints = candidateLoader.getJoints();
      this.jointController = new JointController(joints, this, {
        track: 'robot',
        containerId: 'joint-controls',
        idPrefix: 'robot'
      });
      this.baseController = new BaseController(this);

      this.ensureLoadedTrackHasSharedTimeline('robot');

      this.setActiveTrack('robot');
      this.updateRobotState(this.timelineController.getCurrentFrame());

      if (this.showCOM) {
        this.comVisualizerLeft?.update(this.robotLeft);
        this.comVisualizerRight?.update(this.robotRight);
      }

      const statusKey = meshOptimization?.optimizedMeshes > 0
        ? 'robotUrdfOptimizedLoadSuccess'
        : 'robotUrdfLoadSuccess';
      this.updateStatus(i18n.t(statusKey, {
        count: joints.length,
        before: meshOptimization?.beforeTriangles?.toLocaleString() || '0',
        after: meshOptimization?.afterTriangles?.toLocaleString() || '0'
      }), meshOptimization?.failedMeshes > 0 ? 'warning' : 'success');
      this.triggerAutoSave(true);
      return true;
    } catch (error) {
      if (!committed) this.disposeObject3DResources(nextRobotRight, nextRobotLeft);
      if (requestGeneration !== this.robotLoadGeneration) return false;
      console.error('机器人 URDF 加载失败:', error);
      this.updateStatus(i18n.t('urdfLoadFailed'), 'error');
      alert(i18n.t('urdfLoadFailed') + ': ' + error.message);
      return false;
    }
  }

  async loadSceneURDFFolder(files, { optimizeMeshes = true } = {}) {
    await this.waitForInitialRestore();
    if (!files || files.length === 0) return false;
    const requestGeneration = ++this.sceneLoadGeneration;
    this.updateStatus(i18n.t('loadingSceneURDFFolder'), 'info');

    const urdfFile = Array.from(files).find(file => file.name.toLowerCase().endsWith('.urdf'));
    const nextSceneURDFFile = urdfFile?.name || '';
    const nextSceneURDFFolder = urdfFile?.webkitRelativePath
      ? urdfFile.webkitRelativePath.split('/')[0]
      : '';
    const candidateLoader = new URDFLoader();
    let nextSceneRight = null;
    let nextSceneLeft = null;
    let committed = false;

    try {
      await candidateLoader.loadFromFolder(files);
      nextSceneRight = candidateLoader.getRobotModel();
      if (!nextSceneRight) throw new Error(i18n.t('sceneModelCreateFailed'));
      if (requestGeneration !== this.sceneLoadGeneration) {
        this.disposeObject3DResources(nextSceneRight);
        return false;
      }

      nextSceneLeft = await candidateLoader.loadFromMap(
        new Map(candidateLoader.fileMap)
      );
      if (requestGeneration !== this.sceneLoadGeneration) {
        this.disposeObject3DResources(nextSceneRight, nextSceneLeft);
        return false;
      }

      let meshOptimization = null;
      if (optimizeMeshes) {
        const rightStats = await this.optimizeLoadedModelMeshes(
          nextSceneRight,
          i18n.t('scene')
        );
        if (requestGeneration !== this.sceneLoadGeneration) {
          this.disposeObject3DResources(nextSceneRight, nextSceneLeft);
          return false;
        }
        if (this.shareModelGeometries(nextSceneRight, nextSceneLeft)) {
          meshOptimization = rightStats;
        } else {
          const leftStats = await this.optimizeLoadedModelMeshes(
            nextSceneLeft,
            i18n.t('scene')
          );
          meshOptimization = this.summarizeMeshOptimization(rightStats, leftStats);
        }
      }
      if (requestGeneration !== this.sceneLoadGeneration) {
        this.disposeObject3DResources(nextSceneRight, nextSceneLeft);
        return false;
      }

      const previousSceneLeft = this.sceneModelLeft;
      const previousSceneRight = this.sceneModelRight;
      if (this.sceneModelLeft) this.sceneLeft.remove(this.sceneModelLeft);
      if (this.sceneModelRight) this.sceneRight.remove(this.sceneModelRight);
      this.sceneURDFLoader = candidateLoader;
      this.sceneModelRight = nextSceneRight;
      this.sceneModelLeft = nextSceneLeft;
      this.currentSceneURDFFile = nextSceneURDFFile;
      this.currentSceneURDFFolder = nextSceneURDFFolder;
      this.sceneRight.add(this.sceneModelRight);
      this.sceneLeft.add(this.sceneModelLeft);
      committed = true;
      this.disposeObject3DResources(previousSceneLeft, previousSceneRight);

      const joints = candidateLoader.getJoints();
      this.sceneJointController = new JointController(joints, this, {
        track: 'scene',
        containerId: 'scene-joint-controls',
        idPrefix: 'scene',
        allowFix: true
      });

      this.ensureLoadedTrackHasSharedTimeline('scene');

      this.setActiveTrack('scene');
      this.updateRobotState(this.timelineController.getCurrentFrame());
      const statusKey = meshOptimization?.optimizedMeshes > 0
        ? 'sceneUrdfOptimizedLoadSuccess'
        : 'sceneUrdfLoadSuccess';
      this.updateStatus(i18n.t(statusKey, {
        count: joints.length,
        before: meshOptimization?.beforeTriangles?.toLocaleString() || '0',
        after: meshOptimization?.afterTriangles?.toLocaleString() || '0'
      }), meshOptimization?.failedMeshes > 0 ? 'warning' : 'success');
      this.triggerAutoSave(true);
      return true;
    } catch (error) {
      if (!committed) this.disposeObject3DResources(nextSceneRight, nextSceneLeft);
      if (requestGeneration !== this.sceneLoadGeneration) return false;
      console.error('场景 URDF 加载失败:', error);
      this.updateStatus(i18n.t('sceneUrdfLoadFailed'), 'error');
      alert(i18n.t('sceneUrdfLoadFailed') + ': ' + error.message);
      return false;
    }
  }

  async loadCSV(file) {
    await this.waitForInitialRestore();
    this.updateStatus(i18n.t('loadingCSVFile'), 'info');
    const controller = this.jointController;
    if (!controller) {
      alert(i18n.t('needRobot'));
      return;
    }

    try {
      const text = await file.text();
      const candidate = new TrajectoryManager();
      candidate.parseCSV(text, file.name);

      if (!candidate.hasTrajectory()) throw new Error(i18n.t('emptyTrajectory'));

      const expectedJointCount = controller.joints.length;
      const hasInvalidRow = candidate.baseTrajectory.some(
        state => !Array.isArray(state.joints) || state.joints.length !== expectedJointCount
      );
      if (candidate.jointCount !== expectedJointCount || hasInvalidRow) {
        throw new Error(i18n.t('trajectoryJointCountMismatch', {
          expected: expectedJointCount,
          actual: candidate.jointCount
        }));
      }

      const defaultFPS = candidate.fps || 50;
      const requestedFPS = prompt(i18n.t('setTrajectoryFPS'), String(defaultFPS));
      const fps = Math.max(1, parseInt(requestedFPS) || defaultFPS);
      candidate.setFPS(fps);
      candidate.currentFile = file.name;

      // Robot CSV is the sole imported clock. Build the aligned scene copy
      // first and commit both only after every validation succeeds.
      const timeline = { frameCount: candidate.getFrameCount(), fps };
      const sceneEntry = this.getTrackEntries().find(entry => entry.track === 'scene');
      const nextSceneManager = this.createAlignedTrajectoryCandidate(sceneEntry, timeline);
      assertSharedTimelineInvariant(
        [candidate, nextSceneManager].filter(Boolean),
        timeline
      );

      this.commitTrajectoryCandidate('robot', candidate);
      this.robotTrajectoryManager.currentFile = file.name;
      if (nextSceneManager) {
        this.commitTrajectoryCandidate('scene', nextSceneManager);
      }

      this.timelineController.pause();
      this.setActiveTrack('robot', { resetTimeline: false });
      this.refreshTimelineForActiveTrack(0);
      this.curveEditor?.resetForActiveTrack();
      this.updateRobotState(0);

      const frameCount = this.robotTrajectoryManager.getFrameCount();
      this.updateStatus(i18n.t('csvLoadSuccess', { frames: frameCount, fps: fps }), 'success');
      this.updateCurrentFileName(file.name, 'csv');
      this.triggerAutoSave();
    } catch (error) {
      console.error('CSV 加载失败:', error);
      this.updateStatus(i18n.t('csvLoadFailed'), 'error');
      alert(i18n.t('csvLoadFailed') + ': ' + error.message);
    }
  }

  mapTimelineFrameToTrack(frameIndex, track) {
    const targetManager = this.getTrajectoryManager(track);
    if (!targetManager?.hasTrajectory()) return null;

    const timeline = this.getSharedTimelineSpec();
    if (!timeline) return null;
    const integerFrame = Math.round(Number(frameIndex) || 0);
    return Math.max(0, Math.min(integerFrame, timeline.frameCount - 1));
  }

  applyStateToModel(model, state, joints) {
    if (!model || !state) return;
    model.position.set(state.base.position.x, state.base.position.y, state.base.position.z);
    model.quaternion.set(
      state.base.quaternion.x,
      state.base.quaternion.y,
      state.base.quaternion.z,
      state.base.quaternion.w
    );
    state.joints.forEach((value, index) => {
      if (joints && index < joints.length) {
        model.setJointValue(joints[index].name, value);
      }
    });
  }

  updateRobotState(frameIndex) {
    const robotFrame = this.mapTimelineFrameToTrack(frameIndex, 'robot');
    const sceneFrame = this.mapTimelineFrameToTrack(frameIndex, 'scene');
    this.updateRobotTrackState(robotFrame);
    this.updateSceneTrackState(sceneFrame);
  }

  updateRobotTrackState(frameIndex) {
    if (frameIndex === null || !this.jointController ||
        (!this.robotLeft && !this.robotRight)) return;

    const baseState = this.robotTrajectoryManager.getInterpolatedBaseState(frameIndex);
    const combinedState = this.robotTrajectoryManager.getCombinedStateAtFrame(frameIndex);
    const joints = this.jointController.joints;

    this.applyStateToModel(this.robotLeft, baseState, joints);
    this.applyStateToModel(this.robotRight, combinedState, joints);

    if (this.activeTrack === 'robot' && combinedState) {
      this.jointController.updateJoints(combinedState.joints);
      this.baseController?.updateBase(combinedState.base.position, combinedState.base.quaternion);
    }

    if (this.showCOM) {
      if (this.robotLeft) this.comVisualizerLeft?.update(this.robotLeft);
      if (this.robotRight) this.comVisualizerRight?.update(this.robotRight);
    }
    this.robot = this.robotRight;
  }

  updateSceneTrackState(frameIndex) {
    if (frameIndex === null || !this.sceneJointController ||
        (!this.sceneModelLeft && !this.sceneModelRight)) return;

    const baseState = this.sceneTrajectoryManager.getInterpolatedBaseState(frameIndex);
    const combinedState = this.sceneTrajectoryManager.getCombinedStateAtFrame(frameIndex);
    const joints = this.sceneJointController.joints;

    this.applyStateToModel(this.sceneModelLeft, baseState, joints);
    this.applyStateToModel(this.sceneModelRight, combinedState, joints);

    if (this.activeTrack === 'scene' && combinedState) {
      this.sceneJointController.updateJoints(combinedState.joints);
    }
  }

  addKeyframe() {
    const manager = this.getActiveTrajectoryManager();
    const jointController = this.getActiveJointController();
    const baseController = this.getActiveBaseController();

    if (!jointController) {
      alert(this.activeTrack === 'scene' ? i18n.t('needScene') : i18n.t('needRobot'));
      return;
    }

    if (!manager.hasTrajectory()) {
      alert(i18n.t('needTrajectory'));
      return;
    }

    const currentFrame = this.timelineController.getCurrentFrame();
    const currentJointValues = jointController.getCurrentJointValues();
    const currentBaseValues = baseController ? baseController.getCurrentBaseValues() : null;
    
    const isNew = manager.addKeyframe(currentFrame, currentJointValues, currentBaseValues);
    
    // 只有新关键帧才更新标记
    if (isNew) {
      const keyframes = Array.from(manager.keyframes.keys());
      this.timelineController.updateKeyframeMarkers(keyframes);
      console.log('➕ 添加关键帧:', currentFrame);
    } else {
      console.log('🔄 关键帧已存在，已更新残差');
    }
    
    // 更新关键帧指示器
    if (jointController.updateKeyframeIndicators) {
      jointController.updateKeyframeIndicators();
    }
    if (baseController?.updateKeyframeIndicators) {
      baseController.updateKeyframeIndicators();
    }
    
    // 通知曲线编辑器更新
    if (this.curveEditor) {
      this.curveEditor.updateCurves();
      this.curveEditor.draw();
    }
    
    // 触发自动保存
    this.triggerAutoSave();
  }

  deleteCurrentKeyframe() {
    const manager = this.getActiveTrajectoryManager();
    const jointController = this.getActiveJointController();
    const baseController = this.getActiveBaseController();

    if (!manager.hasTrajectory()) {
      alert(i18n.t('needTrajectory'));
      return;
    }

    const currentFrame = this.timelineController.getCurrentFrame();
    
    if (manager.keyframes.has(currentFrame)) {
      manager.removeKeyframe(currentFrame);
      
      // 更新时间轴上的关键帧标记
      const keyframes = Array.from(manager.keyframes.keys());
      this.timelineController.updateKeyframeMarkers(keyframes);
      
      // 更新显示
      this.updateRobotState(currentFrame);
      
      // 更新关键帧指示器
      if (jointController?.updateKeyframeIndicators) {
        jointController.updateKeyframeIndicators();
      }
      if (baseController?.updateKeyframeIndicators) {
        baseController.updateKeyframeIndicators();
      }
      
      // 通知曲线编辑器更新
      if (this.curveEditor) {
        this.curveEditor.updateCurves();
        this.curveEditor.draw();
      }
      
      // 触发自动保存
      this.triggerAutoSave();
      
      console.log('删除关键帧:', currentFrame);
    } else {
      alert('当前帧不是关键帧');
    }
  }

  /**
   * 平滑选中的关键帧
   * 要求：至少选中3个连续关键帧
   * 效果：第一个和最后一个关键帧保持不变，中间关键帧的残差自动计算
   *       使得叠加值等于前后关键帧叠加值的线性插值
   */
  smoothSelectedKeyframes() {
    const manager = this.getActiveTrajectoryManager();
    if (!manager.hasTrajectory()) {
      alert(i18n.t('needTrajectory'));
      return;
    }

    // 获取选中的关键帧并排序
    const selectedKeyframes = this.timelineController.getSelectedKeyframes();
    
    if (selectedKeyframes.length < 3) {
      alert('请选择至少3个关键帧（使用 Shift+点击）');
      return;
    }

    // 检查是否为连续关键帧
    let isConsecutive = true;
    for (let i = 1; i < selectedKeyframes.length; i++) {
      const prevFrame = selectedKeyframes[i - 1];
      const currentFrame = selectedKeyframes[i];
      const keyframesBetween = Array.from(manager.keyframes.keys())
        .filter(f => f > prevFrame && f < currentFrame);
      
      if (keyframesBetween.length > 0) {
        isConsecutive = false;
        break;
      }
    }

    if (!isConsecutive) {
      alert('请选择连续的关键帧（中间不能有未选中的关键帧）');
      return;
    }

    // 保持第一个和最后一个关键帧，平滑中间关键帧
    const startFrame = selectedKeyframes[0];
    const endFrame = selectedKeyframes[selectedKeyframes.length - 1];
    const middleFrames = selectedKeyframes.slice(1, -1);

    if (middleFrames.length === 0) {
      alert('需要至少3个关键帧（包含中间帧）才能进行平滑');
      return;
    }

    // 获取起始和结束关键帧数据
    const startKeyframe = manager.keyframes.get(startFrame);
    const endKeyframe = manager.keyframes.get(endFrame);

    // 计算起始和结束的叠加值（原始值 + 残差）
    const startOverlay = this.calculateOverlayValues(startFrame, startKeyframe);
    const endOverlay = this.calculateOverlayValues(endFrame, endKeyframe);

    // 对每个中间关键帧进行平滑
    middleFrames.forEach(frame => {
      const keyframe = manager.keyframes.get(frame);
      
      // 计算插值比例
      const t = (frame - startFrame) / (endFrame - startFrame);
      
      // 对关节角度进行线性插值并计算新残差
      if (keyframe.residual && startOverlay.joints && endOverlay.joints) {
        for (let i = 0; i < keyframe.residual.length; i++) {
          // 线性插值叠加值
          const interpolatedOverlay = startOverlay.joints[i] + t * (endOverlay.joints[i] - startOverlay.joints[i]);
          
          // 获取该帧的原始关节角度
          const frameBaseState = manager.getBaseState(frame);
          const baseJointValue = frameBaseState ? frameBaseState.joints[i] : 0;
          
          // 新残差 = 插值叠加值 - 原始值
          keyframe.residual[i] = interpolatedOverlay - baseJointValue;
        }
      }
      
      // 对基座位置进行线性插值并计算新残差
      if (keyframe.baseResidual && startOverlay.basePosition && endOverlay.basePosition) {
        const frameBaseState = manager.getBaseState(frame);
        if (frameBaseState) {
          ['x', 'y', 'z'].forEach(axis => {
            const interpolatedOverlay = startOverlay.basePosition[axis] + 
              t * (endOverlay.basePosition[axis] - startOverlay.basePosition[axis]);
            
            const basePoseValue = frameBaseState.base.position[axis];
            
            if (!keyframe.baseResidual.position) {
              keyframe.baseResidual.position = { x: 0, y: 0, z: 0 };
            }
            keyframe.baseResidual.position[axis] = interpolatedOverlay - basePoseValue;
          });
        }
      }
      
      // 对基座旋转进行球面线性插值（SLERP）并计算新残差
      if (keyframe.baseResidual && startOverlay.baseQuaternion && endOverlay.baseQuaternion) {
        const startQuat = new THREE.Quaternion(
          startOverlay.baseQuaternion.x,
          startOverlay.baseQuaternion.y,
          startOverlay.baseQuaternion.z,
          startOverlay.baseQuaternion.w
        );
        const endQuat = new THREE.Quaternion(
          endOverlay.baseQuaternion.x,
          endOverlay.baseQuaternion.y,
          endOverlay.baseQuaternion.z,
          endOverlay.baseQuaternion.w
        );
        
        const interpolatedQuat = new THREE.Quaternion();
        interpolatedQuat.slerpQuaternions(startQuat, endQuat, t);
        
        const frameBaseState = manager.getBaseState(frame);
        if (frameBaseState) {
          const baseQuat = new THREE.Quaternion(
            frameBaseState.base.quaternion.x,
            frameBaseState.base.quaternion.y,
            frameBaseState.base.quaternion.z,
            frameBaseState.base.quaternion.w
          );
          
          // 计算残差四元数：interpolatedQuat = baseQuat * residualQuat
          // residualQuat = baseQuat.inverse() * interpolatedQuat
          const residualQuat = baseQuat.clone().invert().multiply(interpolatedQuat);
          
          if (!keyframe.baseResidual.quaternion) {
            keyframe.baseResidual.quaternion = { x: 0, y: 0, z: 0, w: 1 };
          }
          keyframe.baseResidual.quaternion.x = residualQuat.x;
          keyframe.baseResidual.quaternion.y = residualQuat.y;
          keyframe.baseResidual.quaternion.z = residualQuat.z;
          keyframe.baseResidual.quaternion.w = residualQuat.w;
        }
      }
    });

    // 更新显示
    const currentFrame = this.timelineController.getCurrentFrame();
    this.updateRobotState(currentFrame);
    
    // 更新曲线编辑器
    if (this.curveEditor) {
      this.curveEditor.updateCurves();
    }
    
    // 清除选择状态
    this.timelineController.clearSelection();
    
    // 触发自动保存
    this.triggerAutoSave();
    
    console.log(`已平滑 ${middleFrames.length} 个中间关键帧`);
    alert(`平滑完成！已处理 ${middleFrames.length} 个中间关键帧`);
  }

  /**
   * 计算指定帧的叠加值（原始值 + 残差）
   */
  calculateOverlayValues(frame, keyframe) {
    const manager = this.getActiveTrajectoryManager();
    const result = {
      joints: [],
      basePosition: { x: 0, y: 0, z: 0 },
      baseQuaternion: { x: 0, y: 0, z: 0, w: 1 }
    };

    // 计算关节角度叠加值
    const baseState = manager.getBaseState(frame);
    if (keyframe.residual && baseState) {
      for (let i = 0; i < keyframe.residual.length; i++) {
        const baseValue = baseState.joints[i];
        result.joints[i] = baseValue + keyframe.residual[i];
      }
    }

    // 计算基座位置叠加值
    if (!baseState) {
      return result;
    }
    
    if (keyframe.baseResidual && keyframe.baseResidual.position) {
      result.basePosition.x = baseState.base.position.x + keyframe.baseResidual.position.x;
      result.basePosition.y = baseState.base.position.y + keyframe.baseResidual.position.y;
      result.basePosition.z = baseState.base.position.z + keyframe.baseResidual.position.z;
    } else {
      result.basePosition = { ...baseState.base.position };
    }

    // 计算基座旋转叠加值
    if (keyframe.baseResidual && keyframe.baseResidual.quaternion) {
      const baseQuat = new THREE.Quaternion(
        baseState.base.quaternion.x,
        baseState.base.quaternion.y,
        baseState.base.quaternion.z,
        baseState.base.quaternion.w
      );
      const residualQuat = new THREE.Quaternion(
        keyframe.baseResidual.quaternion.x,
        keyframe.baseResidual.quaternion.y,
        keyframe.baseResidual.quaternion.z,
        keyframe.baseResidual.quaternion.w
      );
      
      const overlayQuat = baseQuat.multiply(residualQuat);
      result.baseQuaternion = {
        x: overlayQuat.x,
        y: overlayQuat.y,
        z: overlayQuat.z,
        w: overlayQuat.w
      };
    } else {
      result.baseQuaternion = { ...baseState.base.quaternion };
    }

    return result;
  }

  async showTrajectoryExportFormatDialog(
    manager = this.robotTrajectoryManager,
    options = { allowSeed: true }
  ) {
    return new Promise((resolve) => {
      const sourceFormat = manager.resolveExportFormat('source');
      const currentFPS = this.getSharedTimelineSpec()?.fps || manager.fps || 50;
      // Robot and scene CSV files have independent content but share one
      // clock. Export format must never silently change that clock (Seed used
      // to default to 120 FPS here).
      const getDefaultFPSForFormat = () => currentFPS;
      const formatOptions = [
        {
          value: TRAJECTORY_FORMATS.UNITREE,
          label: i18n.t('unitreeFormat'),
          description: i18n.t('unitreeFormatDescription')
        },
        {
          value: TRAJECTORY_FORMATS.SEED,
          label: i18n.t('seedFormat'),
          description: i18n.t('seedFormatDescription')
        }
      ].filter(format => options.allowSeed !== false || format.value !== TRAJECTORY_FORMATS.SEED);

      const dialog = document.createElement('div');
      dialog.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        z-index: 10002;
        display: flex;
        align-items: center;
        justify-content: center;
      `;

      const content = document.createElement('div');
      content.style.cssText = `
        background: var(--bg-secondary);
        border: 1px solid var(--border-primary);
        border-radius: 8px;
        padding: 24px;
        min-width: 360px;
        max-width: 460px;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
      `;

      const title = document.createElement('h3');
      title.style.cssText = `
        margin: 0 0 16px 0;
        color: var(--text-primary);
        font-size: 16px;
        font-weight: 600;
      `;
      title.textContent = i18n.t('exportFormat');

      const optionElements = [];
      const optionsContainer = document.createElement('div');

      formatOptions.forEach((format) => {
        const option = document.createElement('label');
        option.style.cssText = `
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 12px;
          padding: 14px;
          border: 2px solid var(--border-primary);
          border-radius: 6px;
          cursor: pointer;
          transition: border-color 0.2s, background-color 0.2s;
        `;

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'trajectory-export-format';
        radio.value = format.value;
        radio.checked = format.value === sourceFormat;
        radio.style.marginTop = '3px';

        const text = document.createElement('div');
        text.style.flex = '1';

        const label = document.createElement('div');
        label.style.cssText = `
          color: var(--text-primary);
          font-weight: 600;
          margin-bottom: 4px;
        `;
        label.textContent = format.value === sourceFormat
          ? `${format.label} (${i18n.t('sourceFormat')})`
          : format.label;

        const description = document.createElement('div');
        description.style.cssText = `
          color: var(--text-tertiary);
          font-size: 12px;
          line-height: 1.4;
        `;
        description.textContent = format.description;

        text.appendChild(label);
        text.appendChild(description);
        option.appendChild(radio);
        option.appendChild(text);
        optionsContainer.appendChild(option);
        optionElements.push({ option, radio });
      });

      const fpsSection = document.createElement('div');
      fpsSection.style.cssText = `
        margin-top: 4px;
        padding: 14px;
        background: var(--bg-primary);
        border: 1px solid var(--border-primary);
        border-radius: 6px;
      `;

      const fpsLabel = document.createElement('label');
      fpsLabel.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        color: var(--text-primary);
        font-size: 13px;
        font-weight: 600;
      `;
      fpsLabel.textContent = i18n.t('exportFPS');

      const fpsInput = document.createElement('input');
      fpsInput.type = 'number';
      fpsInput.min = '1';
      fpsInput.max = '240';
      fpsInput.step = '1';
      fpsInput.value = String(getDefaultFPSForFormat(sourceFormat));
      fpsInput.disabled = true;
      fpsInput.style.cssText = `
        width: 86px;
        padding: 6px 8px;
        background: var(--bg-input);
        color: var(--text-primary);
        border: 1px solid var(--border-primary);
        border-radius: 4px;
        font-size: 13px;
      `;

      const fpsHint = document.createElement('div');
      fpsHint.style.cssText = `
        margin-top: 8px;
        color: var(--text-tertiary);
        font-size: 12px;
        line-height: 1.4;
      `;

      fpsLabel.appendChild(fpsInput);
      fpsSection.appendChild(fpsLabel);
      fpsSection.appendChild(fpsHint);

      const buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = `
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 18px;
      `;

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = i18n.t('confirm');
      confirmBtn.style.cssText = `
        padding: 8px 18px;
        background: var(--accent-primary);
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      `;

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = i18n.t('cancel');
      cancelBtn.style.cssText = `
        padding: 8px 18px;
        background: var(--bg-tertiary);
        color: var(--text-primary);
        border: 1px solid var(--border-primary);
        border-radius: 4px;
        cursor: pointer;
      `;

      buttonContainer.appendChild(confirmBtn);
      buttonContainer.appendChild(cancelBtn);
      content.appendChild(title);
      content.appendChild(optionsContainer);
      content.appendChild(fpsSection);
      content.appendChild(buttonContainer);
      dialog.appendChild(content);
      document.body.appendChild(dialog);

      const getSelectedFormat = () => {
        return optionElements.find(({ radio }) => radio.checked)?.radio.value || sourceFormat;
      };

      const updateFPSHint = () => {
        const targetFPS = parseInt(fpsInput.value) || currentFPS;
        const currentFPSLabel = i18n.t('currentFPS').replace('{fps}', currentFPS);
        fpsHint.textContent = targetFPS === currentFPS
          ? currentFPSLabel
          : `${currentFPSLabel} · ${i18n.t('resampleOnExport')}`;
      };

      const updateSelectedStyle = () => {
        optionElements.forEach(({ option, radio }) => {
          option.style.borderColor = radio.checked ? 'var(--accent-primary)' : 'var(--border-primary)';
          option.style.backgroundColor = radio.checked ? 'var(--bg-tertiary)' : 'transparent';
        });
        fpsInput.value = String(getDefaultFPSForFormat(getSelectedFormat()));
        updateFPSHint();
      };

      const cleanup = () => {
        document.removeEventListener('keydown', handleKeyDown);
        if (dialog.parentNode) {
          document.body.removeChild(dialog);
        }
      };

      const finish = (value) => {
        cleanup();
        resolve(value);
      };

      const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
          finish(null);
        }
      };

      optionElements.forEach(({ option, radio }) => {
        option.addEventListener('click', () => {
          radio.checked = true;
          updateSelectedStyle();
        });
      });

      fpsInput.addEventListener('input', updateFPSHint);

      confirmBtn.addEventListener('click', () => {
        const selectedFormat = getSelectedFormat();
        finish({ format: selectedFormat, fps: currentFPS });
      });

      cancelBtn.addEventListener('click', () => finish(null));
      document.addEventListener('keydown', handleKeyDown);
      updateSelectedStyle();
    });
  }

  downloadCSV(csv, fileName) {
    const finalFileName = fileName.endsWith('.csv') ? fileName : fileName + '.csv';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = finalFileName;
    a.click();
    URL.revokeObjectURL(url);

    return finalFileName;
  }

  async exportTrajectory() {
    return this.exportTrackTrajectory('robot', false);
  }

  async exportBaseTrajectory() {
    return this.exportTrackTrajectory('robot', true);
  }

  async exportSceneTrajectory() {
    return this.exportTrackTrajectory('scene', false);
  }

  async exportSceneBaseTrajectory() {
    return this.exportTrackTrajectory('scene', true);
  }

  async exportTrackTrajectory(track, baseOnly = false) {
    await this.waitForInitialRestore();
    const manager = this.getTrajectoryManager(track);
    if (!manager.hasTrajectory()) {
      alert(i18n.t('needTrajectory'));
      return;
    }
    const timeline = this.getSharedTimelineSpec();

    const exportOptions = await this.showTrajectoryExportFormatDialog(manager, {
      allowSeed: track === 'robot'
    });
    if (!exportOptions) {
      console.log(i18n.t('userCancel'));
      return;
    }

    const csv = baseOnly
      ? manager.exportBaseTrajectory(exportOptions.format, timeline.fps)
      : manager.exportCombinedTrajectory(exportOptions.format, timeline.fps);
    const originalFileName = manager.originalFileName || `${track}_trajectory`;
    const nameWithoutExt = originalFileName.replace(/\.csv$/i, '');
    const sourceFormat = manager.resolveExportFormat('source');
    const formatSuffix = exportOptions.format === sourceFormat ? '' : `_${exportOptions.format}`;
    const defaultFileName = baseOnly
      ? `${nameWithoutExt}_base${formatSuffix}.csv`
      : manager.getExportFileName(exportOptions.format);

    const fileName = prompt(i18n.t('exportFileName'), defaultFileName);
    if (!fileName) {
      console.log(i18n.t('userCancel'));
      return;
    }

    const finalFileName = this.downloadCSV(csv, fileName);
    console.log('✅ 轨迹已导出:', finalFileName);
    this.updateStatus(
      track === 'scene'
        ? i18n.t(baseOnly ? 'sceneBaseTrajectoryExported' : 'sceneTrajectoryExported')
        : i18n.t(baseOnly ? 'baseTrajectoryExported' : 'trajectoryExported'),
      'success'
    );
  }

  async saveProject() {
    await this.waitForInitialRestore();
    if (!this.robotTrajectoryManager.hasTrajectory() && !this.sceneTrajectoryManager.hasTrajectory()) {
      alert(i18n.t('needTrajectory'));
      return;
    }

    let timeline;
    try {
      timeline = this.getSharedTimelineSpec();
    } catch (error) {
      console.error('工程时间轴校验失败:', error);
      alert(error.message);
      return;
    }

    const projectData = {
      version: '3.1',
      timeline,
      robotTrajectory: this.robotTrajectoryManager.hasTrajectory()
        ? this.robotTrajectoryManager.getProjectData()
        : null,
      sceneTrajectory: this.sceneTrajectoryManager.hasTrajectory()
        ? this.sceneTrajectoryManager.getProjectData()
        : null,
      activeTrack: this.activeTrack,
      workspaceMode: this.workspaceMode
    };
    const json = JSON.stringify(projectData, null, 2);

    const originalFileName = this.robotTrajectoryManager.originalFileName ||
      this.sceneTrajectoryManager.originalFileName || 'project';
    const defaultFileName = originalFileName.replace(/\.csv$/i, '') + '_project.json';
    
    // 让用户确认或修改文件名
    const fileName = prompt(i18n.t('saveProjectFileName'), defaultFileName);
    if (!fileName) {
      console.log(i18n.t('userCancel'));
      return;
    }
    
    // 确保文件名以.json结尾
    const finalFileName = fileName.endsWith('.json') ? fileName : fileName + '.json';
    
    // 创建下载
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = finalFileName;
    a.click();
    URL.revokeObjectURL(url);
    
    console.log('✅', i18n.t('projectSaved') + ':', finalFileName);
    this.updateStatus(i18n.t('projectSaved'), 'success');
  }

  async loadProject(event) {
    const file = event.target.files[0];
    if (!file) return;
    await this.waitForInitialRestore();

    try {
      const text = await file.text();
      const projectData = JSON.parse(text);

      // 先在临时 manager 中完成两条轨迹的全部解析与校验；只有全部成功才提交，
      // 避免坏场景数据把用户当前机器人工程清空一半。
      const nextRobotManager = new TrajectoryManager();
      const nextSceneManager = new TrajectoryManager();
      const isDualTrackProject = Object.prototype.hasOwnProperty.call(projectData, 'robotTrajectory') ||
        Object.prototype.hasOwnProperty.call(projectData, 'sceneTrajectory');

      if (isDualTrackProject) {
        if (projectData.robotTrajectory) {
          nextRobotManager.loadProjectData(projectData.robotTrajectory);
        }
        if (projectData.sceneTrajectory) {
          nextSceneManager.loadProjectData(projectData.sceneTrajectory);
        }
      } else {
        // v1-v2 工程只有一条机器人轨迹。
        nextRobotManager.loadProjectData(projectData);
      }

      if (String(projectData.version) === '3.1' &&
          (!Object.prototype.hasOwnProperty.call(projectData, 'timeline') ||
           projectData.timeline === null)) {
        throw new Error('v3.1 工程缺少共享时间轴');
      }

      let timeline = assertSharedTimelineInvariant(
        [nextRobotManager, nextSceneManager],
        projectData.timeline ?? null
      );
      if (!nextRobotManager.hasTrajectory() && !nextSceneManager.hasTrajectory()) {
        throw new Error(i18n.t('emptyTrajectory'));
      }

      if (nextRobotManager.hasTrajectory() && this.jointController &&
          nextRobotManager.jointCount !== this.jointController.joints.length) {
        throw new Error(i18n.t('trajectoryJointCountMismatch', {
          expected: this.jointController.joints.length,
          actual: nextRobotManager.jointCount
        }));
      }
      if (nextSceneManager.hasTrajectory() && this.sceneJointController &&
          nextSceneManager.jointCount !== this.sceneJointController.joints.length) {
        throw new Error(i18n.t('trajectoryJointCountMismatch', {
          expected: this.sceneJointController.joints.length,
          actual: nextSceneManager.jointCount
        }));
      }

      // Legacy robot-only projects remain valid. If the corresponding other
      // model is already loaded, materialize its zero track on the same clock.
      if (!nextRobotManager.hasTrajectory() && this.jointController) {
        nextRobotManager.createZeroTrajectory(
          timeline.frameCount,
          this.jointController.joints.length,
          timeline.fps,
          'robot_zero.csv'
        );
      }
      if (!nextSceneManager.hasTrajectory() && this.sceneJointController) {
        nextSceneManager.createZeroTrajectory(
          timeline.frameCount,
          this.sceneJointController.joints.length,
          timeline.fps,
          'scene_zero.csv'
        );
      }
      timeline = assertSharedTimelineInvariant(
        [nextRobotManager, nextSceneManager],
        timeline
      );

      this.robotTrajectoryManager = nextRobotManager;
      this.sceneTrajectoryManager = nextSceneManager;
      this.trajectoryManager = this.robotTrajectoryManager;

      const requestedTrack = projectData.activeTrack === 'scene' ? 'scene' : 'robot';
      const requestedManager = this.getTrajectoryManager(requestedTrack);
      const fallbackTrack = requestedTrack === 'scene' ? 'robot' : 'scene';
      const preferredTrack = requestedManager.hasTrajectory()
        ? requestedTrack
        : (this.getTrajectoryManager(fallbackTrack).hasTrajectory() ? fallbackTrack : requestedTrack);
      this.setWorkspaceMode(projectData.workspaceMode === 'create' ? 'create' : 'compare');
      this.setActiveTrack(preferredTrack, { resetTimeline: false });
      this.refreshTimelineForActiveTrack(0);
      this.curveEditor?.resetForActiveTrack();
      this.updateRobotState(0);

      const missingModels = [];
      if (this.robotTrajectoryManager.hasTrajectory() && !this.jointController) missingModels.push(i18n.t('robot'));
      if (this.sceneTrajectoryManager.hasTrajectory() && !this.sceneJointController) missingModels.push(i18n.t('scene'));
      if (missingModels.length > 0) {
        alert(i18n.t('projectNeedsModels', { models: missingModels.join(', ') }));
      }

      console.log('✅ 工程文件已加载:', file.name);
      this.currentProjectFile = file.name;
      this.updateStatus(i18n.t('projectLoaded'), 'success');
      
      // 更新文件名显示
      this.updateCurrentFileName(file.name, 'project');
    } catch (error) {
      console.error('❌ 加载工程文件失败:', error);
      alert('加载工程文件失败: ' + error.message);
      this.updateStatus(i18n.t('loadProjectFailed'), 'error');
    }
    
    // 清除文件输入，允许重新选择同一文件
    event.target.value = '';
  }

  toggleCameraMode() {
    if (this.cameraMode === 'rotate') {
      this.cameraMode = 'pan';
      this.controls.enableRotate = false;
      this.controls.enablePan = true;
      // 设置鼠标左键为平移
      this.controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      };
      document.getElementById('toggle-camera-mode').textContent = i18n.t('pan');
      console.log('📷 相机模式: 平移');
    } else {
      this.cameraMode = 'rotate';
      this.controls.enableRotate = true;
      this.controls.enablePan = false;
      // 恢复默认：鼠标左键为旋转
      this.controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      };
      document.getElementById('toggle-camera-mode').textContent = i18n.t('rotate');
      console.log('📷 相机模式: 旋转');
    }
  }

  resetCamera() {
    this.cameraLeft.position.copy(this.defaultCameraPosition);
    this.cameraRight.position.copy(this.defaultCameraPosition);
    this.cameraLeft.zoom = 1;
    this.cameraRight.zoom = 1;
    this.cameraLeft.updateProjectionMatrix();
    this.cameraRight.updateProjectionMatrix();
    this.controls.target.copy(this.defaultCameraTarget);
    this.controls.update();
    console.log('📷 相机视角已重置');
  }

  toggleFollowRobot() {
    this.followRobot = !this.followRobot;
    const button = document.getElementById('follow-robot');
    if (this.followRobot) {
      // 如果开启跟随，且当前是平移模式，自动切换到旋转模式
      if (this.cameraMode === 'pan') {
        this.toggleCameraMode();
        console.log('📷 跟随模式下自动切换到旋转模式');
      }
      
      button.textContent = i18n.t('followOn');
      button.style.background = 'rgba(78, 201, 176, 0.3)';
      button.style.borderColor = 'rgba(78, 201, 176, 0.6)';
      console.log('🤖 开始跟随机器人');
      
      // 立即更新相机位置
      if (this.robotRight) {
        const robotPos = this.robotRight.position;
        this.controls.target.set(robotPos.x, robotPos.y, robotPos.z + 0.5);
        this.controls.update();
      }
    } else {
      button.textContent = i18n.t('followOff');
      button.style.background = 'var(--overlay-bg)';
      button.style.borderColor = 'var(--border-primary)';
      console.log('🤖 停止跟随机器人');
    }
  }

  toggleCOM() {
    this.showCOM = !this.showCOM;
    const button = document.getElementById('toggle-com');
    
    if (this.showCOM) {
      button.textContent = i18n.t('comOn');
      button.style.background = 'rgba(255, 100, 100, 0.3)';
      button.style.borderColor = 'rgba(255, 100, 100, 0.6)';
      
      // 立即更新COM显示
      if (this.comVisualizerLeft && this.robotLeft) {
        this.comVisualizerLeft.update(this.robotLeft);
      }
      if (this.comVisualizerRight && this.robotRight) {
        this.comVisualizerRight.update(this.robotRight);
      }
      
      console.log('🎯 显示重心');
    } else {
      button.textContent = i18n.t('comOff');
      button.style.background = 'var(--overlay-bg)';
      button.style.borderColor = 'var(--border-primary)';
      
      if (this.comVisualizerLeft) {
        this.comVisualizerLeft.hide();
      }
      if (this.comVisualizerRight) {
        this.comVisualizerRight.hide();
      }
      
      console.log('🎯 隐藏重心');
    }
  }

  toggleAutoRefreshFootprint() {
    this.autoRefreshFootprint = !this.autoRefreshFootprint;
    const button = document.getElementById('toggle-auto-refresh');
    
    if (this.autoRefreshFootprint) {
      button.textContent = i18n.t('autoRefreshOn');
      button.style.background = 'rgba(0, 200, 0, 0.3)';
      button.style.borderColor = 'rgba(0, 200, 0, 0.6)';
      console.log('⏱️ 开启包络线自动刷新（2秒防抖）');
      // 立即触发一次更新
      this.scheduleFootprintUpdate();
    } else {
      button.textContent = i18n.t('autoRefreshOff');
      button.style.background = 'var(--overlay-bg)';
      button.style.borderColor = 'var(--border-primary)';
      // 取消待执行的定时器
      if (this.footprintUpdateTimer) {
        clearTimeout(this.footprintUpdateTimer);
        this.footprintUpdateTimer = null;
      }
      console.log('⏱️ 关闭包络线自动刷新');
    }
  }

  scheduleFootprintUpdate() {
    // 只有开启自动刷新时才执行
    if (!this.autoRefreshFootprint) {
      return;
    }
    
    // 取消之前的定时器
    if (this.footprintUpdateTimer) {
      clearTimeout(this.footprintUpdateTimer);
    }
    
    // 设置2秒后更新包络线
    this.footprintUpdateTimer = setTimeout(() => {
      if (this.showCOM) {
        console.log('⏱️ 机器人状态稳定2秒，开始异步计算包络线...');
        this.refreshFootprint();
      }
    }, 2000);
  }

  getFootprintHeightThresholdMeters() {
    const input = document.getElementById('footprint-height-threshold');
    if (!input) {
      return this.footprintHeightThresholdCm / 100;
    }
    const rawValue = parseFloat(input.value);
    if (Number.isFinite(rawValue)) {
      this.footprintHeightThresholdCm = Math.max(0, rawValue);
    }
    return this.footprintHeightThresholdCm / 100;
  }

  refreshFootprint() {
    if (!this.robotLeft && !this.robotRight) {
      alert(i18n.t('needRobot'));
      return;
    }
    
    console.log('👣 刷新地面投影包络线...');
    
    // 使用setTimeout实现异步计算，避免阻塞UI
    const heightThresholdMeters = this.getFootprintHeightThresholdMeters();
    setTimeout(() => {
      if (this.comVisualizerLeft && this.robotLeft) {
        this.comVisualizerLeft.updateFootprint(this.robotLeft, heightThresholdMeters);
      }
      if (this.comVisualizerRight && this.robotRight) {
        this.comVisualizerRight.updateFootprint(this.robotRight, heightThresholdMeters);
      }
      console.log('✅ 地面投影包络线刷新完成');
    }, 0);
  }

  /**
   * 自动旋转功能：绕包络线主轴或次轴旋转，使重心投影靠近包络线
   * @param {string} axisType - 'major' 或 'minor'
   */
  autoRotateToFootprint(axisType) {
    if (!this.trajectoryManager.hasTrajectory()) {
      alert('请先加载 CSV 轨迹');
      return;
    }

    if (!this.robotLeft && !this.robotRight) {
      alert(i18n.t('needRobot'));
      return;
    }

    // 获取旋转角度上限
    const clampInputId = axisType === 'major' ? 'rotation-clamp-major' : 'rotation-clamp-minor';
    const clampInput = document.getElementById(clampInputId);
    const clampValue = clampInput ? parseFloat(clampInput.value) : 0.02;
    if (!Number.isFinite(clampValue) || clampValue <= 0) {
      alert('请输入有效的旋转角度上限（弧度，大于0）');
      return;
    }

    const currentFrame = this.timelineController.getCurrentFrame();

    // 处理左右两侧机器人
    let hasRotation = false;

    if (this.robotLeft && this.comVisualizerLeft) {
      const result = this.calculateAutoRotation(
        this.robotLeft, 
        this.comVisualizerLeft, 
        axisType, 
        clampValue
      );
      
      if (result) {
        this.applyRotationResidual(currentFrame, result);
        hasRotation = true;
        console.log(`🔄 左侧机器人自动旋转 (${axisType}): ${(result.angle * 180 / Math.PI).toFixed(2)}°`);
      }
    }

    if (this.robotRight && this.comVisualizerRight) {
      const result = this.calculateAutoRotation(
        this.robotRight,
        this.comVisualizerRight,
        axisType,
        clampValue
      );
      
      if (result) {
        this.applyRotationResidual(currentFrame, result);
        hasRotation = true;
        console.log(`🔄 右侧机器人自动旋转 (${axisType}): ${(result.angle * 180 / Math.PI).toFixed(2)}°`);
      }
    }

    if (hasRotation) {
      // 更新显示
      this.updateRobotState(currentFrame);
      
      // 更新曲线编辑器
      if (this.curveEditor) {
        this.curveEditor.updateCurves();
      }

      // 触发自动保存
      this.triggerAutoSave();
      
      const axisName = axisType === 'major' ? '主轴' : '次轴';
      this.updateStatus(`✅ 自动旋转完成！绕${axisName}旋转`, 'success');
    } else {
      this.updateStatus('⚠️ 无法执行自动旋转，请先刷新包络线', 'error');
    }
  }

  /**
   * 计算自动旋转参数
   */
  calculateAutoRotation(robot, comVisualizer, axisType, clampValue) {
    const data = comVisualizer.getFootprintData();
    
    if (!data.footprint || !data.centroid || !data.pca || !data.com) {
      return null;
    }

    // 重心投影到地面的位置
    const comProjection = { x: data.com.x, y: data.com.y };

    // 选择旋转轴
    const axisIndex = axisType === 'major' ? 0 : 1;
    const rotationAxis = data.pca.eigenvectors[axisIndex];

    // 计算旋转轴在3D空间中的向量（垂直于地面）
    const axis3D = new THREE.Vector3(rotationAxis.x, rotationAxis.y, 0).normalize();

    // 计算重心投影点到旋转轴的距离
    // 旋转轴是通过质心、方向为rotationAxis的直线
    // 点到直线的距离公式：|AP × v| / |v|，其中A是直线上一点，P是目标点，v是方向向量
    const AP = {
      x: comProjection.x - data.centroid.x,
      y: comProjection.y - data.centroid.y
    };
    
    // 2D叉积：AP × rotationAxis
    const crossProduct = AP.x * rotationAxis.y - AP.y * rotationAxis.x;
    const distToAxis = Math.abs(crossProduct); // rotationAxis已归一化
    
    if (distToAxis < 0.001) {
      console.log('重心投影已经在旋转轴上或非常接近');
      return null;
    }

    // 计算重心高度
    const comHeight = data.com.z;
    
    if (Math.abs(comHeight) < 0.001) {
      console.log('重心高度过小，无法计算旋转');
      return null;
    }

    // 计算让重心投影准确落在旋转轴上所需的旋转角度
    // 使用几何关系：tan(angle) = distToAxis / comHeight
    const exactAngle = Math.atan2(distToAxis, comHeight);
    
    // 确定旋转方向：试探两个方向，选择让距离减小的那个
    // 创建一个小的测试旋转
    const testAngle = 0.01; // 1度左右的测试旋转
    
    // 测试正向旋转后重心的投影位置
    const testRotationQuat = new THREE.Quaternion();
    testRotationQuat.setFromAxisAngle(axis3D, testAngle);
    
    // 计算旋转后重心相对于质心的位置
    const comRelative = new THREE.Vector3(
      data.com.x - data.centroid.x,
      data.com.y - data.centroid.y,
      data.com.z
    );
    
    const rotatedCom = comRelative.clone().applyQuaternion(testRotationQuat);
    const rotatedComProjection = {
      x: rotatedCom.x,
      y: rotatedCom.y
    };
    
    // 计算旋转后到轴的距离
    const crossProductAfter = rotatedComProjection.x * rotationAxis.y - rotatedComProjection.y * rotationAxis.x;
    const distToAxisAfter = Math.abs(crossProductAfter);
    
    // 判断方向：如果距离减小了，说明正向是对的；否则反向
    const rotationSign = distToAxisAfter < distToAxis ? 1 : -1;
    
    // 应用旋转方向
    const signedExactAngle = rotationSign * exactAngle;
    
    // 与clamp值比较，取较小值
    const angle = Math.abs(signedExactAngle) <= clampValue 
      ? signedExactAngle 
      : rotationSign * clampValue;

    console.log(`🔄 旋转角度计算: 精确=${(signedExactAngle * 180 / Math.PI).toFixed(2)}°, 实际=${(angle * 180 / Math.PI).toFixed(2)}°, 距离轴=${(distToAxis * 100).toFixed(1)}cm`);

    if (Math.abs(angle) < 0.001) {
      console.log('计算的旋转角度过小，跳过');
      return null;
    }

    return {
      axis: axis3D,
      angle: angle,
      centroid: data.centroid
    };
  }

  /**
   * 查找点到多边形最近的点
   */
  findClosestPointOnPolygon(point, polygon) {
    let closestPoint = null;
    let minDist = Infinity;

    for (let i = 0; i < polygon.length; i++) {
      const j = (i + 1) % polygon.length;
      const p1 = polygon[i];
      const p2 = polygon[j];

      // 计算点到线段的最近点
      const closest = this.closestPointOnSegment(point, p1, p2);
      const dist = Math.sqrt(
        (closest.x - point.x) ** 2 + (closest.y - point.y) ** 2
      );

      if (dist < minDist) {
        minDist = dist;
        closestPoint = closest;
      }
    }

    return closestPoint;
  }

  /**
   * 计算点到线段的最近点
   */
  closestPointOnSegment(point, segStart, segEnd) {
    const dx = segEnd.x - segStart.x;
    const dy = segEnd.y - segStart.y;
    const lenSq = dx * dx + dy * dy;

    if (lenSq < 1e-10) {
      return { x: segStart.x, y: segStart.y };
    }

    const t = Math.max(0, Math.min(1, 
      ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / lenSq
    ));

    return {
      x: segStart.x + t * dx,
      y: segStart.y + t * dy
    };
  }

  /**
   * 应用旋转到base并生成残差
   */
  applyRotationResidual(frameIndex, rotationResult) {
    const { axis, angle, centroid } = rotationResult;

    // 获取当前帧的基座状态
    const baseState = this.trajectoryManager.getBaseState(frameIndex);
    if (!baseState) {
      return;
    }

    // 创建旋转四元数
    const rotationQuat = new THREE.Quaternion();
    rotationQuat.setFromAxisAngle(axis, angle);

    // 获取原始基座姿态
    const originalQuat = new THREE.Quaternion(
      baseState.base.quaternion.x,
      baseState.base.quaternion.y,
      baseState.base.quaternion.z,
      baseState.base.quaternion.w
    );

    // 应用旋转：新四元数 = 旋转 * 原始
    const newQuat = rotationQuat.clone().multiply(originalQuat);

    // 计算基座位置的变化（绕质心旋转）
    const originalPos = new THREE.Vector3(
      baseState.base.position.x,
      baseState.base.position.y,
      baseState.base.position.z
    );
    
    const centroid3D = new THREE.Vector3(centroid.x, centroid.y, 0);
    
    // 位置相对于质心的偏移
    const offset = originalPos.clone().sub(centroid3D);
    
    // 旋转偏移向量
    offset.applyQuaternion(rotationQuat);
    
    // 新位置
    const newPos = centroid3D.clone().add(offset);

    // 计算残差
    const positionResidual = {
      x: newPos.x - baseState.base.position.x,
      y: newPos.y - baseState.base.position.y,
      z: newPos.z - baseState.base.position.z
    };

    // 计算旋转残差：residualQuat = originalQuat.inverse() * newQuat
    const quaternionResidual = originalQuat.clone().invert().multiply(newQuat);

    // 确保或创建该帧的关键帧
    if (!this.trajectoryManager.keyframes.has(frameIndex)) {
      // 创建新关键帧
      const jointCount = this.trajectoryManager.jointCount;
      this.trajectoryManager.keyframes.set(frameIndex, {
        residual: new Array(jointCount).fill(0),
        baseResidual: {
          position: { x: 0, y: 0, z: 0 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 }
        }
      });
    }

    const keyframe = this.trajectoryManager.keyframes.get(frameIndex);

    // 叠加残差（累加位置，组合四元数）
    if (!keyframe.baseResidual) {
      keyframe.baseResidual = {
        position: { x: 0, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 }
      };
    }

    // 位置残差累加
    keyframe.baseResidual.position.x += positionResidual.x;
    keyframe.baseResidual.position.y += positionResidual.y;
    keyframe.baseResidual.position.z += positionResidual.z;

    // 四元数残差组合：newResidual = quaternionResidual * oldResidual
    const oldResidualQuat = new THREE.Quaternion(
      keyframe.baseResidual.quaternion.x,
      keyframe.baseResidual.quaternion.y,
      keyframe.baseResidual.quaternion.z,
      keyframe.baseResidual.quaternion.w
    );
    
    const combinedResidualQuat = quaternionResidual.multiply(oldResidualQuat);
    
    keyframe.baseResidual.quaternion.x = combinedResidualQuat.x;
    keyframe.baseResidual.quaternion.y = combinedResidualQuat.y;
    keyframe.baseResidual.quaternion.z = combinedResidualQuat.z;
    keyframe.baseResidual.quaternion.w = combinedResidualQuat.w;

    // 更新关键帧标记
    const keyframes = Array.from(this.trajectoryManager.keyframes.keys());
    this.timelineController.updateKeyframeMarkers(keyframes);
  }
  
  /**
   * 恢复保存的状态（如果可用）
   */
  async restoreStateIfAvailable() {
    if (!this.cookieManager.isAutoSaveEnabled()) {
      console.log('📕 自动保存未启用，跳过状态恢复');
      return;
    }
    
    const stateInfo = await this.cookieManager.getStateInfo();
    if (!stateInfo) {
      console.log('📕 没有找到已保存的状态');
      return;
    }
    
    console.log('🔍 检测到已保存的状态:', stateInfo);
    
    try {
      const restored = await this.cookieManager.restoreState(this);
      if (restored) {
        this.updateStatus(i18n.t('stateRestored'), 'success');
        console.log('✅ 状态恢复成功');
      } else {
        console.log('⚠️ 状态恢复失败');
      }
    } catch (e) {
      console.error('❌ 恢复状态异常:', e);
    }
  }
  
  /**
   * 重置应用到初始状态
   */
  async resetApplication() {
    if (!confirm(i18n.t('resetConfirm'))) {
      return;
    }
    await this.waitForInitialRestore();
    
    console.log('🔄 重置应用...');
    // 使尚未完成的 URDF 请求失效，防止重置后又被旧请求写回。
    this.robotLoadGeneration += 1;
    this.sceneLoadGeneration += 1;

    // 清除轨迹管理器
    this.robotTrajectoryManager.clearAll();
    this.sceneTrajectoryManager.clearAll();

    if (this.footprintUpdateTimer) {
      clearTimeout(this.footprintUpdateTimer);
      this.footprintUpdateTimer = null;
    }
    this.comVisualizerLeft?.hide();
    this.comVisualizerRight?.hide();

    // 移除机器人模型并释放 WebGL 资源
    const removedModels = [
      this.robotLeft,
      this.robotRight,
      this.sceneModelLeft,
      this.sceneModelRight
    ];
    if (this.robotLeft) {
      this.sceneLeft.remove(this.robotLeft);
      this.robotLeft = null;
    }
    if (this.robotRight) {
      this.sceneRight.remove(this.robotRight);
      this.robotRight = null;
      this.robot = null;
    }
    if (this.sceneModelLeft) {
      this.sceneLeft.remove(this.sceneModelLeft);
      this.sceneModelLeft = null;
    }
    if (this.sceneModelRight) {
      this.sceneRight.remove(this.sceneModelRight);
      this.sceneModelRight = null;
    }
    this.disposeObject3DResources(...removedModels);
    
    // 清除控制器
    if (this.jointController) {
      const container = document.getElementById('joint-controls');
      if (container) {
        container.innerHTML = '';
      }
      this.jointController = null;
    }
    if (this.sceneJointController) {
      const sceneContainer = document.getElementById('scene-joint-controls');
      if (sceneContainer) sceneContainer.innerHTML = '';
      this.sceneJointController = null;
    }
    
    if (this.baseController) {
      const baseContainer = document.getElementById('base-controls');
      if (baseContainer) baseContainer.innerHTML = '';
      this.baseController = null;
    }
    
    // 重置时间轴
    if (this.timelineController) {
      this.timelineController.pause();
      this.timelineController.clearSelectedKeyframes?.();
      this.timelineController.updateTimeline(0, 0);
      this.timelineController.updateKeyframeMarkers([]);
      this.timelineController.setCurrentFrame(0);
    }
    
    // 重置曲线编辑器
    if (this.curveEditor) {
      this.curveEditor.curves.clear();
      this.curveEditor.draw();
    }
    
    // 重置相机
    this.resetCamera();
    
    // 重置 UI 状态
    this.cameraMode = 'rotate';
    this.followRobot = false;
    this.showCOM = true;
    this.autoRefreshFootprint = false;
    this.footprintHeightThresholdCm = 10;
    this.currentURDFFolder = '';
    this.currentURDFFile = '';
    this.currentSceneURDFFolder = '';
    this.currentSceneURDFFile = '';
    this.currentProjectFile = '';
    this.identifiedFeet = [];

    // 清掉 loader 中的模型和文件引用，确保重置后的自动保存不会复活旧资源。
    [this.urdfLoader, this.sceneURDFLoader].forEach(loader => {
      loader.robot = null;
      loader.joints = [];
      loader.fileMap.clear();
    });

    this.controls.enableRotate = true;
    this.controls.enablePan = false;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };

    const createFrameInput = document.getElementById('create-frame-count');
    const createFPSInput = document.getElementById('create-fps');
    const interpolationToggle = document.getElementById('interpolation-mode-toggle');
    if (createFrameInput) createFrameInput.value = '100';
    if (createFPSInput) createFPSInput.value = '50';
    if (interpolationToggle) interpolationToggle.checked = false;
    this.setWorkspaceMode('compare');
    this.setActiveTrack('robot', { resetTimeline: false });
    
    // 更新按钮状态
    document.getElementById('toggle-camera-mode').textContent = i18n.t('rotate');
    document.getElementById('follow-robot').textContent = i18n.t('followOff');
    document.getElementById('follow-robot').style.background = 'var(--overlay-bg)';
    document.getElementById('follow-robot').style.borderColor = 'var(--border-primary)';
    document.getElementById('toggle-com').textContent = i18n.t('comOn');
    document.getElementById('toggle-com').style.background = 'rgba(255, 100, 100, 0.3)';
    document.getElementById('toggle-com').style.borderColor = 'rgba(255, 100, 100, 0.6)';
    document.getElementById('toggle-auto-refresh').textContent = i18n.t('autoRefreshOff');
    document.getElementById('toggle-auto-refresh').style.background = 'var(--overlay-bg)';
    document.getElementById('toggle-auto-refresh').style.borderColor = 'var(--border-primary)';
    
    // 清除文件名显示
    this.clearCurrentFileName();
    
    // 清除 Cookie（如果启用了自动保存）
    if (this.cookieManager.isAutoSaveEnabled()) {
      await this.cookieManager.clearState();
    }
    
    // 更新状态显示
    this.updateStatus(i18n.t('ready'), 'info');
    
    console.log('✅ 应用已重置');
  }
  
  /**
   * 切换自动保存
   */
  async toggleAutoSave(enabled) {
    await this.waitForInitialRestore();
    await this.cookieManager.setAutoSaveEnabled(enabled);
    
    const notice = document.getElementById('cookie-notice');
    if (notice) {
      notice.style.display = enabled ? 'block' : 'none';
    }
    
    if (enabled) {
      console.log('💾 自动保存已启用');
      this.updateStatus(i18n.t('autoSaveEnabled'), 'success');
      // 立即执行一次完整保存（包含 URDF）
      await this.cookieManager.saveState(this, true);
    } else {
      console.log('💾 自动保存已禁用');
      this.updateStatus(i18n.t('autoSaveDisabled'), 'info');
    }
  }
  
  /**
   * 清除已保存的 Cookies
   */
  async clearCookies() {
    if (!confirm(i18n.t('clearCookiesConfirm'))) {
      return;
    }
    await this.waitForInitialRestore();

    await this.cookieManager.clearState();
    this.updateStatus(i18n.t('cookiesCleared'), 'success');
    console.log('🗑️ 已清除 Cookies');
  }
  
  /**
   * 触发自动保存（防抖）
   * @param {boolean} fullSave - 是否完整保存（包括 URDF）
   */
  triggerAutoSave(fullSave = false) {
    if (this.cookieManager.isAutoSaveEnabled()) {
      this.cookieManager.saveStateDebounced(this, fullSave);
    }
  }

  /**
   * 更新主题图标
   */
  updateThemeIcon(theme) {
    const themeIcon = document.getElementById('theme-icon');
    if (themeIcon) {
      themeIcon.textContent = theme === 'dark' ? '🌙' : '☀️';
    }
  }

  /**
   * 根据主题更新场景背景颜色
   */
  updateSceneBackgrounds(theme) {
    if (theme === 'light') {
      // 浅色模式背景
      if (this.sceneLeft) {
        this.sceneLeft.background = new THREE.Color(0xf0f0f0);
      }
      if (this.sceneRight) {
        this.sceneRight.background = new THREE.Color(0xe8e8e8);
      }
    } else {
      // 深色模式背景
      if (this.sceneLeft) {
        this.sceneLeft.background = new THREE.Color(0x1a1a1a);
      }
      if (this.sceneRight) {
        this.sceneRight.background = new THREE.Color(0x263238);
      }
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    
    this.controls.update();
    
    // 跟随机器人平移
    if (this.followRobot && this.robotRight) {
      const robotPos = this.robotRight.position;
      this.controls.target.set(robotPos.x, robotPos.y, robotPos.z + 0.5);
    }
    
    // 获取整个viewport的尺寸
    const viewport = document.getElementById('viewport');
    const fullWidth = viewport.clientWidth;
    const fullHeight = viewport.clientHeight;
    const halfWidth = fullWidth / 2;
    
    // 清除整个画布
    this.renderer.clear();
    
    if (this.workspaceMode === 'create') {
      // 创建模式仅显示编辑结果，避免无意义的左右对比。
      this.renderer.setViewport(0, 0, fullWidth, fullHeight);
      this.renderer.setScissor(0, 0, fullWidth, fullHeight);
      this.renderer.setScissorTest(true);
      this.renderer.render(this.sceneRight, this.cameraRight);
    } else {
      // 对比模式：左侧原始轨迹，右侧编辑结果。
      this.renderer.setViewport(0, 0, halfWidth, fullHeight);
      this.renderer.setScissor(0, 0, halfWidth, fullHeight);
      this.renderer.setScissorTest(true);
      this.renderer.render(this.sceneLeft, this.cameraLeft);

      this.renderer.setViewport(halfWidth, 0, halfWidth, fullHeight);
      this.renderer.setScissor(halfWidth, 0, halfWidth, fullHeight);
      this.renderer.setScissorTest(true);
      this.renderer.render(this.sceneRight, this.cameraRight);
    }
    
    // 渲染坐标轴指示器
    if (this.axisGizmo) {
      this.axisGizmo.update();
      this.axisGizmo.render(this.renderer);
    }
  }
}

// 启动应用
new RobotKeyframeEditor();

// 初始化构建信息弹窗
function initBuildInfoModal() {
  const securityInfo = document.getElementById('security-info');
  const modal = document.getElementById('build-info-modal');
  const closeBtn = document.getElementById('close-modal');
  
  if (!securityInfo || !modal) return;
  
  // 获取构建信息
  const commitShort = typeof __GIT_COMMIT_SHORT__ !== 'undefined' ? __GIT_COMMIT_SHORT__ : 'dev';
  const commitHash = typeof __GIT_COMMIT_HASH__ !== 'undefined' ? __GIT_COMMIT_HASH__ : 'unknown';
  const commitDate = typeof __GIT_COMMIT_DATE__ !== 'undefined' ? __GIT_COMMIT_DATE__ : '未知';
  const branch = typeof __GIT_BRANCH__ !== 'undefined' ? __GIT_BRANCH__ : 'unknown';
  const tag = typeof __GIT_TAG__ !== 'undefined' ? __GIT_TAG__ : '';
  const buildTimeEnv = typeof __HOSTING_ENV__ !== 'undefined' ? __HOSTING_ENV__ : '';
  
  // 运行时检测托管环境
  function getRuntimeHostingEnv() {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    
    // 检测是否为本地环境
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '' || hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
      return 'localDeployment';
    }
    
    // 检测已知的托管服务（包括自定义域名）
    if (hostname.includes('pages.dev') || hostname.includes('cloudflare')) {
      return 'cloudflarePages';
    } else if (hostname.includes('vercel.app')) {
      return 'vercelEnv';
    } else if (hostname.includes('netlify.app')) {
      return 'netlifyEnv';
    } else if (hostname.includes('github.io')) {
      return 'githubPages';
    }
    
    // 其他情况
    return null; // 返回null表示运行时无法判断
  }
  
  const runtimeEnv = getRuntimeHostingEnv();
  // 优先级：运行时明确识别 > 构建时环境变量 > 其他
  let finalEnvKey;
  if (runtimeEnv === 'localDeployment') {
    finalEnvKey = 'localDeployment';
  } else if (runtimeEnv) {
    // 运行时明确识别出的托管服务
    finalEnvKey = runtimeEnv;
  } else if (buildTimeEnv) {
    // 使用构建时的环境变量（适用于自定义域名）
    finalEnvKey = buildTimeEnv;
  } else {
    // 都无法识别
    finalEnvKey = 'otherEnv';
  }
  
  const finalEnv = i18n.t(finalEnvKey);
  
  // 填充modal内容
  document.getElementById('hosting-info').textContent = finalEnv;
  
  // 显示commit id前8位，但保存完整hash
  const versionShortEl = document.getElementById('build-version-short');
  const versionFullEl = document.getElementById('build-version-full');
  if (versionShortEl && versionFullEl) {
    versionShortEl.textContent = commitShort;
    versionFullEl.textContent = commitHash;
  }
  
  document.getElementById('build-date').textContent = commitDate;
  document.getElementById('build-branch').textContent = branch;
  
  if (tag) {
    document.getElementById('build-tag-container').style.display = 'block';
    document.getElementById('build-tag').textContent = tag;
  }
  
  // 如果是"其他"环境或本地部署，显示详细信息
  if (finalEnvKey === 'otherEnv' || finalEnvKey === 'localDeployment') {
    const deployDetails = document.getElementById('deploy-details');
    if (deployDetails) {
      deployDetails.style.display = 'block';
      const hostnameEl = document.getElementById('hostname');
      const protocolEl = document.getElementById('protocol');
      const userAgentEl = document.getElementById('user-agent');
      
      if (hostnameEl) hostnameEl.textContent = window.location.hostname || 'N/A';
      if (protocolEl) protocolEl.textContent = window.location.protocol || 'N/A';
      if (userAgentEl) userAgentEl.textContent = navigator.userAgent || 'N/A';
    }
  }
  
  // 复制托管信息
  const copyHostingBtn = document.getElementById('copy-hosting');
  if (copyHostingBtn) {
    copyHostingBtn.addEventListener('mouseenter', () => {
      copyHostingBtn.style.background = 'rgba(255, 255, 255, 0.1)';
      copyHostingBtn.style.color = '#cccccc';
    });
    copyHostingBtn.addEventListener('mouseleave', () => {
      copyHostingBtn.style.background = 'none';
      copyHostingBtn.style.color = '#858585';
    });
    
    copyHostingBtn.addEventListener('click', () => {
      const hostnameEl = document.getElementById('hostname');
      const protocolEl = document.getElementById('protocol');
      const userAgentEl = document.getElementById('user-agent');
      
      let text = `${i18n.t('hostingInfoLabel')}: ${finalEnv}`;
      if (hostnameEl && hostnameEl.textContent) {
        text += `\n${i18n.t('domainLabel')}: ${hostnameEl.textContent}`;
      }
      if (protocolEl && protocolEl.textContent) {
        text += `\n${i18n.t('protocolLabel')}: ${protocolEl.textContent}`;
      }
      if (userAgentEl && userAgentEl.textContent) {
        text += `\n${i18n.t('userAgentLabel')}: ${userAgentEl.textContent}`;
      }
      
      navigator.clipboard.writeText(text).then(() => {
        copyHostingBtn.textContent = '✓';
        setTimeout(() => {
          copyHostingBtn.textContent = '📋';
        }, 1500);
      });
    });
  }
  
  // 复制构建信息
  const copyBuildBtn = document.getElementById('copy-build');
  if (copyBuildBtn) {
    copyBuildBtn.addEventListener('mouseenter', () => {
      copyBuildBtn.style.background = 'rgba(255, 255, 255, 0.1)';
      copyBuildBtn.style.color = '#cccccc';
    });
    copyBuildBtn.addEventListener('mouseleave', () => {
      copyBuildBtn.style.background = 'none';
      copyBuildBtn.style.color = '#858585';
    });
    
    copyBuildBtn.addEventListener('click', () => {
      const tagText = tag ? `\n标签: ${tag}` : '';
      const text = `版本: ${commitHash}\n时间: ${commitDate}\n分支: ${branch}${tagText}`;
      
      navigator.clipboard.writeText(text).then(() => {
        copyBuildBtn.textContent = '✓';
        setTimeout(() => {
          copyBuildBtn.textContent = '📋';
        }, 1500);
      });
    });
  }
  
  // 点击安全信息图标打开modal
  securityInfo.addEventListener('click', () => {
    modal.style.display = 'flex';
  });
  
  // hover效果
  securityInfo.addEventListener('mouseenter', () => {
    securityInfo.style.background = 'rgba(78, 201, 176, 0.25)';
  });
  
  securityInfo.addEventListener('mouseleave', () => {
    securityInfo.style.background = 'rgba(78, 201, 176, 0.15)';
  });
  
  // 关闭modal
  const closeModal = () => {
    modal.style.display = 'none';
  };
  
  closeBtn.addEventListener('click', closeModal);
  
  // 点击背景关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
  
  // ESC键关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      closeModal();
    }
  });
}

// 初始化使用说明弹窗
function initHelpModal() {
  const helpButton = document.getElementById('help-button');
  const modal = document.getElementById('help-modal');
  const closeBtn = document.getElementById('close-help-modal');
  
  if (!helpButton || !modal) return;
  
  // 点击帮助按钮打开modal
  helpButton.addEventListener('click', () => {
    modal.style.display = 'flex';
  });
  
  // 关闭modal
  const closeModal = () => {
    modal.style.display = 'none';
  };
  
  closeBtn.addEventListener('click', closeModal);
  
  // 点击背景关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
  
  // ESC键关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      closeModal();
    }
  });
}

// 初始化多语言系统
function initI18n() {
  // 保存原始文本模板
  const templates = {};
  
  // 更新所有带有 data-i18n 属性的元素
  function updateTranslations() {
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
      const key = el.getAttribute('data-i18n');
      const translated = i18n.t(key);
      
      // 获取子元素
      const children = Array.from(el.children);
      
      if (children.length === 0) {
        // 没有子元素，直接替换文本
        el.textContent = translated;
      } else {
        // 有子元素，替换第一个文本节点或插入到开头
        let textNodeFound = false;
        for (let node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
            node.textContent = translated;
            textNodeFound = true;
            break;
          }
        }
        // 如果没有文本节点，在开头插入
        if (!textNodeFound && children.length > 0) {
          el.insertBefore(document.createTextNode(translated), children[0]);
        }
      }
    });
    
    // 处理带模板的元素（用于保留格式化的文本）
    const templateElements = document.querySelectorAll('[data-i18n-template]');
    templateElements.forEach(el => {
      const key = el.getAttribute('data-i18n-template');
      
      // 首次访问时保存原始文本
      if (!templates[el.id]) {
        templates[el.id] = el.textContent;
      }
      
      const original = templates[el.id];
      const translated = i18n.t(key);
      
      // 根据语言和原始文本结构，替换标签部分
      if (original && original.includes(':')) {
        const parts = original.split(':');
        el.textContent = translated + ':' + parts[1];
      }
    });

    // 处理 title 属性
    const titleElements = document.querySelectorAll('[data-i18n-title]');
    titleElements.forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      const translated = i18n.t(key);
      el.setAttribute('title', translated);
    });
  }

  // 设置初始语言
  updateTranslations();

  // 添加语言切换按钮事件
  const langToggle = document.getElementById('lang-toggle');
  if (langToggle) {
    // 初始化按钮显示
    const updateLangButton = () => {
      const currentLang = i18n.getLanguage();
      langToggle.textContent = currentLang === 'zh' ? 'English' : '中文';
    };
    updateLangButton();

    langToggle.addEventListener('click', () => {
      const currentLang = i18n.getLanguage();
      const newLang = currentLang === 'zh' ? 'en' : 'zh';
      i18n.setLanguage(newLang);
      updateTranslations();
      updateLangButton();
    });
  }
}

initI18n();
initBuildInfoModal();
initHelpModal();

// 初始化下拉菜单
function initDropdowns() {
  const dropdowns = Array.from(document.querySelectorAll('.dropdown'));

  const closeDropdown = (dropdown, restoreFocus = false) => {
    const toggle = dropdown.querySelector('.dropdown-toggle');
    const menu = Array.from(dropdown.children).find(child =>
      child.classList?.contains('dropdown-menu')
    );
    if (!toggle || !menu) return;

    menu.classList.remove('show');
    toggle.setAttribute('aria-expanded', 'false');
    const submenu = menu.querySelector('.dropdown-submenu');
    const submenuToggle = submenu?.querySelector('.submenu-toggle');
    submenu?.classList.remove('open');
    submenuToggle?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  };

  const closeAllDropdowns = (except = null) => {
    dropdowns.forEach(dropdown => {
      if (dropdown !== except) closeDropdown(dropdown);
    });
  };

  dropdowns.forEach(dropdown => {
    const toggle = dropdown.querySelector('.dropdown-toggle');
    const menu = Array.from(dropdown.children).find(child =>
      child.classList?.contains('dropdown-menu')
    );
    if (!toggle || !menu) return;

    toggle.setAttribute('aria-haspopup', 'menu');
    toggle.setAttribute('aria-expanded', 'false');

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !menu.classList.contains('show');
      closeAllDropdowns(dropdown);
      if (willOpen) {
        menu.classList.add('show');
        toggle.setAttribute('aria-expanded', 'true');
      } else {
        closeDropdown(dropdown);
      }
    });

    toggle.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown') return;
      event.preventDefault();
      closeAllDropdowns(dropdown);
      menu.classList.add('show');
      toggle.setAttribute('aria-expanded', 'true');
      menu.querySelector('.dropdown-item:not([disabled])')?.focus();
    });

    const submenu = menu.querySelector('.dropdown-submenu');
    const submenuToggle = submenu?.querySelector('.submenu-toggle');
    const submenuMenu = submenu?.querySelector('.submenu-menu');
    if (submenuToggle && submenuMenu) {
      submenuToggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const willOpen = !submenu.classList.contains('open');
        submenu.classList.toggle('open', willOpen);
        submenuToggle.setAttribute('aria-expanded', String(willOpen));
      });

      submenuToggle.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        submenu.classList.add('open');
        submenuToggle.setAttribute('aria-expanded', 'true');
        submenuMenu.querySelector('.dropdown-item:not([disabled])')?.focus();
      });
    }

    menu.querySelectorAll('.dropdown-item').forEach(item => {
      if (item.classList.contains('submenu-toggle')) return;
      item.addEventListener('click', () => {
        closeDropdown(dropdown);
      });
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) {
      closeAllDropdowns();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const openDropdown = dropdowns.find(dropdown =>
        Array.from(dropdown.children).some(child =>
          child.classList?.contains('dropdown-menu') && child.classList.contains('show')
        )
      );
      if (openDropdown) {
        event.preventDefault();
        closeDropdown(openDropdown, true);
      }
    }
  });
}

/**
 * 识别脚部：根据URDF中的关节名称识别脚踝关节和脚部link
 */
RobotKeyframeEditor.prototype.identifyFeet = function() {
    if (!this.robotLeft && !this.robotRight) {
      alert(i18n.t('needRobot'));
      return;
    }

    this.identifiedFeet = [];
    
    // 扩展的关键词匹配规则
    const ankleKeywords = [
      // 基本英文
      'ankle', 'foot', 'feet', 'toe', 'heel', 'sole', 
      // 解剖学术语
      'talus', 'calcaneus', 'tarsus', 'metatarsal', 'phalange', 'hallux',
      // 机器人术语
      'end_effector', 'end-effector', 'endeffector',
      'limb_end', 'limb-end', 'limbend',
      'leg_end', 'leg-end', 'legend',
      'chain_end', 'chain-end', 'chainend',
      // 编号模式
      '_tip', '-tip', 'tip_', 'tip-',
      '_foot', '-foot', 'foot_', 'foot-',
      '_ankle', '-ankle', 'ankle_', 'ankle-',
      // 多语言（小写匹配）
      'pied', 'cheville', // 法语
      'fuss', 'knöchel', 'knoechel', // 德语
      'pie', 'tobillo', // 西班牙语
      'piede', 'caviglia', // 意大利语
      'ashi', 'ashikubi', // 日语罗马音
      'jiao', 'huaijiao' // 中文拼音
    ];
    
    // 从机器人中提取关节信息
    const robot = this.robotLeft || this.robotRight;
    const allJoints = [];
    const jointToChildren = new Map();
    
    robot.traverse((obj) => {
      if (obj.isURDFJoint) {
        const jointName = obj.name;
        allJoints.push(obj);
        
        // 记录子link
        if (obj.children && obj.children.length > 0) {
          const childLinks = obj.children.filter(c => c.isURDFLink);
          if (childLinks.length > 0) {
            jointToChildren.set(obj, childLinks);
          }
        }
      }
    });

    // 识别脚踝关节（名称包含关键词的）
    const ankleJoints = allJoints.filter(joint => {
      const nameLower = joint.name.toLowerCase();
      return ankleKeywords.some(keyword => nameLower.includes(keyword));
    });

    console.log(`🦶 找到 ${ankleJoints.length} 个可能的脚踝关节:`, ankleJoints.map(j => j.name));

    // 对每个脚踝关节，找到其末端link
    const processedFeet = new Set();
    
    for (const ankleJoint of ankleJoints) {
      // 找到该关节链的末端link
      const endLink = this.findEndLink(ankleJoint);
      
      if (endLink && !processedFeet.has(endLink.name)) {
        // 查找该脚的所有脚踝关节（连续的包含关键词的关节）
        const footAnkleJoints = this.findConsecutiveAnkleJoints(ankleJoint, ankleKeywords);
        
        this.identifiedFeet.push({
          linkName: endLink.name,
          ankleJoints: footAnkleJoints.map(j => j.name)
        });
        
        processedFeet.add(endLink.name);
      }
    }

    console.log('🦶 识别的脚部:', this.identifiedFeet);
    
    // 显示模态框供用户调整
    this.showFootIdentificationModal();
  };

/**
 * 找到关节链的末端link
 */
RobotKeyframeEditor.prototype.findEndLink = function(joint) {
    let current = joint;
    let endLink = null;
    
    // 遍历子节点直到找不到更多的关节
    while (current) {
      const childLinks = current.children ? current.children.filter(c => c.isURDFLink) : [];
      if (childLinks.length > 0) {
        endLink = childLinks[0]; // 取第一个link
        
        // 查找该link下的子关节
        const childJoints = endLink.children ? endLink.children.filter(c => c.isURDFJoint) : [];
        if (childJoints.length > 0) {
          current = childJoints[0];
        } else {
          break;
        }
      } else {
        break;
      }
    }
    
    return endLink;
  };

/**
 * 找到连续的脚踝关节
 */
RobotKeyframeEditor.prototype.findConsecutiveAnkleJoints = function(startJoint, keywords) {
    const ankles = [startJoint];
    let current = startJoint;
    
    // 向父级查找
    let parent = current.parent;
    while (parent && parent.isURDFJoint) {
      const nameLower = parent.name.toLowerCase();
      if (keywords.some(kw => nameLower.includes(kw))) {
        ankles.unshift(parent);
        parent = parent.parent;
      } else {
        break;
      }
    }
    
    // 向子级查找
    const childLinks = current.children ? current.children.filter(c => c.isURDFLink) : [];
    if (childLinks.length > 0) {
      const childJoints = childLinks[0].children ? childLinks[0].children.filter(c => c.isURDFJoint) : [];
      for (const childJoint of childJoints) {
        const nameLower = childJoint.name.toLowerCase();
        if (keywords.some(kw => nameLower.includes(kw))) {
          ankles.push(childJoint);
        }
      }
    }
    
    return ankles;
  };

/**
 * 更新脚部控制UI
 */
RobotKeyframeEditor.prototype.updateFootControlsUI = function() {
    const feetList = document.getElementById('feet-list');
    const globalLevelButton = document.getElementById('level-feet');
    
    // 隐藏全局水平按钮
    globalLevelButton.style.display = 'none';
    feetList.innerHTML = '';
    
    // 显示每只脚的简化卡片
    this.identifiedFeet.forEach((foot, index) => {
      const footDiv = document.createElement('div');
      footDiv.style.cssText = 'margin-bottom: 8px; padding: 8px; background: var(--bg-secondary); border-radius: 4px; border: 1px solid var(--border-primary);';
      
      footDiv.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <strong style="font-size: 12px; color: var(--text-primary);">🦶 ${foot.linkName}</strong>
          <div style="display: flex; gap: 4px;">
            <button class="edit-foot" data-index="${index}" style="padding: 3px 8px; font-size: 10px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-primary); border-radius: 3px; cursor: pointer;" data-i18n="editFoot">编辑</button>
            <button class="delete-foot" data-index="${index}" style="padding: 3px 8px; font-size: 10px; background: var(--warning-color); color: white; border: none; border-radius: 3px; cursor: pointer;" data-i18n="deleteFoot">删除</button>
          </div>
        </div>
        <div style="display: flex; gap: 4px;">
          <button class="level-single-foot" data-index="${index}" style="flex: 1; padding: 4px; font-size: 11px; background: var(--accent-primary); color: white; border: none; border-radius: 3px; cursor: pointer;" data-i18n="levelThisFoot">⚖️ 水平化</button>
          <button class="reset-single-foot" data-index="${index}" style="flex: 1; padding: 4px; font-size: 11px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-primary); border-radius: 3px; cursor: pointer;" data-i18n="resetThisFoot">🔄 复原</button>
        </div>
      `;
      
      feetList.appendChild(footDiv);
    });
    
    // 添加"创建脚"按钮
    const createFootDiv = document.createElement('div');
    createFootDiv.style.cssText = 'margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-primary);';
    createFootDiv.innerHTML = `
      <button id="create-foot-btn" style="width: 100%; padding: 6px; font-size: 12px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-primary); border-radius: 4px; cursor: pointer;" data-i18n="createFoot">➕ 创建脚</button>
    `;
    feetList.appendChild(createFootDiv);
    
    // 绑定编辑按钮
    feetList.querySelectorAll('.edit-foot').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        this.showFootEditModal(index);
      });
    });
    
    // 绑定删除按钮
    feetList.querySelectorAll('.delete-foot').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        this.identifiedFeet.splice(index, 1);
        this.updateFootControlsUI();
      });
    });
    
    // 绑定单独水平按钮
    feetList.querySelectorAll('.level-single-foot').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        this.levelFeet(index);
      });
    });
    
    // 绑定复原按钮
    feetList.querySelectorAll('.reset-single-foot').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        this.resetFoot(index);
      });
    });
    
    // 绑定创建脚按钮
    document.getElementById('create-foot-btn').addEventListener('click', () => {
      this.showFootEditModal(null);
    });
    
    // 应用i18n
    if (this.i18n && this.i18n.updatePageText) {
      this.i18n.updatePageText();
    }
  };

/**
 * 脚部水平：计算脚踝关节残差使脚部link水平
 * @param {number|null} footIndex - 指定要水平化的脚的索引，如果为null则水平化所有脚
 */
RobotKeyframeEditor.prototype.levelFeet = function(footIndex = null) {
    if (!this.trajectoryManager.hasTrajectory()) {
      alert('请先加载 CSV 轨迹');
      return;
    }
    
    if (this.identifiedFeet.length === 0) {
      alert('请先识别脚部');
      return;
    }
    
    // 确定要处理的脚
    const feetToProcess = footIndex !== null 
      ? [this.identifiedFeet[footIndex]]
      : this.identifiedFeet;
    
    if (footIndex !== null && !feetToProcess[0]) {
      alert('指定的脚不存在');
      return;
    }

    const currentFrame = this.timelineController.getCurrentFrame();
    const robot = this.robotLeft || this.robotRight;
    
    if (!robot) {
      alert(i18n.t('needRobot'));
      return;
    }

    // 确保该帧有关键帧
    if (!this.trajectoryManager.keyframes.has(currentFrame)) {
      const jointCount = this.trajectoryManager.jointCount;
      this.trajectoryManager.keyframes.set(currentFrame, {
        residual: new Array(jointCount).fill(0),
        baseResidual: {
          position: { x: 0, y: 0, z: 0 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 }
        }
      });
    }

    const keyframe = this.trajectoryManager.keyframes.get(currentFrame);
    let modifiedCount = 0;

    // 构建关节名称到索引的映射
    const jointNameToIndex = new Map();
    this.urdfLoader.joints.forEach((joint, index) => {
      jointNameToIndex.set(joint.name, index);
    });

    // 对每只脚进行水平化
    feetToProcess.forEach(foot => {
      // 找到脚部link
      let footLink = null;
      robot.traverse(obj => {
        if (obj.isURDFLink && obj.name === foot.linkName) {
          footLink = obj;
        }
      });

      if (!footLink) {
        console.warn(`未找到脚部link: ${foot.linkName}`);
        return;
      }

      // 获取脚部link的局部z轴在世界坐标系中的方向
      const localZ = new THREE.Vector3(0, 0, 1);
      const worldZ = localZ.clone().applyQuaternion(footLink.getWorldQuaternion(new THREE.Quaternion()));
      const targetZ = new THREE.Vector3(0, 0, 1); // 世界坐标系的z轴
      
      // 计算当前z轴与目标z轴的夹角（弧度）
      const currentAngle = worldZ.angleTo(targetZ);
      console.log(`🦶 脚部 ${foot.linkName} 当前z轴偏离角度: ${(currentAngle * 180 / Math.PI).toFixed(2)}°`);
      
      // 如果已经接近水平（偏差小于1度），跳过
      if (currentAngle < 0.017) { // 1度 = 0.017弧度
        console.log('  ✅ 已经接近水平，跳过');
        return;
      }

      // 使用试错法：对每个脚踝关节，尝试小幅度调整，看哪个方向能减小角度
      const testStep = 0.05; // 测试步长：约2.86度
      const bestAdjustments = {};
      
      foot.ankleJoints.forEach(jointName => {
        const jointIndex = jointNameToIndex.get(jointName);
        if (jointIndex === undefined) {
          console.warn(`未找到关节: ${jointName}`);
          return;
        }
        
        // 保存当前残差
        const originalResidual = keyframe.residual[jointIndex];
        
        // 尝试正向调整
        keyframe.residual[jointIndex] = originalResidual + testStep;
        this.updateRobotState(currentFrame);
        const worldZPositive = localZ.clone().applyQuaternion(footLink.getWorldQuaternion(new THREE.Quaternion()));
        const anglePositive = worldZPositive.angleTo(targetZ);
        
        // 尝试负向调整
        keyframe.residual[jointIndex] = originalResidual - testStep;
        this.updateRobotState(currentFrame);
        const worldZNegative = localZ.clone().applyQuaternion(footLink.getWorldQuaternion(new THREE.Quaternion()));
        const angleNegative = worldZNegative.angleTo(targetZ);
        
        // 恢复原值
        keyframe.residual[jointIndex] = originalResidual;
        
        // 选择更好的方向
        const improvementPositive = currentAngle - anglePositive;
        const improvementNegative = currentAngle - angleNegative;
        
        console.log(`  关节 ${jointName}: 当前角度=${(currentAngle * 180 / Math.PI).toFixed(2)}°, 正向→${(anglePositive * 180 / Math.PI).toFixed(2)}° (改善${(improvementPositive * 180 / Math.PI).toFixed(2)}°), 负向→${(angleNegative * 180 / Math.PI).toFixed(2)}° (改善${(improvementNegative * 180 / Math.PI).toFixed(2)}°)`);
        
        // 选择改善最大的方向（即使很小也选择）
        if (Math.abs(improvementPositive) > 0.0001 || Math.abs(improvementNegative) > 0.0001) {
          if (improvementPositive > improvementNegative) {
            bestAdjustments[jointIndex] = testStep;
            console.log(`    → 选择正向调整 +${testStep.toFixed(3)}`);
          } else {
            bestAdjustments[jointIndex] = -testStep;
            console.log(`    → 选择负向调整 ${(-testStep).toFixed(3)}`);
          }
        } else {
          console.log(`    → 跳过（无明显改善）`);
        }
      });
      
      // 恢复机器人状态到测试前
      this.updateRobotState(currentFrame);
      
      // 应用最佳调整
      const adjustmentCount = Object.keys(bestAdjustments).length;
      console.log(`  准备应用 ${adjustmentCount} 个调整`);
      
      if (adjustmentCount > 0) {
        for (const [jointIndex, adjustment] of Object.entries(bestAdjustments)) {
          keyframe.residual[parseInt(jointIndex)] += adjustment;
          modifiedCount++;
          console.log(`    应用: keyframe.residual[${jointIndex}] += ${adjustment.toFixed(3)}`);
        }
        console.log(`  ✅ 已应用 ${adjustmentCount} 个关节的调整, modifiedCount=${modifiedCount}`);
      } else {
        console.log('  ⚠️ 未找到改善方向');
      }
    });
    
    console.log(`🔄 水平化完成，总共修改了 ${modifiedCount} 个关节残差`);

    if (modifiedCount > 0) {
      // 更新关键帧标记
      const keyframes = Array.from(this.trajectoryManager.keyframes.keys());
      this.timelineController.updateKeyframeMarkers(keyframes);

      // 更新显示
      this.updateRobotState(currentFrame);

      // 更新曲线编辑器
      if (this.curveEditor) {
        this.curveEditor.updateCurves();
      }

      // 触发自动保存
      this.triggerAutoSave();

      const footCountText = footIndex !== null ? `脚 ${footIndex + 1}` : `${feetToProcess.length} 只脚`;
      this.updateStatus(`✅ 已水平化 ${footCountText}`, 'success');
    } else {
      this.updateStatus('⚠️ 未能应用水平化', 'error');
    }
  };

/**
 * 复原单只脚：重置该脚所有脚踝关节的残差为0
 * @param {number} footIndex - 要复原的脚的索引
 */
RobotKeyframeEditor.prototype.resetFoot = function(footIndex) {
    if (!this.trajectoryManager.hasTrajectory()) {
      alert('请先加载 CSV 轨迹');
      return;
    }
    
    if (this.identifiedFeet.length === 0 || !this.identifiedFeet[footIndex]) {
      alert('指定的脚不存在');
      return;
    }
    
    const foot = this.identifiedFeet[footIndex];
    const currentFrame = this.timelineController.currentFrame;
    
    // 确保该帧有关键帧
    if (!this.trajectoryManager.keyframes.has(currentFrame)) {
      const jointCount = this.trajectoryManager.jointCount;
      this.trajectoryManager.keyframes.set(currentFrame, {
        residual: new Array(jointCount).fill(0),
        baseResidual: {
          position: { x: 0, y: 0, z: 0 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 }
        }
      });
    }
    
    const keyframe = this.trajectoryManager.keyframes.get(currentFrame);
    let resetCount = 0;
    
    // 构建关节名称到索引的映射
    const jointNameToIndex = new Map();
    this.urdfLoader.joints.forEach((joint, index) => {
      jointNameToIndex.set(joint.name, index);
    });
    
    // 重置该脚所有脚踝关节的残差
    foot.ankleJoints.forEach(jointName => {
      const jointIndex = jointNameToIndex.get(jointName);
      if (jointIndex !== undefined) {
        keyframe.residual[jointIndex] = 0;
        resetCount++;
      }
    });
    
    if (resetCount > 0) {
      // 更新关键帧标记
      const keyframes = Array.from(this.trajectoryManager.keyframes.keys());
      this.timelineController.updateKeyframeMarkers(keyframes);
      
      // 更新显示
      this.updateRobotState(currentFrame);
      
      // 更新曲线编辑器
      if (this.curveEditor) {
        this.curveEditor.updateCurves();
      }
      
      // 触发自动保存
      this.triggerAutoSave();
      
      this.updateStatus(`✅ 已复原脚 ${footIndex + 1} 的 ${resetCount} 个关节`, 'success');
    } else {
      this.updateStatus('⚠️ 未找到可复原的关节', 'error');
    }
  };

/**
 * 显示脚部识别结果模态框
 */
RobotKeyframeEditor.prototype.showFootIdentificationModal = function() {
    const modal = document.getElementById('foot-identification-modal');
    const modalBody = document.getElementById('foot-modal-list');
    
    // 临时存储当前编辑的脚部列表
    this.tempIdentifiedFeet = JSON.parse(JSON.stringify(this.identifiedFeet));
    
    // 渲染脚部列表
    this.renderModalFootList();
    
    // 显示模态框
    modal.classList.add('show');
    
    // 绑定事件（只绑定一次）
    if (!this._footModalEventsAttached) {
      this._footModalEventsAttached = true;
      
      // 关闭按钮
      modal.querySelector('.modal-close').addEventListener('click', () => {
        modal.classList.remove('show');
      });
      
      // 取消按钮
      document.getElementById('foot-modal-cancel').addEventListener('click', () => {
        modal.classList.remove('show');
      });
      
      // 确认按钮
      document.getElementById('foot-modal-confirm').addEventListener('click', () => {
        this.identifiedFeet = JSON.parse(JSON.stringify(this.tempIdentifiedFeet));
        this.updateFootControlsUI();
        modal.classList.remove('show');
        this.updateStatus(`✅ ${i18n.t('confirm')} ${this.identifiedFeet.length} 只脚`, 'success');
      });
      
      // 点击背景关闭
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('show');
        }
      });
    }
  };

/**
 * 渲染模态框中的脚部列表
 */
RobotKeyframeEditor.prototype.renderModalFootList = function() {
    const modalBody = document.getElementById('foot-modal-list');
    
    if (this.tempIdentifiedFeet.length === 0) {
      modalBody.innerHTML = `<div class="modal-empty-message">${i18n.t('noFeetIdentified')}</div>`;
      return;
    }
    
    modalBody.innerHTML = '';
    
    this.tempIdentifiedFeet.forEach((foot, index) => {
      const footItem = document.createElement('div');
      footItem.className = 'foot-item';
      
      footItem.innerHTML = `
        <div class="foot-item-info">
          <div class="foot-item-label">🦶 ${i18n.t('footLink')}: ${foot.linkName}</div>
          <div class="foot-item-details">${i18n.t('ankleJoints')}: ${foot.ankleJoints.join(', ')}</div>
        </div>
        <div class="foot-item-actions">
          <button class="delete-foot-btn" data-index="${index}">${i18n.t('deleteFoot')}</button>
        </div>
      `;
      
      modalBody.appendChild(footItem);
    });
    
    // 绑定删除按钮事件
    modalBody.querySelectorAll('.delete-foot-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.getAttribute('data-index'));
        this.tempIdentifiedFeet.splice(index, 1);
        this.renderModalFootList();
      });
    });
  };

/**
 * 显示脚部编辑/创建弹窗
 * @param {number|null} footIndex - 要编辑的脚的索引，null表示创建新脚
 */
RobotKeyframeEditor.prototype.showFootEditModal = function(footIndex) {
    const modal = document.getElementById('foot-edit-modal');
    const modalTitle = document.getElementById('foot-edit-modal-title');
    const linkSelect = document.getElementById('foot-edit-link-select');
    const jointSelect = document.getElementById('foot-edit-joint-select');
    const jointList = document.getElementById('foot-edit-joint-list');
    
    // 设置标题
    const isEdit = footIndex !== null;
    modalTitle.textContent = isEdit ? i18n.t('editFootTitle') : i18n.t('createFootTitle');
    
    // 获取机器人的所有link和joint
    const robot = this.robotLeft || this.robotRight;
    if (!robot) {
      alert(i18n.t('needRobot'));
      return;
    }
    
    const allLinks = [];
    const allJoints = [];
    
    robot.traverse((obj) => {
      if (obj.isURDFLink) {
        allLinks.push(obj.name);
      }
      if (obj.isURDFJoint) {
        allJoints.push(obj.name);
      }
    });
    
    // 填充link下拉列表
    linkSelect.innerHTML = '<option value="">选择 Link</option>';
    allLinks.forEach(linkName => {
      const option = document.createElement('option');
      option.value = linkName;
      option.textContent = linkName;
      linkSelect.appendChild(option);
    });
    
    // 填充joint下拉列表
    jointSelect.innerHTML = '<option value="">选择关节</option>';
    allJoints.forEach(jointName => {
      const option = document.createElement('option');
      option.value = jointName;
      option.textContent = jointName;
      jointSelect.appendChild(option);
    });
    
    // 临时编辑数据
    if (isEdit) {
      this.tempEditFoot = JSON.parse(JSON.stringify(this.identifiedFeet[footIndex]));
    } else {
      this.tempEditFoot = {
        linkName: '',
        ankleJoints: []
      };
    }
    
    // 设置当前值
    linkSelect.value = this.tempEditFoot.linkName;
    this.renderEditJointList();
    
    // 显示弹窗
    modal.classList.add('show');
    
    // 绑定事件（只绑定一次）
    if (!this._footEditModalEventsAttached) {
      this._footEditModalEventsAttached = true;
      
      // 关闭按钮
      modal.querySelector('.modal-close').addEventListener('click', () => {
        modal.classList.remove('show');
      });
      
      // 取消按钮
      document.getElementById('foot-edit-cancel').addEventListener('click', () => {
        modal.classList.remove('show');
      });
      
      // 确认按钮
      document.getElementById('foot-edit-confirm').addEventListener('click', () => {
        // 验证
        if (!this.tempEditFoot.linkName) {
          alert('请选择脚部 Link');
          return;
        }
        if (this.tempEditFoot.ankleJoints.length === 0) {
          alert('请至少添加一个脚踝关节');
          return;
        }
        
        // 保存或创建
        if (isEdit) {
          this.identifiedFeet[footIndex] = JSON.parse(JSON.stringify(this.tempEditFoot));
          this.updateStatus(i18n.t('footUpdated'), 'success');
        } else {
          this.identifiedFeet.push(JSON.parse(JSON.stringify(this.tempEditFoot)));
          this.updateStatus(i18n.t('footAdded'), 'success');
        }
        
        this.updateFootControlsUI();
        modal.classList.remove('show');
      });
      
      // Link选择变化
      linkSelect.addEventListener('change', (e) => {
        this.tempEditFoot.linkName = e.target.value;
      });
      
      // 添加关节按钮
      document.getElementById('foot-edit-add-joint').addEventListener('click', () => {
        const selectedJoint = jointSelect.value;
        if (!selectedJoint) {
          return;
        }
        
        // 检查是否已存在
        if (!this.tempEditFoot.ankleJoints.includes(selectedJoint)) {
          this.tempEditFoot.ankleJoints.push(selectedJoint);
          this.renderEditJointList();
          jointSelect.value = '';
        }
      });
      
      // 点击背景关闭
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('show');
        }
      });
    }
    
    // 每次打开时重新绑定footIndex
    this._currentEditFootIndex = footIndex;
  };

/**
 * 渲染编辑弹窗中的关节列表
 */
RobotKeyframeEditor.prototype.renderEditJointList = function() {
    const jointList = document.getElementById('foot-edit-joint-list');
    
    if (this.tempEditFoot.ankleJoints.length === 0) {
      jointList.innerHTML = '<div style="text-align: center; color: var(--text-tertiary); font-size: 11px; padding: 8px;">暂无关节</div>';
      return;
    }
    
    jointList.innerHTML = '';
    
    this.tempEditFoot.ankleJoints.forEach((jointName, index) => {
      const jointItem = document.createElement('div');
      jointItem.className = 'joint-item';
      
      jointItem.innerHTML = `
        <span>${jointName}</span>
        <button class="remove-joint-btn" data-index="${index}">移除</button>
      `;
      
      jointList.appendChild(jointItem);
    });
    
    // 绑定移除按钮
    jointList.querySelectorAll('.remove-joint-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.getAttribute('data-index'));
        this.tempEditFoot.ankleJoints.splice(index, 1);
        this.renderEditJointList();
      });
    });
  };

initDropdowns();
