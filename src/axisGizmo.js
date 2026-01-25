import * as THREE from 'three';

/**
 * 坐标轴指示器 - 显示在视口右下角，类似Blender
 */
export class AxisGizmo {
  constructor(editor, camera, controls, viewportSide = 'right') {
    this.editor = editor;
    this.camera = camera;
    this.controls = controls;
    this.viewportSide = viewportSide; // 'left' 或 'right'
    
    // 创建独立的场景和相机用于渲染指示器
    this.scene = new THREE.Scene();
    const frustumSize = 2;
    this.gizmoCamera = new THREE.OrthographicCamera(
      -frustumSize / 2,
      frustumSize / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      10
    );
    this.gizmoCamera.position.set(0, 0, 2);
    
    // 创建DOM容器
    this.container = this.createContainer();
    
    // 创建坐标轴
    this.axes = this.createAxes();
    
    // 交互状态
    this.hoveredAxis = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    
    this.setupEventListeners();
  }
  
  /**
   * 创建DOM容器
   */
  createContainer() {
    const container = document.createElement('div');
    container.id = `axis-gizmo-${this.viewportSide}`;
    container.style.cssText = `
      position: absolute;
      bottom: 20px;
      right: 20px;
      width: 80px;
      height: 80px;
      pointer-events: auto;
      cursor: pointer;
      z-index: 100;
    `;
    
    const viewport = document.getElementById('viewport');
    viewport.appendChild(container);
    
    return container;
  }
  
  /**
   * 创建坐标轴
   */
  createAxes() {
    const axes = {
      x: null,
      y: null,
      z: null
    };
    
    const axisLength = 0.8;
    const circleRadius = 0.15;
    
    // X轴 (红色)
    axes.x = this.createAxisWithCircle(
      new THREE.Vector3(axisLength, 0, 0),
      0xff3333,
      'X'
    );
    this.scene.add(axes.x);
    
    // Y轴 (绿色)
    axes.y = this.createAxisWithCircle(
      new THREE.Vector3(0, axisLength, 0),
      0x33ff33,
      'Y'
    );
    this.scene.add(axes.y);
    
    // Z轴 (蓝色)
    axes.z = this.createAxisWithCircle(
      new THREE.Vector3(0, 0, axisLength),
      0x3333ff,
      'Z'
    );
    this.scene.add(axes.z);
    
    return axes;
  }
  
  /**
   * 创建带圆圈的坐标轴
   */
  createAxisWithCircle(direction, color, label) {
    const group = new THREE.Group();
    group.userData.axis = label.toLowerCase();
    group.userData.direction = direction.clone();
    
    // 线段
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      direction
    ]);
    const lineMaterial = new THREE.LineBasicMaterial({ 
      color: color,
      linewidth: 2
    });
    const line = new THREE.Line(lineGeometry, lineMaterial);
    group.add(line);
    
    // 圆圈
    const circleGeometry = new THREE.CircleGeometry(0.15, 32);
    const circleMaterial = new THREE.MeshBasicMaterial({ 
      color: color,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide
    });
    const circle = new THREE.Mesh(circleGeometry, circleMaterial);
    circle.position.copy(direction);
    
    // 圆圈始终面向相机
    circle.lookAt(this.gizmoCamera.position);
    
    group.add(circle);
    group.userData.circle = circle;
    group.userData.color = color;
    
    return group;
  }
  
  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    this.container.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.container.addEventListener('click', (e) => this.onClick(e));
    this.container.addEventListener('mouseleave', () => this.onMouseLeave());
  }
  
  /**
   * 鼠标移动
   */
  onMouseMove(event) {
    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    this.raycaster.setFromCamera(this.mouse, this.gizmoCamera);
    
    const objects = [
      this.axes.x.userData.circle,
      this.axes.y.userData.circle,
      this.axes.z.userData.circle
    ];
    
    const intersects = this.raycaster.intersectObjects(objects);
    
    // 重置所有高亮
    ['x', 'y', 'z'].forEach(axis => {
      this.axes[axis].userData.circle.material.opacity = 0.6;
    });
    
    if (intersects.length > 0) {
      const intersected = intersects[0].object;
      intersected.material.opacity = 1.0;
      this.hoveredAxis = intersected.parent.userData.axis;
    } else {
      this.hoveredAxis = null;
    }
  }
  
  /**
   * 鼠标离开
   */
  onMouseLeave() {
    this.hoveredAxis = null;
    ['x', 'y', 'z'].forEach(axis => {
      this.axes[axis].userData.circle.material.opacity = 0.6;
    });
  }
  
  /**
   * 点击事件
   */
  onClick(event) {
    if (!this.hoveredAxis) return;
    
    // 根据点击的轴设置相机位置
    const distance = this.camera.position.distanceTo(this.controls.target);
    const offset = new THREE.Vector3();
    
    switch (this.hoveredAxis) {
      case 'x':
        offset.set(distance, 0, 0);
        break;
      case 'y':
        offset.set(0, distance, 0);
        break;
      case 'z':
        offset.set(0, 0, distance);
        break;
    }
    
    // 添加到目标位置
    const newPosition = this.controls.target.clone().add(offset);
    
    // 平滑过渡相机位置
    this.animateCameraToPosition(newPosition, this.controls.target);
  }
  
  /**
   * 平滑移动相机到指定位置
   */
  animateCameraToPosition(targetPosition, lookAtTarget) {
    const startPosition = this.camera.position.clone();
    const startTime = Date.now();
    const duration = 500; // 毫秒
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // 使用缓动函数
      const eased = this.easeInOutCubic(progress);
      
      this.camera.position.lerpVectors(startPosition, targetPosition, eased);
      this.controls.target.copy(lookAtTarget);
      
      // 同步左右相机（如果是双视口）
      if (this.viewportSide === 'right' && this.editor.cameraLeft) {
        this.editor.cameraLeft.position.copy(this.camera.position);
        this.editor.cameraLeft.quaternion.copy(this.camera.quaternion);
        this.editor.cameraLeft.zoom = this.camera.zoom;
        this.editor.cameraLeft.updateProjectionMatrix();
      }
      
      this.controls.update();
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    animate();
  }
  
  /**
   * 缓动函数
   */
  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  
  /**
   * 更新指示器（跟随相机旋转）
   */
  update() {
    // 让gizmo相机的观察方向与主相机完全一致
    // 这样gizmo场景中固定的XYZ轴就会显示出与主场景世界坐标系相同的方向
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.gizmoCamera.position.copy(direction).multiplyScalar(2);
    
    // 复制主相机的up向量，确保旋转一致
    this.gizmoCamera.up.copy(this.camera.up);
    this.gizmoCamera.lookAt(0, 0, 0);
    this.gizmoCamera.updateMatrixWorld();
    
    // 更新所有圆圈面向相机
    ['x', 'y', 'z'].forEach(axis => {
      const circle = this.axes[axis].userData.circle;
      circle.lookAt(this.gizmoCamera.position);
    });
  }
  
  /**
   * 渲染指示器
   */
  render(renderer) {
    // 保存当前渲染状态
    const currentRenderTarget = renderer.getRenderTarget();
    const currentAutoClear = renderer.autoClear;
    const currentScissorTest = renderer.getScissorTest();
    
    // 获取容器位置和大小
    const rect = this.container.getBoundingClientRect();
    const viewport = document.getElementById('viewport');
    const viewportRect = viewport.getBoundingClientRect();
    
    // 计算相对于viewport的位置
    const x = rect.left - viewportRect.left;
    const y = viewportRect.bottom - rect.bottom;
    const width = rect.width;
    const height = rect.height;
    
    // 设置视口和裁剪
    renderer.setViewport(x, y, width, height);
    renderer.setScissor(x, y, width, height);
    renderer.setScissorTest(true);
    renderer.autoClear = false;
    
    // 渲染指示器
    renderer.render(this.scene, this.gizmoCamera);
    
    // 恢复渲染状态
    renderer.setRenderTarget(currentRenderTarget);
    renderer.autoClear = currentAutoClear;
    renderer.setScissorTest(currentScissorTest);
  }
  
  /**
   * 销毁指示器
   */
  dispose() {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    
    // 清理场景
    this.scene.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(mat => mat.dispose());
        } else {
          object.material.dispose();
        }
      }
    });
  }
}
