import { i18n } from './i18n.js';

/**
 * 曲线编辑器 - 可视化和编辑关节角度和基体状态随时间的变化
 */
export class CurveEditor {
  constructor(editor) {
    this.editor = editor;
    this.canvas = null;
    this.ctx = null;
    this.isExpanded = false;
    this.height = 200; // 展开时的高度
    this.padding = { left: 0, right: 0, top: 20, bottom: 30 };
    
    // 视图变换（缩放和平移）
    this.viewTransform = {
      offsetX: 0,      // X轴平移（帧数）
      scaleX: 1,       // X轴缩放
      offsetY: 0,      // Y轴平移（值域）
      scaleY: 1,       // Y轴缩放
      minScaleX: 0.1,  // X轴最小缩放
      maxScaleX: 10,   // X轴最大缩放
      minScaleY: 0.1,  // Y轴最小缩放
      maxScaleY: 10    // Y轴最大缩放
    };
    
    // 交互状态
    this.draggingPoint = null; // {curveKey, keyframeIndex}
    this.hoveredPoint = null;
    this.isPanning = false;    // 是否正在平移
    this.isBoxSelecting = false; // 是否正在框选
    this.panStart = null;      // 平移起始点
    this.boxSelectStart = null; // 框选起始点
    
    // 曲线数据
    this.curves = new Map(); // key: "joint_${index}" 或 "base_${axis}", value: {visible, color, data}
    this.colors = [
      '#4ec9b0', '#f48771', '#ce9178', '#c586c0', '#9cdcfe',
      '#dcdcaa', '#4fc1ff', '#b5cea8', '#d7ba7d', '#c678dd'
    ];
    this.colorIndex = 0;
    
    // 防抖定时器，用于优化绘制性能
    this.drawDebounceTimer = null;
    this.drawDebounceDelay = 16; // ~60fps
    
    // CSS 变量缓存 (Safari 性能优化)
    this.cachedStyles = {};
    this.cacheStyles();
    
    this.setupUI();
    this.setupEventListeners();
  }
  
  /**
   * 缓存常用的 CSS 变量值，避免频繁调用 getComputedStyle (Safari 优化)
   */
  cacheStyles() {
    const root = getComputedStyle(document.documentElement);
    this.cachedStyles = {
      bgPrimary: root.getPropertyValue('--bg-primary').trim(),
      textTertiary: root.getPropertyValue('--text-tertiary').trim(),
      borderPrimary: root.getPropertyValue('--border-primary').trim(),
      warningColor: root.getPropertyValue('--warning-color').trim(),
      accentInfo: root.getPropertyValue('--accent-info').trim(),
      bgSecondary: root.getPropertyValue('--bg-secondary').trim()
    };
  }

  setupUI() {
    // 创建画布
    this.canvas = document.getElementById('curve-canvas');
    if (!this.canvas) {
      console.error('Canvas not found');
      return;
    }
    this.ctx = this.canvas.getContext('2d');
    
    // 创建RPY按钮
    this.createRPYButtons();
    
    // 设置画布大小
    this.resizeCanvas();
  }
  
  /**
   * 创建RPY按钮
   */
  createRPYButtons() {
    const container = document.getElementById('rpy-buttons-container');
    if (!container) return;
    
    container.style.display = 'none'; // 默认隐藏
    container.style.flexDirection = 'row';
    
    const axes = [
      { key: 'base_euler_x', label: 'Roll', axis: 'x' },
      { key: 'base_euler_y', label: 'Pitch', axis: 'y' },
      { key: 'base_euler_z', label: 'Yaw', axis: 'z' }
    ];
    
    axes.forEach(({ key, label }) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.dataset.curveKey = key;
      btn.style.cssText = `
        padding: 2px 8px;
        font-size: 11px;
        background: var(--bg-input);
        color: var(--text-secondary);
        border: 1px solid var(--border-primary);
        border-radius: 3px;
        cursor: pointer;
        transition: all 0.2s ease;
      `;
      
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const curve = this.curves.get(key);
        if (curve) {
          curve.visible = !curve.visible;
          this.updateRPYButtonStyle(btn, curve.visible);
          this.draw();
        }
      });
      
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'var(--bg-tertiary)';
      });
      
      btn.addEventListener('mouseleave', () => {
        const curve = this.curves.get(key);
        this.updateRPYButtonStyle(btn, curve ? curve.visible : false);
      });
      
      container.appendChild(btn);
    });
  }
  
  /**
   * 更新RPY按钮样式
   */
  updateRPYButtonStyle(btn, isVisible) {
    const curveKey = btn.dataset.curveKey;
    const curve = this.curves.get(curveKey);
    
    if (isVisible && curve) {
      btn.style.background = curve.color;
      btn.style.color = '#ffffff';
      btn.style.borderColor = curve.color;
    } else {
      btn.style.background = 'var(--bg-input)';
      btn.style.color = 'var(--text-secondary)';
      btn.style.borderColor = 'var(--border-primary)';
    }
  }
  
  /**
   * 更新RPY按钮显示状态
   */
  updateRPYButtons() {
    const container = document.getElementById('rpy-buttons-container');
    if (!container) return;
    
    // 检查是否有任何欧拉角曲线可见
    const eulerX = this.curves.get('base_euler_x');
    const eulerY = this.curves.get('base_euler_y');
    const eulerZ = this.curves.get('base_euler_z');
    
    const hasEulerVisible = (eulerX && eulerX.visible) || 
                            (eulerY && eulerY.visible) || 
                            (eulerZ && eulerZ.visible);
    
    // 检查是否有其他曲线可见
    let hasOtherVisible = false;
    this.curves.forEach((curve, key) => {
      if (curve.visible && curve.type !== 'base_euler') {
        hasOtherVisible = true;
      }
    });
    
    // 只在显示欧拉角且没有其他曲线时显示RPY按钮
    if (hasEulerVisible && !hasOtherVisible) {
      container.style.display = 'flex';
      
      // 更新每个按钮的样式
      const buttons = container.querySelectorAll('button');
      buttons.forEach(btn => {
        const curveKey = btn.dataset.curveKey;
        const curve = this.curves.get(curveKey);
        this.updateRPYButtonStyle(btn, curve ? curve.visible : false);
      });
    } else {
      container.style.display = 'none';
    }
  }

  setupEventListeners() {
    // 展开/折叠
    document.getElementById('curve-editor-header').addEventListener('click', (e) => {
      // 不盔听 toggle switch 和按钮的点击
      if (!e.target.closest('button') && !e.target.closest('label') && !e.target.closest('input')) {
        this.toggleExpand();
      }
    });
    
    // 插值模式 Toggle Switch
    const interpolationToggle = document.getElementById('interpolation-mode-toggle');
    if (interpolationToggle) {
      interpolationToggle.addEventListener('change', (e) => {
        this.toggleInterpolationMode();
      });
      // 初始化 toggle 显示
      this.updateInterpolationButton();
    }
    
    // 恢复默认按钮
    document.getElementById('curve-reset-default').addEventListener('click', () => {
      this.resetToDefault();
    });
    
    // 重置缩放按钮
    document.getElementById('curve-reset-view')?.addEventListener('click', () => {
      this.resetView();
    });
    
    // 画布交互
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    this.canvas.addEventListener('mouseleave', (e) => this.handleMouseLeave(e));
    
    // 滚轮缩放
    this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
    
    // 触控板手势
    this.canvas.addEventListener('gesturestart', (e) => this.handleGestureStart(e));
    this.canvas.addEventListener('gesturechange', (e) => this.handleGestureChange(e));
    this.canvas.addEventListener('gestureend', (e) => this.handleGestureEnd(e));
    
    // 窗口大小改变
    window.addEventListener('resize', () => this.resizeCanvas());
    
    // 监听时间轴滚动事件
    const timelineViewport = document.getElementById('timeline-viewport');
    if (timelineViewport) {
      timelineViewport.addEventListener('scroll', () => this.draw());
    }
  }

  resizeCanvas() {
    if (!this.canvas) return;
    
    // 获取父容器的宽度
    const content = document.getElementById('curve-editor-content');
    if (!content) return;
    
    const rect = content.getBoundingClientRect();
    
    // 设置画布实际像素大小（考虑设备像素比）
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = this.height * dpr;
    
    // 设置画布显示大小
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = this.height + 'px';
    
    // 重置和缩放上下文以匹配设备像素比
    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(dpr, dpr);
    
    // 重新缓存样式 (主题可能变化)
    this.cacheStyles();
    
    this.draw();
  }

  toggleExpand() {
    this.isExpanded = !this.isExpanded;
    const content = document.getElementById('curve-editor-content');
    const header = document.getElementById('curve-editor-header');
    const toggleIcon = header.querySelector('.toggle-icon');
    
    if (this.isExpanded) {
      content.style.display = 'block';
      toggleIcon.textContent = '▼';
      this.resizeCanvas();
      this.updateCurves();
      this.draw();
    } else {
      content.style.display = 'none';
      toggleIcon.textContent = '▶';
    }
    
    // 等待布局更新后，重新计算渲染器尺寸
    setTimeout(() => {
      if (this.editor.handleResize) {
        this.editor.handleResize();
      }
    }, 50);
  }

  /**
   * 切换插值模式
   */
  toggleInterpolationMode() {
    const currentMode = this.editor.trajectoryManager.getInterpolationMode();
    const newMode = currentMode === 'linear' ? 'bezier' : 'linear';
    this.editor.trajectoryManager.setInterpolationMode(newMode);
    this.updateInterpolationButton();
    
    // 重新绘制曲线和更新机器人状态
    this.draw();
    if (this.editor.timelineController) {
      const currentFrame = this.editor.timelineController.getCurrentFrame();
      this.editor.updateRobotState(currentFrame);
    }
  }

  /**
   * 更新插值模式按钮显示
   */
  updateInterpolationButton() {
    const toggle = document.getElementById('interpolation-mode-toggle');
    if (!toggle) return;
    
    const mode = this.editor.trajectoryManager.getInterpolationMode();
    const isBezier = mode === 'bezier';
    
    // 更新 checkbox 状态（CSS 会自动处理样式）
    toggle.checked = isBezier;
  }

  /**
   * 更新曲线数据
   */
  updateCurves() {
    if (!this.editor.trajectoryManager || !this.editor.trajectoryManager.hasTrajectory()) {
      return;
    }
    
    const keyframes = this.editor.trajectoryManager.getKeyframes();
    
    // 如果有关键帧且当前是折叠状态，则展开
    if (keyframes.length > 0 && !this.isExpanded) {
      this.toggleExpand();
    }
    
    // 如果没有关键帧，清空曲线但保留定义
    if (keyframes.length === 0) {
      // 仍然定义曲线，但标记为不可见
      if (this.editor.jointController) {
        this.editor.jointController.joints.forEach((joint, index) => {
          const key = `joint_${index}`;
          if (!this.curves.has(key)) {
            this.curves.set(key, {
              name: joint.name || `Joint ${index + 1}`,
              type: 'joint',
              index: index,
              visible: false,
              color: this.getNextColor(),
              data: []
            });
          }
        });
      }
      
      ['x', 'y', 'z'].forEach((axis) => {
        const key = `base_pos_${axis}`;
        if (!this.curves.has(key)) {
          this.curves.set(key, {
            name: `Base Position ${axis.toUpperCase()}`,
            type: 'base_position',
            axis: axis,
            visible: false,
            color: this.getNextColor(),
            data: []
          });
        }
      });
      
      // 添加基体欧拉角曲线（用于可视化四元数）
      ['x', 'y', 'z'].forEach((axis) => {
        const key = `base_euler_${axis}`;
        if (!this.curves.has(key)) {
          this.curves.set(key, {
            name: `Base Euler ${axis.toUpperCase()}`,
            type: 'base_euler',
            axis: axis,
            visible: false,
            color: this.getNextColor(),
            data: []
          });
        }
      });
      
      this.draw();
      return;
    }
    
    // 更新关节曲线
    if (this.editor.jointController) {
      this.editor.jointController.joints.forEach((joint, index) => {
        const key = `joint_${index}`;
        
        // 检查是否有残差
        let hasResidual = false;
        for (const kf of keyframes) {
          if (kf.residual && Math.abs(kf.residual[index] || 0) > 0.001) {
            hasResidual = true;
            break;
          }
        }
        
        if (!this.curves.has(key)) {
          this.curves.set(key, {
            name: joint.name || `Joint ${index + 1}`,
            type: 'joint',
            index: index,
            visible: false, // 默认不显示
            color: this.getNextColor(),
            data: []
          });
        }
      });
    }
    
    // 更新基体位置曲线
    ['x', 'y', 'z'].forEach((axis, index) => {
      const key = `base_pos_${axis}`;
      
      // 检查是否有残差
      let hasResidual = false;
      for (const kf of keyframes) {
        if (kf.baseResidual && kf.baseResidual.position &&
            Math.abs(kf.baseResidual.position[axis] || 0) > 0.001) {
          hasResidual = true;
          break;
        }
      }
      
      if (!this.curves.has(key)) {
        this.curves.set(key, {
          name: `Base Position ${axis.toUpperCase()}`,
          type: 'base_position',
          axis: axis,
          visible: false, // 默认不显示
          color: this.getNextColor(),
          data: []
        });
      }
    });
    
    // 添加基体欧拉角曲线（用于可视化四元数）
    ['x', 'y', 'z'].forEach((axis) => {
      const key = `base_euler_${axis}`;
      if (!this.curves.has(key)) {
        this.curves.set(key, {
          name: `Base Euler ${axis.toUpperCase()}`,
          type: 'base_euler',
          axis: axis,
          visible: false, // 默认不显示
          color: this.getNextColor(),
          data: []
        });
      }
    });
  }

  getNextColor() {
    const color = this.colors[this.colorIndex % this.colors.length];
    this.colorIndex++;
    return color;
  }

  /**
   * 切换曲线可见性
   * @param {string} curveKey - 曲线键名
   * @param {boolean} shiftKey - 是否按住Shift键（多选模式）
   */
  toggleCurveVisibility(curveKey, shiftKey = false) {
    const curve = this.curves.get(curveKey);
    if (!curve) return false;
    
    const isEulerCurve = curve.type === 'base_euler';
    
    if (shiftKey) {
      // Shift+点击：切换当前曲线，但要确保欧拉角和其他曲线不混合
      if (isEulerCurve) {
        // 如果是欧拉角曲线，先隐藏所有非欧拉角曲线
        this.curves.forEach((c) => {
          if (c.type !== 'base_euler') {
            c.visible = false;
          }
        });
      } else {
        // 如果是其他曲线，先隐藏所有欧拉角曲线
        this.curves.forEach((c) => {
          if (c.type === 'base_euler') {
            c.visible = false;
          }
        });
      }
      curve.visible = !curve.visible;
    } else {
      // 普通点击：只显示当前曲线，隐藏其他所有曲线
      const wasVisible = curve.visible;
      this.curves.forEach((c) => {
        c.visible = false;
      });
      // 切换当前曲线状态
      curve.visible = !wasVisible;
    }
    
    // 更新RPY按钮
    this.updateRPYButtons();
    
    // 更新关节控制面板的背景色
    if (this.editor.jointController && this.editor.jointController.updateCurveBackgrounds) {
      this.editor.jointController.updateCurveBackgrounds();
    }
    
    // 更新基体控制面板的背景色
    if (this.editor.baseController && this.editor.baseController.updateCurveBackgrounds) {
      this.editor.baseController.updateCurveBackgrounds();
    }
    
    this.draw();
    return curve.visible;
  }
  
  /**
   * 切换四元数欧拉角可视化
   * @param {boolean} shiftKey - 是否按住Shift键（多选模式）
   */
  toggleQuaternionVisualization(shiftKey = false) {
    const eulerX = this.curves.get('base_euler_x');
    const eulerY = this.curves.get('base_euler_y');
    const eulerZ = this.curves.get('base_euler_z');
    
    if (!eulerX || !eulerY || !eulerZ) return false;
    
    if (shiftKey) {
      // Shift+点击：切换欧拉角曲线，不影响其他曲线
      const newVisible = !eulerX.visible && !eulerY.visible;
      eulerX.visible = newVisible;
      eulerY.visible = newVisible;
      eulerZ.visible = false; // Yaw默认不显示
    } else {
      // 普通点击：只显示欧拉角曲线，隐藏其他所有曲线
      const wasVisible = eulerX.visible || eulerY.visible;
      this.curves.forEach((curve) => {
        curve.visible = false;
      });
      // 切换欧拉角曲线状态 - 默认只显示Roll和Pitch
      const newVisible = !wasVisible;
      eulerX.visible = newVisible; // Roll
      eulerY.visible = newVisible; // Pitch
      eulerZ.visible = false; // Yaw默认不显示
      
      // 更新关节控制面板
      if (this.editor.jointController && this.editor.jointController.updateCurveBackgrounds) {
        this.editor.jointController.updateCurveBackgrounds();
      }
    }
    
    // 更新基体控制面板的背景色
    if (this.editor.baseController && this.editor.baseController.updateCurveBackgrounds) {
      this.editor.baseController.updateCurveBackgrounds();
    }
    
    // 更新RPY按钮
    this.updateRPYButtons();
    
    this.draw();
    return eulerX.visible;
  }
  
  /**
   * 隐藏四元数欧拉角可视化
   */
  hideQuaternionVisualization() {
    const eulerX = this.curves.get('base_euler_x');
    const eulerY = this.curves.get('base_euler_y');
    const eulerZ = this.curves.get('base_euler_z');
    
    if (eulerX) eulerX.visible = false;
    if (eulerY) eulerY.visible = false;
    if (eulerZ) eulerZ.visible = false;
    
    // 更新基体控制面板的背景色
    if (this.editor.baseController && this.editor.baseController.updateCurveBackgrounds) {
      this.editor.baseController.updateCurveBackgrounds();
    }
  }
  
  /**
   * 检查四元数可视化是否显示
   */
  isQuaternionVisualizationVisible() {
    const eulerX = this.curves.get('base_euler_x');
    return eulerX ? eulerX.visible : false;
  }

  /**
   * 获取曲线颜色
   */
  getCurveColor(curveKey) {
    const curve = this.curves.get(curveKey);
    return curve ? curve.color : null;
  }

  /**
   * 检查曲线是否可见
   */
  isCurveVisible(curveKey) {
    const curve = this.curves.get(curveKey);
    return curve ? curve.visible : false;
  }

  /**
   * 重置为默认显示（只显示有残差的曲线）
   */
  resetToDefault() {
    if (!this.editor.trajectoryManager || !this.editor.trajectoryManager.hasTrajectory()) {
      return;
    }
    
    const keyframes = this.editor.trajectoryManager.getKeyframes();
    
    this.curves.forEach((curve, key) => {
      let hasResidual = false;
      
      if (curve.type === 'joint') {
        for (const kf of keyframes) {
          if (kf.residual && Math.abs(kf.residual[curve.index] || 0) > 0.001) {
            hasResidual = true;
            break;
          }
        }
      } else if (curve.type === 'base_position') {
        for (const kf of keyframes) {
          if (kf.baseResidual && kf.baseResidual.position &&
              Math.abs(kf.baseResidual.position[curve.axis] || 0) > 0.001) {
            hasResidual = true;
            break;
          }
        }
      }
      
      curve.visible = hasResidual;
    });
    
    // 更新关节控制面板的背景颜色
    if (this.editor.jointController && this.editor.jointController.updateCurveBackgrounds) {
      this.editor.jointController.updateCurveBackgrounds();
    }
    
    // 更新基体控制面板的背景颜色
    if (this.editor.baseController && this.editor.baseController.updateCurveBackgrounds) {
      this.editor.baseController.updateCurveBackgrounds();
    }
    
    this.draw();
  }

  /**
   * 获取曲线颜色
   */
  getCurveColor(curveKey) {
    const curve = this.curves.get(curveKey);
    return curve ? curve.color : null;
  }

  /**
   * 检查曲线是否可见
   */
  isCurveVisible(curveKey) {
    const curve = this.curves.get(curveKey);
    return curve ? curve.visible : false;
  }

  /**
   * 绘制曲线
   */
  draw() {
    const drawStart = performance.now();
    
    if (!this.isExpanded || !this.ctx) return;
    
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    
    // 清空画布
    this.ctx.clearRect(0, 0, width, height);
    
    // 绘制背景
    this.ctx.fillStyle = this.cachedStyles.bgPrimary;
    this.ctx.fillRect(0, 0, width, height);
    
    if (!this.editor.trajectoryManager || !this.editor.trajectoryManager.hasTrajectory()) {
      this.drawNoData();
      return;
    }
    
    const frameCount = this.editor.trajectoryManager.getFrameCount();
    const keyframes = this.editor.trajectoryManager.getKeyframes();
    
    if (keyframes.length === 0) {
      this.drawNoData();
      return;
    }
    
    const currentFrame = this.editor.timelineController ? 
      this.editor.timelineController.getCurrentFrame() : 0;
    
    // 获取时间轴的缩放和滚动状态
    const timelineController = this.editor.timelineController;
    const zoomLevel = timelineController ? timelineController.zoomLevel : 1;
    const scrollLeft = document.getElementById('timeline-viewport')?.scrollLeft || 0;
    
    // 计算绘图区域
    const plotLeft = this.padding.left;
    const plotRight = width - this.padding.right;
    const plotTop = this.padding.top;
    const plotBottom = height - this.padding.bottom;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;
    
    // 绘制网格
    this.drawGrid(plotLeft, plotTop, plotWidth, plotHeight, frameCount);
    
    // 绘制关键帧竖线
    this.drawKeyframeLines(keyframes, plotLeft, plotTop, plotWidth, plotHeight, frameCount);
    
    // 绘制当前帧竖线
    this.drawCurrentFrameLine(currentFrame, plotLeft, plotTop, plotWidth, plotHeight, frameCount);
    
    // 绘制曲线
    this.drawCurves(plotLeft, plotTop, plotWidth, plotHeight, frameCount, keyframes);
    
    // 绘制坐标轴
    this.drawAxes(plotLeft, plotTop, plotWidth, plotHeight);
    
    // 绘制框选框
    if (this.isBoxSelecting && this.boxSelectStart && this.boxSelectEnd) {
      const x1 = Math.min(this.boxSelectStart.x, this.boxSelectEnd.x);
      const y1 = Math.min(this.boxSelectStart.y, this.boxSelectEnd.y);
      const x2 = Math.max(this.boxSelectStart.x, this.boxSelectEnd.x);
      const y2 = Math.max(this.boxSelectStart.y, this.boxSelectEnd.y);
      
      // 半透明填充
      this.ctx.fillStyle = 'rgba(100, 150, 255, 0.2)';
      this.ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      
      // 边框
      this.ctx.strokeStyle = '#6496ff';
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }
    
    const drawEnd = performance.now();
    console.log(`⏱️ curveEditor.draw() 耗时: ${(drawEnd - drawStart).toFixed(2)}ms`);
  }
  
  /**
   * 防抖版本的draw方法，用于频繁更新场景
   * 在短时间内多次调用只会执行最后一次
   */
  drawDebounced() {
    if (this.drawDebounceTimer) {
      clearTimeout(this.drawDebounceTimer);
    }
    this.drawDebounceTimer = setTimeout(() => {
      this.draw();
      this.drawDebounceTimer = null;
    }, this.drawDebounceDelay);
  }

  drawNoData() {
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    
    this.ctx.fillStyle = this.cachedStyles.textTertiary;
    this.ctx.font = '14px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('请加载轨迹数据', width / 2, height / 2);
  }

  drawGrid(left, top, width, height, frameCount) {
    this.ctx.strokeStyle = this.cachedStyles.borderPrimary;
    this.ctx.lineWidth = 0.5;
    this.ctx.setLineDash([2, 2]);
    
    // 横向网格线（值域）
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const y = top + (height / gridLines) * i;
      this.ctx.beginPath();
      this.ctx.moveTo(left, y);
      this.ctx.lineTo(left + width, y);
      this.ctx.stroke();
    }
    
    // 纵向网格线（时间）
    const frameStep = Math.max(1, Math.floor(frameCount / 10 / this.viewTransform.scaleX));
    for (let frame = 0; frame < frameCount; frame += frameStep) {
      const x = this.frameToX(frame, left, width, frameCount);
      if (x >= left && x <= left + width) {
        this.ctx.beginPath();
        this.ctx.moveTo(x, top);
        this.ctx.lineTo(x, top + height);
        this.ctx.stroke();
      }
    }
    
    this.ctx.setLineDash([]);
  }

  drawKeyframeLines(keyframes, left, top, width, height, frameCount) {
    this.ctx.strokeStyle = this.cachedStyles.warningColor;
    this.ctx.globalAlpha = 0.3;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([5, 5]);
    
    keyframes.forEach(kf => {
      const x = this.frameToX(kf.frame, left, width, frameCount);
      if (x >= left && x <= left + width) {
        this.ctx.beginPath();
        this.ctx.moveTo(x, top);
        this.ctx.lineTo(x, top + height);
        this.ctx.stroke();
      }
    });
    
    this.ctx.globalAlpha = 1;
    this.ctx.setLineDash([]);
  }

  drawCurrentFrameLine(currentFrame, left, top, width, height, frameCount) {
    const x = this.frameToX(currentFrame, left, width, frameCount);
    
    if (x >= left && x <= left + width) {
      this.ctx.strokeStyle = this.cachedStyles.accentInfo;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(x, top);
      this.ctx.lineTo(x, top + height);
      this.ctx.stroke();
    }
  }

  drawCurves(left, top, width, height, frameCount, keyframes) {
    // 计算可见帧范围 (只计算屏幕上实际显示的部分)
    const visibleFrameStart = Math.max(0, this.xToFrame(left, left, width, frameCount));
    const visibleFrameEnd = Math.min(frameCount - 1, this.xToFrame(left + width, left, width, frameCount));
    
    // 使用通用方法计算值域（已应用视图变换）
    const { minValue, maxValue } = this.calculateValueRange();
    
    // 防御性检查：确保值域有效
    if (!isFinite(minValue) || !isFinite(maxValue) || minValue >= maxValue) {
      console.warn('Invalid value range in drawCurves:', { minValue, maxValue, scale: this.viewTransform.scaleY, offset: this.viewTransform.offsetY });
      return;
    }
    
    // 绘制每条曲线
    this.curves.forEach((curve, key) => {
      if (!curve.visible) return;
      
      // 根据可见帧范围动态调整采样步长
      const visibleFrameCount = visibleFrameEnd - visibleFrameStart;
      const step = Math.max(1, Math.floor(visibleFrameCount / 500)); // 最多500个采样点
      
      // 绘制原始轨迹（绿色，较细）
      this.ctx.strokeStyle = '#4ec9b0';
      this.ctx.lineWidth = 1;
      this.ctx.globalAlpha = 0.5;
      this.ctx.beginPath();
      
      let firstPoint = true;
      for (let frame = visibleFrameStart; frame <= visibleFrameEnd; frame += step) {
        const value = this.getFrameValue(frame, curve, false);
        if (value !== null) {
          const x = this.frameToX(frame, left, width, frameCount);
          const y = this.valueToY(value, top, height, minValue, maxValue);
          
          if (firstPoint) {
            this.ctx.moveTo(x, y);
            firstPoint = false;
          } else {
            this.ctx.lineTo(x, y);
          }
        }
      }
      
      this.ctx.stroke();
      this.ctx.globalAlpha = 1;
      
      // 绘制编辑后的轨迹（曲线颜色，较粗）
      this.ctx.strokeStyle = curve.color;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      
      firstPoint = true;
      for (let frame = visibleFrameStart; frame <= visibleFrameEnd; frame += step) {
        const value = this.getFrameValue(frame, curve, true);
        if (value !== null) {
          const x = this.frameToX(frame, left, width, frameCount);
          const y = this.valueToY(value, top, height, minValue, maxValue);
          
          if (firstPoint) {
            this.ctx.moveTo(x, y);
            firstPoint = false;
          } else {
            this.ctx.lineTo(x, y);
          }
        }
      }
      
      this.ctx.stroke();
      
      // 绘制关键帧标记（欧拉角曲线不显示关键帧标记，因为它们只是可视化）
      if (curve.type !== 'base_euler') {
        keyframes.forEach((kf) => {
          const value = this.getFrameValue(kf.frame, curve, true);
          if (value !== null) {
            const x = this.frameToX(kf.frame, left, width, frameCount);
            const y = this.valueToY(value, top, height, minValue, maxValue);
            
            if (x >= left && x <= left + width) {
              // 绘制关键帧点
              this.ctx.fillStyle = curve.color;
              this.ctx.beginPath();
              this.ctx.arc(x, y, 4, 0, Math.PI * 2);
              this.ctx.fill();
              
              // 白色边框
              this.ctx.strokeStyle = this.cachedStyles.bgSecondary;
              this.ctx.lineWidth = 2;
              this.ctx.stroke();
            }
          }
        });
      }
    });
  }

  drawValueLabels(left, top, height, minValue, maxValue) {
    this.ctx.fillStyle = this.cachedStyles.textTertiary;
    this.ctx.font = '10px monospace';
    this.ctx.textAlign = 'right';
    this.ctx.textBaseline = 'middle';
    
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const value = maxValue - (maxValue - minValue) * (i / gridLines);
      const y = top + (height / gridLines) * i;
      this.ctx.fillText(value.toFixed(3), left - 5, y);
    }
  }

  drawAxes(left, top, width, height) {
    this.ctx.strokeStyle = this.cachedStyles.borderPrimary;
    this.ctx.lineWidth = 1;
    
    // 绘制四边框
    this.ctx.beginPath();
    this.ctx.rect(left, top, width, height);
    this.ctx.stroke();
  }

  getKeyframeValue(keyframe, curve) {
    if (curve.type === 'joint') {
      // 使用正确的数据结构：residual 是关节残差数组
      if (keyframe.residual && keyframe.residual[curve.index] !== undefined) {
        return keyframe.residual[curve.index];
      }
      return 0; // 没有残差返回0
    } else if (curve.type === 'base_position') {
      // 使用正确的数据结构：baseResidual.position
      if (keyframe.baseResidual && keyframe.baseResidual.position && 
          keyframe.baseResidual.position[curve.axis] !== undefined) {
        return keyframe.baseResidual.position[curve.axis];
      }
      return 0; // 没有残差返回0
    } else if (curve.type === 'base_euler') {
      // 欧拉角只用于可视化，不能被编辑，返回null使其不可点击
      return null;
    }
    return null;
  }

  /**
   * 获取指定帧的值（原始或编辑后）
   */
  getFrameValue(frame, curve, includeResiduals) {
    if (!this.editor.trajectoryManager) return null;
    
    if (curve.type === 'joint') {
      const baseState = this.editor.trajectoryManager.getBaseState(frame);
      if (!baseState || !baseState.joints) return null;
      
      const baseValue = baseState.joints[curve.index];
      if (baseValue === undefined) return null;
      
      if (!includeResiduals) {
        return baseValue;
      }
      
      // 加上插值后的残差
      const residual = this.editor.trajectoryManager.getInterpolatedResidual(frame);
      if (residual && residual[curve.index] !== undefined) {
        return baseValue + residual[curve.index];
      }
      
      return baseValue;
      
    } else if (curve.type === 'base_position') {
      const baseState = this.editor.trajectoryManager.getBaseState(frame);
      if (!baseState || !baseState.base || !baseState.base.position) return null;
      
      const baseValue = baseState.base.position[curve.axis];
      if (baseValue === undefined) return null;
      
      if (!includeResiduals) {
        return baseValue;
      }
      
      // 加上插值后的残差
      const residual = this.editor.trajectoryManager.getInterpolatedBaseResidual(frame);
      if (residual && residual.position && residual.position[curve.axis] !== undefined) {
        return baseValue + residual.position[curve.axis];
      }
      
      return baseValue;
      
    } else if (curve.type === 'base_euler') {
      // 欧拉角可视化：将四元数转换为欧拉角
      const baseState = this.editor.trajectoryManager.getBaseState(frame);
      if (!baseState || !baseState.base || !baseState.base.quaternion) return null;
      
      let quat = { ...baseState.base.quaternion };
      
      if (includeResiduals) {
        // 加上插值后的四元数残差
        const residual = this.editor.trajectoryManager.getInterpolatedBaseResidual(frame);
        if (residual && residual.quaternion) {
          // 四元数相乘：result = base * residual
          quat = this.multiplyQuaternions(quat, residual.quaternion);
        }
      }
      
      // 将四元数转换为欧拉角 (ZYX顺序，单位为度)
      const euler = this.quaternionToEuler(quat);
      return euler[curve.axis];
    }
    
    return null;
  }
  
  /**
   * 四元数相乘
   */
  multiplyQuaternions(q1, q2) {
    return {
      x: q1.w * q2.x + q1.x * q2.w + q1.y * q2.z - q1.z * q2.y,
      y: q1.w * q2.y - q1.x * q2.z + q1.y * q2.w + q1.z * q2.x,
      z: q1.w * q2.z + q1.x * q2.y - q1.y * q2.x + q1.z * q2.w,
      w: q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z
    };
  }
  
  /**
   * 四元数转欧拉角 (ZYX顺序，单位为度)
   */
  quaternionToEuler(quat) {
    const { x, y, z, w } = quat;
    
    // Roll (x-axis rotation)
    const sinr_cosp = 2 * (w * x + y * z);
    const cosr_cosp = 1 - 2 * (x * x + y * y);
    const roll = Math.atan2(sinr_cosp, cosr_cosp);
    
    // Pitch (y-axis rotation)
    const sinp = 2 * (w * y - z * x);
    let pitch;
    if (Math.abs(sinp) >= 1) {
      pitch = Math.sign(sinp) * Math.PI / 2; // Use 90 degrees if out of range
    } else {
      pitch = Math.asin(sinp);
    }
    
    // Yaw (z-axis rotation)
    const siny_cosp = 2 * (w * z + x * y);
    const cosy_cosp = 1 - 2 * (y * y + z * z);
    const yaw = Math.atan2(siny_cosp, cosy_cosp);
    
    // 转换为度
    return {
      x: roll * 180 / Math.PI,
      y: pitch * 180 / Math.PI,
      z: yaw * 180 / Math.PI
    };
  }

  frameToX(frame, left, width, frameCount) {
    if (frameCount <= 1) {
      return left + width / 2;
    }
    
    // 应用X轴变换
    const normalizedFrame = frame / (frameCount - 1); // 0-1范围
    const transformedFrame = (normalizedFrame - 0.5 - this.viewTransform.offsetX) * this.viewTransform.scaleX + 0.5;
    
    return left + transformedFrame * width;
  }
  
  /**
   * 将画布 x 坐标转换为帧号 (frameToX 的逆运算)
   * 用于计算可见帧范围
   */
  xToFrame(x, left, width, frameCount) {
    if (frameCount <= 1) {
      return 0;
    }
    
    // 从像素坐标转换到标准化坐标
    const normalizedX = (x - left) / width;
    
    // 反向应用X轴变换
    const transformedX = (normalizedX - 0.5) / this.viewTransform.scaleX + 0.5 + this.viewTransform.offsetX;
    
    // 转换为帧号
    const frame = transformedX * (frameCount - 1);
    return Math.round(Math.max(0, Math.min(frameCount - 1, frame)));
  }

  // 计算值域范围（应用视图变换）
  calculateValueRange() {
    if (!this.editor.trajectoryManager || !this.editor.trajectoryManager.hasTrajectory()) {
      return { minValue: -1, maxValue: 1 };
    }

    const keyframes = this.editor.trajectoryManager.getKeyframes();
    const frameCount = this.editor.trajectoryManager.getFrameCount();
    
    // 计算可见帧范围
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const plotLeft = this.padding.left;
    const plotWidth = width - this.padding.left - this.padding.right;
    
    const visibleFrameStart = Math.max(0, this.xToFrame(plotLeft, plotLeft, plotWidth, frameCount));
    const visibleFrameEnd = Math.min(frameCount - 1, this.xToFrame(plotLeft + plotWidth, plotLeft, plotWidth, frameCount));
    
    // 找到所有可见曲线的值域
    let minValue = Infinity;
    let maxValue = -Infinity;
    
    this.curves.forEach((curve) => {
      if (!curve.visible) return;
      
      // 采样可见帧范围
      const step = Math.max(1, Math.floor((visibleFrameEnd - visibleFrameStart) / 200));
      for (let frame = visibleFrameStart; frame <= visibleFrameEnd; frame += step) {
        const baseValue = this.getFrameValue(frame, curve, false);
        const modifiedValue = this.getFrameValue(frame, curve, true);
        
        if (baseValue !== null) {
          minValue = Math.min(minValue, baseValue);
          maxValue = Math.max(maxValue, baseValue);
        }
        if (modifiedValue !== null) {
          minValue = Math.min(minValue, modifiedValue);
          maxValue = Math.max(maxValue, modifiedValue);
        }
      }
    });
    
    // 如果没有数据，使用默认范围
    if (minValue === Infinity) {
      minValue = -1;
      maxValue = 1;
    }
    
    // 添加边距
    const range = maxValue - minValue;
    const margin = range * 0.1 || 0.1;
    minValue -= margin;
    maxValue += margin;
    
    // Y轴始终自适应，不应用缩放变换
    return { minValue, maxValue };
  }

  valueToY(value, top, height, minValue, maxValue) {
    const range = maxValue - minValue;
    const normalized = (value - minValue) / range;
    
    return top + height - normalized * height;
  }

  // 鼠标事件处理
  handleMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // 中键或 Shift+左键 开始平移
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      this.isPanning = true;
      this.panStart = { x, y };
      this.panStartOffsetX = this.viewTransform.offsetX;
      this.canvas.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }
    
    // Ctrl/Cmd+左键 开始框选
    if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
      this.isBoxSelecting = true;
      this.boxSelectStart = { x, y };
      this.canvas.style.cursor = 'crosshair';
      e.preventDefault();
      return;
    }
    
    // 检查是否点击了关键帧点
    const point = this.findPointAt(x, y);
    if (point) {
      this.draggingPoint = point;
      this.canvas.style.cursor = 'grabbing';
    }
  }

  handleMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // 处理平移（只平移X轴）
    if (this.isPanning && this.panStart) {
      const deltaX = x - this.panStart.x;
      const plotWidth = this.canvas.width / (window.devicePixelRatio || 1) - this.padding.left - this.padding.right;
      
      // 计算X的偏移量变化，考虑缩放
      const offsetDeltaX = deltaX / plotWidth / this.viewTransform.scaleX;
      
      this.viewTransform.offsetX = this.panStartOffsetX + offsetDeltaX;
      this.draw();
      return;
    }
    
    // 处理框选
    if (this.isBoxSelecting && this.boxSelectStart) {
      this.boxSelectEnd = { x, y };
      this.draw();
      return;
    }
    
    if (this.draggingPoint) {
      // 拖动关键帧点
      this.updatePointValue(this.draggingPoint, y);
      this.draw();
    } else {
      // 检查悬停
      const point = this.findPointAt(x, y);
      if (point !== this.hoveredPoint) {
        this.hoveredPoint = point;
        this.canvas.style.cursor = point ? 'pointer' : 'default';
        this.draw();
      }
    }
  }

  handleMouseUp(e) {
    // 结束框选 - 计算框选区域并缩放到该区域（只缩放X轴）
    if (this.isBoxSelecting && this.boxSelectStart && this.boxSelectEnd) {
      const x1 = Math.min(this.boxSelectStart.x, this.boxSelectEnd.x);
      const x2 = Math.max(this.boxSelectStart.x, this.boxSelectEnd.x);
      
      if (Math.abs(x2 - x1) > 10) { // 至少10像素宽度
        const frameCount = this.editor.trajectoryManager.getFrameCount();
        const width = this.canvas.width / (window.devicePixelRatio || 1);
        const plotLeft = this.padding.left;
        const plotWidth = width - this.padding.left - this.padding.right;
        
        const frame1 = this.xToFrame(x1, plotLeft, plotWidth, frameCount);
        const frame2 = this.xToFrame(x2, plotLeft, plotWidth, frameCount);
        const selectedFrameRange = Math.abs(frame2 - frame1);
        const selectedCenter = (frame1 + frame2) / 2;
        
        if (selectedFrameRange > 0 && isFinite(selectedFrameRange)) {
          const currentRange = frameCount - 1;
          const currentScale = this.viewTransform.scaleX || 1;
          
          // 计算新的缩放倍数
          const newScale = Math.max(1, (currentRange / selectedFrameRange) * currentScale);
          
          if (isFinite(newScale) && newScale >= 1) {
            this.viewTransform.scaleX = Math.min(this.viewTransform.maxScaleX, newScale);
            
            // 调整偏移使选中区域居中
            const normalizedCenter = selectedCenter / (frameCount - 1);
            this.viewTransform.offsetX = normalizedCenter - 0.5;
          }
        }
      }
      
      this.isBoxSelecting = false;
      this.boxSelectStart = null;
      this.boxSelectEnd = null;
      this.canvas.style.cursor = 'default';
      this.draw();
      return;
    }
    
    // 结束平移
    if (this.isPanning) {
      this.isPanning = false;
      this.panStart = null;
      this.panStartOffsetX = 0;
      this.canvas.style.cursor = 'default';
      return;
    }
    
    if (this.draggingPoint) {
      this.draggingPoint = null;
      this.canvas.style.cursor = 'default';
    }
  }

  handleMouseLeave(e) {
    if (this.draggingPoint) {
      this.draggingPoint = null;
    }
    if (this.hoveredPoint) {
      this.hoveredPoint = null;
      this.canvas.style.cursor = 'default';
      this.draw();
    }
  }

  findPointAt(x, y) {
    if (!this.editor.trajectoryManager || !this.editor.trajectoryManager.hasTrajectory()) {
      return null;
    }
    
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    const plotLeft = this.padding.left;
    const plotRight = width - this.padding.right;
    const plotTop = this.padding.top;
    const plotBottom = height - this.padding.bottom;
    const plotWidth = plotRight - plotLeft;
    const plotHeight = plotBottom - plotTop;
    
    const frameCount = this.editor.trajectoryManager.getFrameCount();
    const keyframes = this.editor.trajectoryManager.getKeyframes();
    
    // 使用通用方法计算值域（已应用视图变换）
    const { minValue, maxValue } = this.calculateValueRange();
    
    const hitRadius = 8;
    
    // 检查每条曲线的每个关键帧
    for (const [key, curve] of this.curves) {
      if (!curve.visible) continue;
      
      for (let kfIndex = 0; kfIndex < keyframes.length; kfIndex++) {
        const kf = keyframes[kfIndex];
        const value = this.getKeyframeValue(kf, curve);
        
        if (value !== null) {
          const px = this.frameToX(kf.frame, plotLeft, plotWidth, frameCount);
          const py = this.valueToY(value, plotTop, plotHeight, minValue, maxValue);
          
          const distance = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
          if (distance <= hitRadius) {
            return { curveKey: key, keyframeIndex: kfIndex, minValue, maxValue };
          }
        }
      }
    }
    
    return null;
  }

  updatePointValue(point, mouseY) {
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    const plotTop = this.padding.top;
    const plotBottom = height - this.padding.bottom;
    const plotHeight = plotBottom - plotTop;
    
    const curve = this.curves.get(point.curveKey);
    const keyframes = this.editor.trajectoryManager.getKeyframes();
    const keyframe = keyframes[point.keyframeIndex];
    
    // 从Y坐标计算新值
    const normalized = 1 - (mouseY - plotTop) / plotHeight;
    const range = point.maxValue - point.minValue;
    const newValue = point.minValue + normalized * range;
    
    // 更新残差 - 直接使用 residual 和 baseResidual
    const frameIndex = point.keyframe.frame;
    
    if (curve.type === 'joint') {
      // 对于关节，newValue 就是残差值
      if (!point.keyframe.residual) {
        point.keyframe.residual = new Array(this.editor.trajectoryManager.jointCount).fill(0);
      }
      point.keyframe.residual[curve.index] = newValue;
      
      // 更新 trajectoryManager 中的数据
      this.editor.trajectoryManager.keyframes.get(frameIndex).residual[curve.index] = newValue;
      
    } else if (curve.type === 'base_position') {
      // 对于基体位置，newValue 就是残差值
      if (!point.keyframe.baseResidual) {
        point.keyframe.baseResidual = {
          position: { x: 0, y: 0, z: 0 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 }
        };
      }
      if (!point.keyframe.baseResidual.position) {
        point.keyframe.baseResidual.position = { x: 0, y: 0, z: 0 };
      }
      point.keyframe.baseResidual.position[curve.axis] = newValue;
      
      // 更新 trajectoryManager 中的数据
      const kf = this.editor.trajectoryManager.keyframes.get(frameIndex);
      if (!kf.baseResidual) {
        kf.baseResidual = {
          position: { x: 0, y: 0, z: 0 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 }
        };
      }
      kf.baseResidual.position[curve.axis] = newValue;
    }
    
    // 更新时间轴控制器以触发机器人更新
    if (this.editor.timelineController) {
      const currentFrame = this.editor.timelineController.getCurrentFrame();
      this.editor.timelineController.updateFromSlider(currentFrame);
    }
  }

  // 滚轮缩放处理（只缩放X轴，Y轴自适应）
  handleWheel(event) {
    event.preventDefault();
    
    const delta = -event.deltaY;
    const zoomFactor = delta > 0 ? 1.1 : 0.9;
    
    const currentScale = this.viewTransform.scaleX || 1;
    const newScale = currentScale * zoomFactor;
    
    // 限制：最小缩放为1（显示完整X轴）
    if (newScale < 1) {
      return;
    }
    
    const clampedScale = Math.max(1, Math.min(this.viewTransform.maxScaleX, newScale));
    
    if (isFinite(clampedScale) && clampedScale > 0) {
      // 获取当前帧位置，以它为中心缩放
      const currentFrame = this.editor.timelineController ? 
        this.editor.timelineController.getCurrentFrame() : 0;
      const frameCount = this.editor.trajectoryManager ? 
        this.editor.trajectoryManager.getFrameCount() : 1;
      
      if (frameCount > 1) {
        // 计算当前帧的标准化位置（0-1）
        const normalizedFrame = currentFrame / (frameCount - 1);
        
        // 保存旧的缩放和偏移
        const oldScale = this.viewTransform.scaleX;
        const oldOffset = this.viewTransform.offsetX;
        
        // 应用新缩放
        this.viewTransform.scaleX = clampedScale;
        
        // 计算新的offsetX，使得当前帧的屏幕位置保持不变
        // 根据公式：viewPos = (normalizedFrame - 0.5 - offsetX) * scaleX + 0.5
        // 保持viewPos不变，求解新的offsetX
        this.viewTransform.offsetX = normalizedFrame - 0.5 - (normalizedFrame - 0.5 - oldOffset) * oldScale / clampedScale;
      } else {
        this.viewTransform.scaleX = clampedScale;
      }
      
      this.draw();
    }
  }

  // 手势缩放开始
  handleGestureStart(event) {
    event.preventDefault();
  }

  // 手势缩放变化
  handleGestureChange(event) {
    event.preventDefault();
  }

  // 手势缩放结束
  handleGestureEnd(event) {
    event.preventDefault();
  }

  // 坐标转换：像素Y坐标 -> 值空间坐标（用于鼠标交互）
  yToValue(y, minValue, maxValue) {
    const plotTop = 80;
    const plotHeight = this.canvas.height / (window.devicePixelRatio || 1) - plotTop - 50;
    const normalized = 1 - (y - plotTop) / plotHeight;
    
    return minValue + normalized * (maxValue - minValue);
  }



  // 重置视图变换
  resetView() {
    this.viewTransform.offsetX = 0;
    this.viewTransform.scaleX = 1;
    this.draw();
  }
}
