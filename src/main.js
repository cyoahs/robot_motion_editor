import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { URDFLoader } from './urdfLoader.js';
import { TrajectoryManager } from './trajectoryManager.js';
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
import { ViewportManager } from './viewportManager.js';
import { ViewportToolbar } from './viewportToolbar.js';
import { DEFAULT_FPS_BY_FORMAT, TRAJECTORY_FORMATS } from './trajectoryFormatConverter.js';
import {
  collectFilesFromDataTransfer,
  hasFileTransfer,
  classifyDroppedFiles
} from './fileDropHandler.js';
import {
  captureRobotState,
  restoreRobotState
} from './ik/eePoseSampler.js';

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
    
    // 共享渲染器
    this.renderer = null;
    
    // 兼容旧代码的引用
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.robot = null;
    
    this.urdfLoader = new URDFLoader();
    this.trajectoryManager = new TrajectoryManager();
    this.jointController = null;
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
    
    // 相机控制状态
    this.cameraMode = 'rotate'; // 'rotate' 或 'pan'
    this.followRobot = false;
    this.showCOM = true; // 默认显示重心
    this.defaultCameraPosition = new THREE.Vector3(3, 3, 2);
    this.defaultCameraTarget = new THREE.Vector3(0, 0, 0.5);
    
    // 脚部识别数据：[{ linkName, ankleJoints: [] }]
    this.identifiedFeet = [];

    this.viewportManager = null;
    this.endEffectorControls = null;
    this.ikPanel = null;
    this._pendingUrdfForIk = false;
    this._ikModuleFailed = false;
    this.isIkDragging = false;

    try {
      this.init();
      this.setupEventListeners();
      this.animate();
      this.updateStatus(i18n.t('ready'), 'success');
    } catch (err) {
      console.error('编辑器初始化失败:', err);
      this.updateStatus(`${i18n.t('initFailed')}: ${err.message}`, 'error');
    }
  }

  updateStatus(message, type = 'info') {
    const statusText = document.getElementById('status-text');
    if (statusText) {
      statusText.textContent = message;
      // 只修改文字颜色
      if (type === 'error') {
        statusText.style.color = 'var(--warning-color)';
      } else if (type === 'success') {
        statusText.style.color = 'var(--success-color)';
      } else {
        statusText.style.color = 'var(--text-secondary)';
      }
    }
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
    const fullWidth = Math.max(viewport?.clientWidth || 1, 1);
    const fullHeight = Math.max(viewport?.clientHeight || 1, 1);
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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(fullWidth, fullHeight, false);
    this.renderer.autoClear = false; // 手动控制清除，用于多视口渲染
    viewport.appendChild(this.renderer.domElement);

    // 添加轨道控制器 - 只使用一个控制器，但同步两个相机
    this.controls = new OrbitControls(this.cameraRight, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 0, 0.5);
    
    // 分屏模式下同步左侧相机；叠显模式由 cameraMain 驱动
    this.controls.addEventListener('change', () => {
      const mode = this.viewportManager?.mode;
      const active = this.controls.object;
      if (mode === 'split') {
        this.cameraLeft.position.copy(this.cameraRight.position);
        this.cameraLeft.quaternion.copy(this.cameraRight.quaternion);
        this.cameraLeft.zoom = this.cameraRight.zoom;
        this.cameraLeft.updateProjectionMatrix();
      } else if (mode === 'overlay' && active === this.viewportManager?.cameraMain) {
        this.cameraRight.position.copy(active.position);
        this.cameraRight.quaternion.copy(active.quaternion);
        this.cameraRight.zoom = active.zoom;
        this.cameraRight.updateProjectionMatrix();
      }
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

    this.viewportManager = new ViewportManager(this);
    this.viewportManager.initScenes(this.themeManager.getCurrentTheme(), this.frustumSize);
    this.viewportManager.setMode(this.viewportManager.mode, { skipStorage: true });
    this.viewportManager.setupUi();

    this.viewportToolbar = new ViewportToolbar();
    this.viewportToolbar.init();
    this.viewportManager.syncUiFromState();
    this.viewportToolbar.syncAllMirrors();

    this._initIkModulesAsync();

    // 窗口大小调整
    window.addEventListener('resize', () => this.handleResize());
    
    // 尝试恢复上次保存的状态（异步）
    this.restoreStateIfAvailable().catch(err => {
      console.error('恢复状态错误:', err);
    });

    // 布局完成后再次校正视口尺寸（避免 flex 未算完时 aspect=0 导致黑屏）
    requestAnimationFrame(() => {
      this.handleResize();
      this.viewportManager?.render();
    });
  }

  /** @returns {import('urdf-loader').URDFRobot | null} */
  get robotGhost() {
    return this.robotLeft;
  }

  /** @returns {import('urdf-loader').URDFRobot | null} */
  get robotEdited() {
    return this.robotRight;
  }

  handleResize() {
    this.viewportManager?.handleResize();
  }

  async _initIkModulesAsync() {
    try {
      const [{ IkPanel }, { EndEffectorControls }] = await Promise.all([
        import('./ik/ikPanel.js'),
        import('./ik/endEffectorControls.js')
      ]);
      this.endEffectorControls = new EndEffectorControls(this);
      this.ikPanel = new IkPanel(this);
      if (this._pendingIkProjectSettings) {
        this.ikPanel.applyProjectSettings(this._pendingIkProjectSettings);
        this._pendingIkProjectSettings = null;
      }
      if (this.robotRight || this._pendingUrdfForIk) {
        this.ikPanel.onUrdfLoaded();
        this._pendingUrdfForIk = false;
      }
    } catch (err) {
      console.warn('IK 模块加载失败，3D 编辑仍可用:', err);
      this._ikModuleLoadError = err?.message || String(err);
      this._ikModuleFailed = true;
      this.endEffectorControls = null;
      this.ikPanel = null;
      this.refreshIkPanelUi();
    }
  }

  /** 同步 IK 区域 DOM（不依赖 IkPanel 是否已构造） */
  refreshIkPanelUi() {
    const hint = document.getElementById('ik-load-hint');
    const body = document.getElementById('ik-controls-body');
    const robot = this.robotRight;

    if (!robot) {
      if (hint) {
        hint.style.display = 'block';
        hint.textContent = i18n.t('ikNeedUrdf');
      }
      if (body) body.style.display = 'none';
      return;
    }

    if (!this.ikPanel) {
      if (hint) {
        hint.style.display = 'block';
        hint.textContent = this._ikModuleFailed
          ? `${i18n.t('ikModuleFailed')}${this._ikModuleLoadError ? ` (${this._ikModuleLoadError})` : ''}`
          : i18n.t('ikModuleLoading');
      }
      if (body) body.style.display = 'none';
      return;
    }

    if (hint) hint.style.display = 'none';
    if (body) body.style.display = 'block';
  }

  /** URDF 就绪后通知 IK 面板（处理 IK 模块晚于 URDF 加载的竞态） */
  notifyUrdfReady() {
    if (!this.robotRight) {
      this.refreshIkPanelUi();
      return;
    }
    this._pendingUrdfForIk = true;
    if (this.ikPanel) {
      this.ikPanel.onUrdfLoaded();
      this._pendingUrdfForIk = false;
    }
    this.refreshIkPanelUi();
  }

  setupEventListeners() {
    // URDF 文件夹加载
    document.getElementById('urdf-folder').addEventListener('change', (e) => {
      this.loadURDFFolder(e.target.files);
    });

    // CSV 文件加载
    document.getElementById('csv-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.loadCSV(file);
      }
    });

    this.setupFileDrop();

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
      if (this.jointController) {
        this.jointController.resetToBase();
      }
      if (this.baseController) {
        this.baseController.resetToBase();
      }
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

    // IK 面板折叠（页面加载即可用，不依赖 IK 模块异步加载）
    document.getElementById('ik-control-header')?.addEventListener('click', () => {
      const controls = document.getElementById('ik-controls');
      const title = document.querySelector('#ik-control-header h3');
      if (!controls || !title) return;
      const isHidden = controls.style.display === 'none' || !controls.style.display;
      controls.style.display = isHidden ? 'block' : 'none';
      title.textContent = isHidden ? i18n.t('ikControlOpen') : i18n.t('ikControl');
      if (isHidden) {
        this.notifyUrdfReady();
      }
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
            const maxFrame = this.trajectoryManager.getFrameCount() - 1;
            if (currentFrame < maxFrame) {
              this.timelineController.setCurrentFrame(currentFrame + 1);
            }
          }
          break;
      }
    });
  }

  setupFileDrop() {
    const overlay = document.getElementById('file-drop-overlay');
    let dragDepth = 0;

    const showOverlay = () => {
      if (overlay) overlay.hidden = false;
    };
    const hideOverlay = () => {
      dragDepth = 0;
      if (overlay) overlay.hidden = true;
    };

    const onDragEnter = (e) => {
      if (!hasFileTransfer(e.dataTransfer)) return;
      e.preventDefault();
      dragDepth++;
      if (dragDepth === 1) showOverlay();
    };

    const onDragOver = (e) => {
      if (!hasFileTransfer(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };

    const onDragLeave = (e) => {
      if (!hasFileTransfer(e.dataTransfer)) return;
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) hideOverlay();
    };

    const onDrop = async (e) => {
      if (!hasFileTransfer(e.dataTransfer)) return;
      e.preventDefault();
      hideOverlay();
      try {
        const files = await collectFilesFromDataTransfer(e.dataTransfer);
        await this.handleDroppedFiles(files);
      } catch (err) {
        console.error('拖放加载失败:', err);
        this.updateStatus(i18n.t('dropFailed'), 'error');
      }
    };

    const app = document.getElementById('app');
    if (app) {
      app.addEventListener('dragenter', onDragEnter);
      app.addEventListener('dragover', onDragOver);
      app.addEventListener('dragleave', onDragLeave);
      app.addEventListener('drop', onDrop);
    }
  }

  async handleDroppedFiles(files) {
    if (!files?.length) return;

    const { urdfFiles, csvFiles } = classifyDroppedFiles(files);

    if (urdfFiles.length === 0 && csvFiles.length === 0) {
      this.updateStatus(i18n.t('dropUnsupported'), 'error');
      return;
    }

    if (urdfFiles.length > 0) {
      await this.loadURDFFolder(files);
    }

    if (csvFiles.length > 0) {
      await this.loadCSV(csvFiles[0]);
    }
  }

  async loadURDFFolder(files) {
    console.log('========================================');
    console.log('📂 开始加载 URDF 文件夹...');
    console.log(`文件数量: ${files.length}`);
    this.updateStatus(i18n.t('loadingURDFFolder'), 'info');
    
    // 保存URDF文件名
    const urdfFile = Array.from(files).find(f => f.name.endsWith('.urdf'));
    if (urdfFile) {
      this.currentURDFFile = urdfFile.name;
      this.currentURDFFolder = urdfFile.webkitRelativePath ? 
        urdfFile.webkitRelativePath.split('/')[0] : '';
    }
    
    try {
      console.log('🔄 调用 urdfLoader.loadFromFolder()...');
      await this.urdfLoader.loadFromFolder(files);
      console.log('✅ urdfLoader.loadFromFolder() 完成');
      
      // 移除旧机器人
      if (this.robot) {
        console.log('🗑️ 移除旧机器人模型');
        this.scene.remove(this.robot);
      }

      // 加载并添加新机器人
      console.log('🔄 获取机器人模型...');
      this.robot = this.urdfLoader.getRobotModel();
      console.log('机器人模型:', this.robot);
      
      if (this.robot) {
        console.log('➕ 将机器人添加到两个场景...');
        
        // 为右侧场景使用原始机器人
        this.robotRight = this.robot;
        this.viewportManager.applyEditedRenderOrder(this.robotRight);
        
        // 为左侧场景创建第二个机器人实例
        console.log('🔄 为左侧场景创建第二个机器人实例...');
        const fileMapCopy = new Map(this.urdfLoader.fileMap);
        this.urdfLoader.loadFromMap(fileMapCopy, (leftRobot) => {
          this.robotLeft = leftRobot;
          this.viewportManager.applyGhostMaterialWhenReady(this.robotLeft);
          this.viewportManager.applyEditedRenderOrder(this.robotRight);
          this.viewportManager.attachRobots();
          console.log('✅ 左侧机器人模型已添加');
          
          // 如果已经加载了轨迹，更新左侧机器人状态
          if (this.trajectoryManager.hasTrajectory()) {
            const currentFrame = this.timelineController.getCurrentFrame();
            this.updateRobotState(currentFrame);
          }
          
          // 更新COM显示
          if (this.showCOM && this.comVisualizerLeft) {
            console.log('🎯 更新左侧COM显示');
            this.comVisualizerLeft.update(this.robotLeft);
          }
        });
        
        console.log('✅ 右侧机器人模型已添加到场景');
        
        // 初始化关节控制器
        console.log('🎮 初始化关节控制器...');
        const joints = this.urdfLoader.getJoints();
        console.log(`关节信息:`, joints);
        
        this.jointController = new JointController(joints, this);
        this.baseController = new BaseController(this);
        this.notifyUrdfReady();
        
        // 更新COM显示（无论是否有轨迹，都显示当前状态的COM）
        if (this.showCOM) {
          if (this.comVisualizerLeft && this.robotLeft) {
            console.log('🎯 更新左侧COM显示');
            this.comVisualizerLeft.update(this.robotLeft);
          }
          if (this.comVisualizerRight && this.robotRight) {
            console.log('🎯 更新右侧COM显示');
            this.comVisualizerRight.update(this.robotRight);
          }
        }
        
        console.log('✅ 关节控制面板已初始化');
        console.log('========================================');
        this.updateStatus(i18n.t('urdfLoadSuccess', { count: joints.length }), 'success');
        
        // 触发完整保存（包含 URDF）
        this.triggerAutoSave(true);
      } else {
        console.error('❌ 机器人模型为 null 或 undefined');
        throw new Error('机器人模型创建失败');
      }
    } catch (error) {
      console.error('========================================');
      console.error('❌ URDF 加载失败');
      console.error('错误类型:', error.constructor.name);
      console.error('错误信息:', error.message);
      console.error('错误堆栈:', error.stack);
      console.error('========================================');
      this.updateStatus(i18n.t('urdfLoadFailed'), 'error');
      alert(i18n.t('urdfLoadFailed') + ': ' + error.message);
    }
  }

  async loadCSV(file) {
    this.updateStatus(i18n.t('loadingCSVFile'), 'info');
    
    // 保存轨迹文件名
    this.trajectoryManager.currentFile = file.name;
    
    try {
      const text = await file.text();
      
      // 清理之前的所有操作
      console.log('🔄 清理之前的操作信息...');
      this.trajectoryManager.clearAllKeyframes();
      
      // 停止播放
      if (this.timelineController.isPlaying) {
        this.timelineController.pause();
      }
      
      // 解析CSV
      this.trajectoryManager.parseCSV(text, file.name);
      
      // 设置 FPS
      const defaultFPS = this.trajectoryManager.fps || 50;
      const fpsInput = prompt('请设置轨迹 FPS（帧率）:', String(defaultFPS));
      const fps = parseInt(fpsInput) || defaultFPS;
      this.trajectoryManager.setFPS(fps);
      this.timelineController.setFPS(fps);
      
      // 更新时间轴
      this.timelineController.updateTimeline(
        this.trajectoryManager.getFrameCount(),
        this.trajectoryManager.getFrameCount() / fps
      );
      
      // 清空关键帧标记
      this.timelineController.updateKeyframeMarkers([]);
      
      // 更新到第一帧
      this.timelineController.setCurrentFrame(0);
      this.updateRobotState(0);
      
      // 更新曲线编辑器
      if (this.curveEditor) {
        this.curveEditor.updateCurves();
      }
      
      const frameCount = this.trajectoryManager.getFrameCount();
      console.log('✅ CSV 加载成功, 帧数:', frameCount, 'FPS:', fps);
      console.log('📄 文件名:', file.name);
      this.updateStatus(i18n.t('csvLoadSuccess', { frames: frameCount, fps: fps }), 'success');
      
      // 更新文件名显示
      this.updateCurrentFileName(file.name, 'csv');
      
      // 触发自动保存
      this.triggerAutoSave();
    } catch (error) {
      console.error('CSV 加载失败:', error);
      this.updateStatus(i18n.t('csvLoadFailed'), 'error');
      alert(i18n.t('csvLoadFailed') + ': ' + error.message);
    }
  }

  captureRobotRightState() {
    return captureRobotState(this.robotRight, this.jointController);
  }

  restoreRobotRightState(snapshot) {
    restoreRobotState(this.robotRight, snapshot);
  }

  updateRobotState(frameIndex) {
    if ((!this.robotLeft && !this.robotRight) || !this.trajectoryManager.hasTrajectory()) {
      return;
    }
    
    // 检查 jointController 是否已初始化
    if (!this.jointController || !this.jointController.joints || this.jointController.joints.length === 0) {
      console.warn('⚠️ jointController 未初始化，跳过更新机器人状态');
      return;
    }

    // 获取原始状态和编辑后状态
    const baseState = this.trajectoryManager.getBaseState(frameIndex);
    const combinedState = this.trajectoryManager.getCombinedState(frameIndex);
    
    // 更新左侧机器人 (原始轨迹)
    if (this.robotLeft && baseState) {
      this.robotLeft.position.set(
        baseState.base.position.x,
        baseState.base.position.y,
        baseState.base.position.z
      );
      this.robotLeft.quaternion.set(
        baseState.base.quaternion.x,
        baseState.base.quaternion.y,
        baseState.base.quaternion.z,
        baseState.base.quaternion.w
      );
      
      // 更新左侧关节
      baseState.joints.forEach((value, index) => {
        if (index < this.jointController.joints.length) {
          const jointName = this.jointController.joints[index].name;
          this.robotLeft.setJointValue(jointName, value);
        }
      });
    }
    
    // 更新右侧机器人 (编辑后轨迹)
    if (this.robotRight && combinedState) {
      this.robotRight.position.set(
        combinedState.base.position.x,
        combinedState.base.position.y,
        combinedState.base.position.z
      );
      this.robotRight.quaternion.set(
        combinedState.base.quaternion.x,
        combinedState.base.quaternion.y,
        combinedState.base.quaternion.z,
        combinedState.base.quaternion.w
      );
      
      // 更新UI和右侧关节
      if (this.jointController) {
        this.jointController.updateJoints(combinedState.joints);
      }
      
      // 更新基体控制器显示
      if (this.baseController) {
        this.baseController.updateBase(combinedState.base.position, combinedState.base.quaternion);
      }
    }
        // 更新COM可视化
    if (this.showCOM) {
      if (this.comVisualizerLeft && this.robotLeft) {
        this.comVisualizerLeft.update(this.robotLeft);
      }
      if (this.comVisualizerRight && this.robotRight) {
        this.comVisualizerRight.update(this.robotRight);
      }
    }
        // 兼容旧代码
    this.robot = this.robotRight;
  }

  addKeyframe() {
    if (!this.jointController) {
      alert('请先加载 URDF 文件');
      return;
    }

    if (!this.trajectoryManager.hasTrajectory()) {
      alert('请先加载 CSV 轨迹');
      return;
    }

    const currentFrame = this.timelineController.getCurrentFrame();
    const currentJointValues = this.jointController.getCurrentJointValues();
    const currentBaseValues = this.baseController ? 
      this.baseController.getCurrentBaseValues() : null;
    
    const isNew = this.trajectoryManager.addKeyframe(currentFrame, currentJointValues, currentBaseValues);
    
    // 只有新关键帧才更新标记
    if (isNew) {
      const keyframes = Array.from(this.trajectoryManager.keyframes.keys());
      this.timelineController.updateKeyframeMarkers(keyframes);
      console.log('➕ 添加关键帧:', currentFrame);
    } else {
      console.log('🔄 关键帧已存在，已更新残差');
    }
    
    // 更新关键帧指示器
    if (this.jointController && this.jointController.updateKeyframeIndicators) {
      this.jointController.updateKeyframeIndicators();
    }
    if (this.baseController && this.baseController.updateKeyframeIndicators) {
      this.baseController.updateKeyframeIndicators();
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
    if (!this.trajectoryManager.hasTrajectory()) {
      alert('请先加载 CSV 轨迹');
      return;
    }

    const currentFrame = this.timelineController.getCurrentFrame();
    
    if (this.trajectoryManager.keyframes.has(currentFrame)) {
      this.trajectoryManager.removeKeyframe(currentFrame);
      
      // 更新时间轴上的关键帧标记
      const keyframes = Array.from(this.trajectoryManager.keyframes.keys());
      this.timelineController.updateKeyframeMarkers(keyframes);
      
      // 更新显示
      this.updateRobotState(currentFrame);
      
      // 更新关键帧指示器
      if (this.jointController && this.jointController.updateKeyframeIndicators) {
        this.jointController.updateKeyframeIndicators();
      }
      if (this.baseController && this.baseController.updateKeyframeIndicators) {
        this.baseController.updateKeyframeIndicators();
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
    if (!this.trajectoryManager.hasTrajectory()) {
      alert('请先加载 CSV 轨迹');
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
      const keyframesBetween = Array.from(this.trajectoryManager.keyframes.keys())
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
    const startKeyframe = this.trajectoryManager.keyframes.get(startFrame);
    const endKeyframe = this.trajectoryManager.keyframes.get(endFrame);

    // 计算起始和结束的叠加值（原始值 + 残差）
    const startOverlay = this.calculateOverlayValues(startFrame, startKeyframe);
    const endOverlay = this.calculateOverlayValues(endFrame, endKeyframe);

    // 对每个中间关键帧进行平滑
    middleFrames.forEach(frame => {
      const keyframe = this.trajectoryManager.keyframes.get(frame);
      
      // 计算插值比例
      const t = (frame - startFrame) / (endFrame - startFrame);
      
      // 对关节角度进行线性插值并计算新残差
      if (keyframe.residual && startOverlay.joints && endOverlay.joints) {
        for (let i = 0; i < keyframe.residual.length; i++) {
          // 线性插值叠加值
          const interpolatedOverlay = startOverlay.joints[i] + t * (endOverlay.joints[i] - startOverlay.joints[i]);
          
          // 获取该帧的原始关节角度
          const frameBaseState = this.trajectoryManager.getBaseState(frame);
          const baseJointValue = frameBaseState ? frameBaseState.joints[i] : 0;
          
          // 新残差 = 插值叠加值 - 原始值
          keyframe.residual[i] = interpolatedOverlay - baseJointValue;
        }
      }
      
      // 对基座位置进行线性插值并计算新残差
      if (keyframe.baseResidual && startOverlay.basePosition && endOverlay.basePosition) {
        const frameBaseState = this.trajectoryManager.getBaseState(frame);
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
        
        const frameBaseState = this.trajectoryManager.getBaseState(frame);
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
    const result = {
      joints: [],
      basePosition: { x: 0, y: 0, z: 0 },
      baseQuaternion: { x: 0, y: 0, z: 0, w: 1 }
    };

    // 计算关节角度叠加值
    const baseState = this.trajectoryManager.getBaseState(frame);
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

  async showTrajectoryExportFormatDialog() {
    return new Promise((resolve) => {
      const sourceFormat = this.trajectoryManager.resolveExportFormat('source');
      const currentFPS = this.trajectoryManager.fps || 50;
      const getDefaultFPSForFormat = (format) => {
        if (format === TRAJECTORY_FORMATS.SEED) {
          return DEFAULT_FPS_BY_FORMAT[TRAJECTORY_FORMATS.SEED];
        }

        return currentFPS;
      };
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
      ];

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
        const selectedFPS = Math.max(1, parseInt(fpsInput.value) || getDefaultFPSForFormat(selectedFormat));
        finish({ format: selectedFormat, fps: selectedFPS });
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
    if (!this.trajectoryManager.hasTrajectory()) {
      alert(i18n.t('needTrajectory'));
      return;
    }

    const exportOptions = await this.showTrajectoryExportFormatDialog();
    if (!exportOptions) {
      console.log(i18n.t('userCancel'));
      return;
    }

    const csv = this.trajectoryManager.exportCombinedTrajectory(exportOptions.format, exportOptions.fps);
    const defaultFileName = this.trajectoryManager.getExportFileName(exportOptions.format);
    
    // 让用户确认或修改文件名
    const fileName = prompt(i18n.t('exportFileName'), defaultFileName);
    if (!fileName) {
      console.log(i18n.t('userCancel'));
      return;
    }
    
    const finalFileName = this.downloadCSV(csv, fileName);
    
    console.log('✅ 轨迹已导出:', finalFileName);
    this.updateStatus(i18n.t('trajectoryExported'), 'success');
  }

  async exportBaseTrajectory() {
    if (!this.trajectoryManager.hasTrajectory()) {
      alert(i18n.t('needTrajectory'));
      return;
    }

    const exportOptions = await this.showTrajectoryExportFormatDialog();
    if (!exportOptions) {
      console.log(i18n.t('userCancel'));
      return;
    }

    const csv = this.trajectoryManager.exportBaseTrajectory(exportOptions.format, exportOptions.fps);
    const originalFileName = this.trajectoryManager.originalFileName || 'trajectory';
    const nameWithoutExt = originalFileName.replace(/\.csv$/i, '');
    const sourceFormat = this.trajectoryManager.resolveExportFormat('source');
    const formatSuffix = exportOptions.format === sourceFormat ? '' : `_${exportOptions.format}`;
    const defaultFileName = `${nameWithoutExt}_base${formatSuffix}.csv`;
    
    // 让用户确认或修改文件名
    const fileName = prompt(i18n.t('exportFileName'), defaultFileName);
    if (!fileName) {
      console.log(i18n.t('userCancel'));
      return;
    }
    
    const finalFileName = this.downloadCSV(csv, fileName);
    
    console.log('✅ 原始轨迹已导出:', finalFileName);
    this.updateStatus(i18n.t('baseTrajectoryExported'), 'success');
  }

  saveProject() {
    if (!this.trajectoryManager.hasTrajectory()) {
      alert('请先加载 CSV 轨迹');
      return;
    }

    const projectData = this.trajectoryManager.getProjectData();
    projectData.viewport = this.viewportManager.getSettingsForProject();
    if (this.ikPanel) {
      projectData.ik = this.ikPanel.getSettingsForProject();
    }
    const json = JSON.stringify(projectData, null, 2);
    
    const originalFileName = this.trajectoryManager.originalFileName || 'project';
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
    
    // 保存工程文件名
    this.currentProjectFile = file.name;

    try {
      const text = await file.text();
      const projectData = JSON.parse(text);
      
      // 清除当前所有数据
      this.trajectoryManager.clearAll();
      
      // 加载新数据
      this.trajectoryManager.loadProjectData(projectData);
      if (projectData.viewport) {
        this.viewportManager.applyProjectSettings(projectData.viewport);
      }
      if (projectData.ik) {
        this._pendingIkProjectSettings = projectData.ik;
        if (this.ikPanel) {
          this.ikPanel.applyProjectSettings(projectData.ik);
          this._pendingIkProjectSettings = null;
        }
      }
      
      // 如果有URDF，更新机器人状态
      if (this.robotLeft && this.robotRight) {
        // 更新时间轴
        const frameCount = this.trajectoryManager.getFrameCount();
        const duration = this.trajectoryManager.getDuration();
        this.timelineController.updateTimeline(frameCount, duration);
        this.timelineController.setFPS(this.trajectoryManager.fps || 50);
        
        // 更新关键帧标记
        const keyframes = Array.from(this.trajectoryManager.keyframes.keys());
        this.timelineController.updateKeyframeMarkers(keyframes);
        
        // 更新插值模式按钮显示
        if (this.curveEditor) {
          this.curveEditor.updateInterpolationButton();
        }
        
        // 更新到第一帧
        this.updateRobotState(0);
        this.timelineController.setCurrentFrame(0);
      } else {
        alert(i18n.t('needRobot'));
      }
      
      console.log('✅ 工程文件已加载:', file.name);
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

  /**
   * 恢复保存的状态（如果可用）
   */
  async restoreStateIfAvailable() {
    if (!this.cookieManager.isAutoSaveEnabled()) {
      console.log('📕 自动保存未启用，跳过状态恢复');
      return;
    }
    
    const stateInfo = this.cookieManager.getStateInfo();
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
    
    console.log('🔄 重置应用...');
    
    // 清除轨迹管理器
    if (this.trajectoryManager) {
      this.trajectoryManager.clearAll();
    }
    
    // 移除机器人模型
    if (this.robotLeft) {
      this.sceneLeft?.remove(this.robotLeft);
      this.viewportManager?.sceneMain?.remove(this.robotLeft);
      this.robotLeft = null;
    }
    if (this.robotRight) {
      this.sceneRight?.remove(this.robotRight);
      this.viewportManager?.sceneMain?.remove(this.robotRight);
      this.robotRight = null;
      this.robot = null;
    }
    this.viewportManager?.attachRobots();
    
    // 清除控制器
    if (this.jointController) {
      const container = document.getElementById('joint-controls');
      if (container) {
        container.innerHTML = '';
      }
      this.jointController = null;
    }
    
    if (this.baseController) {
      this.baseController = null;
    }
    
    // 重置时间轴
    if (this.timelineController) {
      this.timelineController.pause();
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
    // 更新按钮状态
    document.getElementById('toggle-camera-mode').textContent = i18n.t('rotate');
    document.getElementById('follow-robot').textContent = i18n.t('followOff');
    document.getElementById('follow-robot').style.background = 'var(--overlay-bg)';
    document.getElementById('follow-robot').style.borderColor = 'var(--border-primary)';
    document.getElementById('toggle-com').textContent = i18n.t('comOn');
    document.getElementById('toggle-com').style.background = 'rgba(255, 100, 100, 0.3)';
    document.getElementById('toggle-com').style.borderColor = 'rgba(255, 100, 100, 0.6)';
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
    this.viewportManager?.updateSceneBackgrounds(theme);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    if (!this.renderer || !this.controls) return;

    this.controls.update();

    if (this.viewportManager?.mode === 'overlay') {
      this.viewportManager.syncOverlayCameraFromActive();
    }

    // 跟随机器人平移
    if (this.followRobot && this.robotRight) {
      const robotPos = this.robotRight.position;
      this.controls.target.set(robotPos.x, robotPos.y, robotPos.z + 0.5);
    }

    this.viewportManager?.render();
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
  const dropdowns = document.querySelectorAll('.dropdown');
  
  dropdowns.forEach(dropdown => {
    const toggle = dropdown.querySelector('.dropdown-toggle');
    const menu = dropdown.querySelector('.dropdown-menu');
    
    if (!toggle || !menu) return;
    
    // 点击切换下拉菜单
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // 关闭其他下拉菜单
      document.querySelectorAll('.dropdown-menu.show').forEach(otherMenu => {
        if (otherMenu !== menu) {
          otherMenu.classList.remove('show');
        }
      });
      
      // 切换当前菜单
      menu.classList.toggle('show');
    });
    
    // 点击菜单项后关闭菜单
    menu.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        menu.classList.remove('show');
      });
    });
  });
  
  // 点击外部关闭所有下拉菜单
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) {
      document.querySelectorAll('.dropdown-menu.show').forEach(menu => {
        menu.classList.remove('show');
      });
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
