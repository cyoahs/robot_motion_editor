import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { URDFLoader } from './urdfLoader.js';
import { TrajectoryManager } from './trajectoryManager.js';
import { JointController } from './jointController.js';
import { BaseController } from './baseController.js';
import { TimelineController } from './timelineController.js';

class RobotKeyframeEditor {
  constructor() {
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
    
    // 相机控制状态
    this.cameraMode = 'rotate'; // 'rotate' 或 'pan'
    this.followRobot = false;
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
      statusText.style.color = type === 'error' ? '#f48771' : 
                                type === 'success' ? '#4ec9b0' : '#858585';
    }
  }

  init() {
    // 创建左侧场景 (原始轨迹)
    this.sceneLeft = new THREE.Scene();
    this.sceneLeft.background = new THREE.Color(0x1a1a1a);
    
    // 创建右侧场景 (编辑后轨迹)
    this.sceneRight = new THREE.Scene();
    this.sceneRight.background = new THREE.Color(0x263238);
    
    // 兼容旧代码
    this.scene = this.sceneRight;

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

    // 窗口大小调整
    window.addEventListener('resize', () => {
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
    });
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

    // 导出轨迹
    document.getElementById('export-trajectory').addEventListener('click', () => {
      this.exportTrajectory();
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
    this.updateStatus('正在加载 URDF 文件夹...', 'info');
    
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
        });
        
        console.log('✅ 右侧机器人模型已添加到场景');
        
        // 初始化关节控制器
        console.log('🎮 初始化关节控制器...');
        const joints = this.urdfLoader.getJoints();
        console.log(`关节信息:`, joints);
        
        this.jointController = new JointController(joints, this);
        this.baseController = new BaseController(this);
        
        console.log('✅ 关节控制面板已初始化');
        console.log('========================================');
        this.updateStatus(`URDF 加载成功 (关节数: ${joints.length})`, 'success');
        alert(`URDF 加载成功！\n关节数: ${joints.length}`);
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
      this.updateStatus('URDF 加载失败', 'error');
      alert('URDF 加载失败: ' + error.message);
    }
  }

  async loadCSV(file) {
    this.updateStatus('正在加载 CSV 文件...', 'info');
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
      
      const frameCount = this.trajectoryManager.getFrameCount();
      console.log('✅ CSV 加载成功, 帧数:', frameCount, 'FPS:', fps);
      console.log('📄 文件名:', file.name);
      this.updateStatus(`CSV 加载成功 (帧数: ${frameCount}, FPS: ${fps})`, 'success');
    } catch (error) {
      console.error('CSV 加载失败:', error);
      this.updateStatus('CSV 加载失败', 'error');
      alert('CSV 加载失败: ' + error.message);
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
      
      console.log('删除关键帧:', currentFrame);
    } else {
      alert('当前帧不是关键帧');
    }
  }

  exportTrajectory() {
    if (!this.trajectoryManager.hasTrajectory()) {
      alert('请先加载 CSV 轨迹');
      return;
    }

    const csv = this.trajectoryManager.exportCombinedTrajectory();
    const defaultFileName = this.trajectoryManager.getExportFileName();
    
    // 让用户确认或修改文件名
    const fileName = prompt('请输入导出文件名:', defaultFileName);
    if (!fileName) {
      console.log('用户取消导出');
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
    this.updateStatus('轨迹已导出', 'success');
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
      document.getElementById('toggle-camera-mode').textContent = '↔️ 平移';
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
      document.getElementById('toggle-camera-mode').textContent = '🔄 旋转';
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
      
      button.textContent = '🤖 跟随: 开';
      button.style.background = 'rgba(78, 201, 176, 0.3)';
      console.log('🤖 开始跟随机器人');
      
      // 立即更新相机位置
      if (this.robotRight) {
        const robotPos = this.robotRight.position;
        this.controls.target.set(robotPos.x, robotPos.y, robotPos.z + 0.5);
        this.controls.update();
      }
    } else {
      button.textContent = '🤖 跟随: 关';
      button.style.background = 'rgba(0,0,0,0.7)';
      console.log('🤖 停止跟随机器人');
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
  }
}

// 启动应用
new RobotKeyframeEditor();
