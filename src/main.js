import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { URDFLoader } from './urdfLoader.js';
import { TrajectoryManager } from './trajectoryManager.js';
import { JointController } from './jointController.js';
import { BaseController } from './baseController.js';
import { TimelineController } from './timelineController.js';
import { COMVisualizer } from './comVisualizer.js';
import { PalmVisualizer } from './palmVisualizer.js';
import { i18n } from './i18n.js';
import { ThemeManager } from './themeManager.js';
import { CurveEditor } from './curveEditor.js';
import { AxisGizmo } from './axisGizmo.js';
import { VideoExporter } from './videoExporter.js';

class RobotKeyframeEditor {
  constructor() {
    // 初始化主题管理器
    this.themeManager = new ThemeManager();
    this.themeManager.watchSystemTheme();
    
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
    this.palmVisualizerLeft = null;
    this.palmVisualizerRight = null;
    this.showPalm = true; // 默认显示掌心距离
    
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
    this.autoRefreshFootprint = false; // 自动刷新包络线开关，默认关闭
    this.footprintUpdateTimer = null; // 包络线更新防抖定时器
    this.defaultCameraPosition = new THREE.Vector3(3, 3, 2);
    this.defaultCameraTarget = new THREE.Vector3(0, 0, 0.5);

    this.init();
    this.setupEventListeners();
    this.animate();
  }

  updateStatus(message, type = 'info') {
    const statusText = document.getElementById('status-text');
    if (statusText) {
      statusText.textContent = message;
      statusText.style.color = type === 'error' ? 'var(--warning-color)' : 
                                type === 'success' ? 'var(--success-color)' : 'var(--text-tertiary)';
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
    this.palmVisualizerLeft = new PalmVisualizer(this.sceneLeft, document.getElementById('palm-distance-left'));
    this.palmVisualizerRight = new PalmVisualizer(this.sceneRight, document.getElementById('palm-distance-right'));
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
    const halfWidth = fullWidth / 2;
    const aspect = halfWidth / fullHeight;
    
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

    // 添加关键帧
    document.getElementById('add-keyframe').addEventListener('click', () => {
      this.addKeyframe();
    });

    // 删除当前关键帧
    document.getElementById('delete-keyframe').addEventListener('click', () => {
      this.deleteCurrentKeyframe();
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

    document.getElementById('toggle-palm').addEventListener('click', () => {
      this.togglePalm();
    });

    // 刷新地面投影包络线
    document.getElementById('refresh-footprint').addEventListener('click', () => {
      this.refreshFootprint();
    });

    // 切换自动刷新包络线
    document.getElementById('toggle-auto-refresh').addEventListener('click', () => {
      this.toggleAutoRefreshFootprint();
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
        this.sceneRight.add(this.robotRight);
        
        // 为左侧场景创建第二个机器人实例
        console.log('🔄 为左侧场景创建第二个机器人实例...');
        const fileMapCopy = new Map(this.urdfLoader.fileMap);
        this.urdfLoader.loadFromMap(fileMapCopy, (leftRobot) => {
          this.robotLeft = leftRobot;
          this.sceneLeft.add(this.robotLeft);
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

          this.updatePalmVisualizers();
        });
        
        console.log('✅ 右侧机器人模型已添加到场景');
        
        // 初始化关节控制器
        console.log('🎮 初始化关节控制器...');
        const joints = this.urdfLoader.getJoints();
        console.log(`关节信息:`, joints);
        
        this.jointController = new JointController(joints, this);
        this.baseController = new BaseController(this);
        
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

        this.updatePalmVisualizers();
        
        console.log('✅ 关节控制面板已初始化');
        console.log('========================================');
        this.updateStatus(i18n.t('urdfLoadSuccess', { count: joints.length }), 'success');
        alert(i18n.t('urdfLoadSuccess', { count: joints.length }));
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
      const fpsInput = prompt('请设置轨迹 FPS（帧率）:', '50');
      const fps = parseInt(fpsInput) || 50;
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
    } catch (error) {
      console.error('CSV 加载失败:', error);
      this.updateStatus(i18n.t('csvLoadFailed'), 'error');
      alert(i18n.t('csvLoadFailed') + ': ' + error.message);
    }
  }

  updateRobotState(frameIndex) {
    if ((!this.robotLeft && !this.robotRight) || !this.trajectoryManager.hasTrajectory()) {
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
        const jointName = this.jointController.joints[index].name;
        this.robotLeft.setJointValue(jointName, value);
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

    this.updatePalmVisualizers();
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
      
      console.log('删除关键帧:', currentFrame);
    } else {
      alert('当前帧不是关键帧');
    }
  }

  exportTrajectory() {
    if (!this.trajectoryManager.hasTrajectory()) {
      alert(i18n.t('needTrajectory'));
      return;
    }

    const csv = this.trajectoryManager.exportCombinedTrajectory();
    const defaultFileName = this.trajectoryManager.getExportFileName();
    
    // 让用户确认或修改文件名
    const fileName = prompt(i18n.t('exportFileName'), defaultFileName);
    if (!fileName) {
      console.log(i18n.t('userCancel'));
      return;
    }
    
    // 确保文件名以.csv结尾
    const finalFileName = fileName.endsWith('.csv') ? fileName : fileName + '.csv';
    
    // 创建下载
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = finalFileName;
    a.click();
    URL.revokeObjectURL(url);
    
    console.log('✅ 轨迹已导出:', finalFileName);
    this.updateStatus(i18n.t('trajectoryExported'), 'success');
  }

  exportBaseTrajectory() {
    if (!this.trajectoryManager.hasTrajectory()) {
      alert(i18n.t('needTrajectory'));
      return;
    }

    const csv = this.trajectoryManager.exportBaseTrajectory();
    const originalFileName = this.trajectoryManager.originalFileName || 'trajectory';
    const defaultFileName = originalFileName.replace(/\.csv$/i, '') + '_base.csv';
    
    // 让用户确认或修改文件名
    const fileName = prompt(i18n.t('exportFileName'), defaultFileName);
    if (!fileName) {
      console.log(i18n.t('userCancel'));
      return;
    }
    
    // 确保文件名以.csv结尾
    const finalFileName = fileName.endsWith('.csv') ? fileName : fileName + '.csv';
    
    // 创建下载
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = finalFileName;
    a.click();
    URL.revokeObjectURL(url);
    
    console.log('✅ 原始轨迹已导出:', finalFileName);
    this.updateStatus(i18n.t('baseTrajectoryExported'), 'success');
  }

  saveProject() {
    if (!this.trajectoryManager.hasTrajectory()) {
      alert('请先加载 CSV 轨迹');
      return;
    }

    const projectData = this.trajectoryManager.getProjectData();
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

  togglePalm() {
    this.showPalm = !this.showPalm;
    const button = document.getElementById('toggle-palm');

    if (this.showPalm) {
      button.textContent = i18n.t('palmOn');
      button.style.background = 'rgba(0, 212, 255, 0.25)';
      button.style.borderColor = 'rgba(0, 212, 255, 0.6)';
      this.updatePalmVisualizers();
      console.log('🖐 显示掌心距离');
    } else {
      button.textContent = i18n.t('palmOff');
      button.style.background = 'var(--overlay-bg)';
      button.style.borderColor = 'var(--border-primary)';
      if (this.palmVisualizerLeft) {
        this.palmVisualizerLeft.hide();
      }
      if (this.palmVisualizerRight) {
        this.palmVisualizerRight.hide();
      }
      console.log('🖐 隐藏掌心距离');
    }
  }

  updatePalmVisualizers() {
    if (!this.showPalm) {
      return;
    }

    if (this.palmVisualizerLeft && this.robotLeft) {
      this.palmVisualizerLeft.update(this.robotLeft);
    } else if (this.palmVisualizerLeft) {
      this.palmVisualizerLeft.hide();
    }

    if (this.palmVisualizerRight && this.robotRight) {
      this.palmVisualizerRight.update(this.robotRight);
    } else if (this.palmVisualizerRight) {
      this.palmVisualizerRight.hide();
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

  refreshFootprint() {
    if (!this.robotLeft && !this.robotRight) {
      alert(i18n.t('needRobot'));
      return;
    }
    
    console.log('👣 刷新地面投影包络线...');
    
    // 使用setTimeout实现异步计算，避免阻塞UI
    setTimeout(() => {
      if (this.comVisualizerLeft && this.robotLeft) {
        this.comVisualizerLeft.updateFootprint(this.robotLeft);
      }
      if (this.comVisualizerRight && this.robotRight) {
        this.comVisualizerRight.updateFootprint(this.robotRight);
      }
      console.log('✅ 地面投影包络线刷新完成');
    }, 0);
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
    
    // 渲染左侧视口 (原始轨迹)
    this.renderer.setViewport(0, 0, halfWidth, fullHeight);
    this.renderer.setScissor(0, 0, halfWidth, fullHeight);
    this.renderer.setScissorTest(true);
    this.renderer.render(this.sceneLeft, this.cameraLeft);
    
    // 渲染右侧视口 (编辑后轨迹)
    this.renderer.setViewport(halfWidth, 0, halfWidth, fullHeight);
    this.renderer.setScissor(halfWidth, 0, halfWidth, fullHeight);
    this.renderer.setScissorTest(true);
    this.renderer.render(this.sceneRight, this.cameraRight);
    
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

initDropdowns();
