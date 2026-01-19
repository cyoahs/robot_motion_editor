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
    
    // 曲线数据
    this.curves = new Map(); // key: "joint_${index}" 或 "base_${axis}", value: {visible, color, data}
    this.colors = [
      '#4ec9b0', '#f48771', '#ce9178', '#c586c0', '#9cdcfe',
      '#dcdcaa', '#4fc1ff', '#b5cea8', '#d7ba7d', '#c678dd'
    ];
    this.colorIndex = 0;
    
    // 交互状态
    this.draggingPoint = null; // {curveKey, keyframeIndex}
    this.hoveredPoint = null;
    
    this.setupUI();
    this.setupEventListeners();
  }

  setupUI() {
    // 创建画布
    this.canvas = document.getElementById('curve-canvas');
    if (!this.canvas) {
      console.error('Canvas not found');
      return;
    }
    this.ctx = this.canvas.getContext('2d');
    
    // 设置画布大小
    this.resizeCanvas();
  }

  setupEventListeners() {
    // 展开/折叠
    document.getElementById('curve-editor-header').addEventListener('click', (e) => {
      if (!e.target.closest('button')) {
        this.toggleExpand();
      }
    });
    
    // 恢复默认按钮
    document.getElementById('curve-reset-default').addEventListener('click', () => {
      this.resetToDefault();
    });
    
    // 画布交互
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    this.canvas.addEventListener('mouseleave', (e) => this.handleMouseLeave(e));
    
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
      
      this.draw();
      return;
    }
    
    // 更新关节曲线
    if (this.editor.jointController) {
      this.editor.jointController.joints.forEach((joint, index) => {
        const key = `joint_${index}`;
        
        // 检查是否有残差或基值
        let hasResidual = false;
        let hasData = false;
        for (const kf of keyframes) {
          if (kf.residuals && kf.residuals.joints && 
              Math.abs(kf.residuals.joints[index] || 0) > 0.001) {
            hasResidual = true;
            hasData = true;
            break;
          }
          if (kf.baseValues && kf.baseValues.joints && 
              kf.baseValues.joints[index] !== undefined) {
            hasData = true;
          }
        }
        
        if (!this.curves.has(key)) {
          this.curves.set(key, {
            name: joint.name || `Joint ${index + 1}`,
            type: 'joint',
            index: index,
            visible: hasResidual, // 默认显示有残差的曲线
            color: this.getNextColor(),
            data: []
          });
        }
      });
    }
    
    // 更新基体位置曲线
    ['x', 'y', 'z'].forEach((axis, index) => {
      const key = `base_pos_${axis}`;
      
      // 检查是否有残差或基值
      let hasResidual = false;
      let hasData = false;
      for (const kf of keyframes) {
        if (kf.residuals && kf.residuals.base && kf.residuals.base.position &&
            Math.abs(kf.residuals.base.position[axis] || 0) > 0.001) {
          hasResidual = true;
          hasData = true;
          break;
        }
        if (kf.baseValues && kf.baseValues.base && kf.baseValues.base.position &&
            kf.baseValues.base.position[axis] !== undefined) {
          hasData = true;
        }
      }
      
      if (!this.curves.has(key)) {
        this.curves.set(key, {
          name: `Base Position ${axis.toUpperCase()}`,
          type: 'base_position',
          axis: axis,
          visible: hasResidual,
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
   */
  toggleCurveVisibility(curveKey) {
    const curve = this.curves.get(curveKey);
    if (curve) {
      curve.visible = !curve.visible;
      
      // 更新关节控制面板的背景色
      if (this.editor.jointController && this.editor.jointController.updateCurveBackgrounds) {
        this.editor.jointController.updateCurveBackgrounds();
      }
      
      this.draw();
      return curve.visible;
    }
    return false;
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
    if (!this.isExpanded || !this.ctx) return;
    
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    
    // 清空画布
    this.ctx.clearRect(0, 0, width, height);
    
    // 绘制背景
    this.ctx.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg-secondary').trim();
    this.ctx.fillRect(0, 0, width, height);
    
    if (!this.editor.trajectoryManager || !this.editor.trajectoryManager.hasTrajectory()) {
      this.drawNoData();
      return;
    }
    
    const frameCount = this.editor.trajectoryManager.getFrameCount();
    const keyframes = this.editor.trajectoryManager.getKeyframes();
    
    console.log('Drawing curves:', {
      frameCount,
      keyframesCount: keyframes.length,
      curvesCount: this.curves.size,
      isExpanded: this.isExpanded
    });
    
    if (keyframes.length === 0) {
      console.log('No keyframes to draw');
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
    this.drawGrid(plotLeft, plotTop, plotWidth, plotHeight, frameCount, zoomLevel, scrollLeft);
    
    // 绘制关键帧竖线
    this.drawKeyframeLines(keyframes, plotLeft, plotTop, plotWidth, plotHeight, 
      frameCount, zoomLevel, scrollLeft);
    
    // 绘制当前帧竖线
    this.drawCurrentFrameLine(currentFrame, plotLeft, plotTop, plotWidth, plotHeight, 
      frameCount, zoomLevel, scrollLeft);
    
    // 绘制曲线
    this.drawCurves(plotLeft, plotTop, plotWidth, plotHeight, frameCount, 
      keyframes, zoomLevel, scrollLeft);
    
    // 绘制坐标轴
    this.drawAxes(plotLeft, plotTop, plotWidth, plotHeight);
  }

  drawNoData() {
    const width = this.canvas.width / (window.devicePixelRatio || 1);
    const height = this.canvas.height / (window.devicePixelRatio || 1);
    
    this.ctx.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--text-tertiary').trim();
    this.ctx.font = '14px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('请加载轨迹数据', width / 2, height / 2);
  }

  drawGrid(left, top, width, height, frameCount, zoomLevel, scrollLeft) {
    this.ctx.strokeStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--border-primary').trim();
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
    
    this.ctx.setLineDash([]);
  }

  drawKeyframeLines(keyframes, left, top, width, height, frameCount, zoomLevel, scrollLeft) {
    this.ctx.strokeStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--warning-color').trim();
    this.ctx.globalAlpha = 0.3;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([5, 5]);
    
    keyframes.forEach(kf => {
      const x = this.frameToX(kf.frame, left, width, frameCount, zoomLevel, scrollLeft);
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

  drawCurrentFrameLine(currentFrame, left, top, width, height, frameCount, zoomLevel, scrollLeft) {
    const x = this.frameToX(currentFrame, left, width, frameCount, zoomLevel, scrollLeft);
    
    if (x >= left && x <= left + width) {
      this.ctx.strokeStyle = getComputedStyle(document.documentElement)
        .getPropertyValue('--accent-info').trim();
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(x, top);
      this.ctx.lineTo(x, top + height);
      this.ctx.stroke();
    }
  }

  drawCurves(left, top, width, height, frameCount, keyframes, zoomLevel, scrollLeft) {
    // 找到所有可见曲线的值域
    let minValue = Infinity;
    let maxValue = -Infinity;
    
    this.curves.forEach((curve, key) => {
      if (!curve.visible) return;
      
      // 遍历所有帧来计算值域
      for (let frame = 0; frame < frameCount; frame += Math.max(1, Math.floor(frameCount / 500))) {
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
    
    // 添加一些边距
    const range = maxValue - minValue;
    const margin = range * 0.1 || 0.1;
    minValue -= margin;
    maxValue += margin;
    
    // 绘制每条曲线
    this.curves.forEach((curve, key) => {
      if (!curve.visible) return;
      
      // 绘制原始轨迹（绿色，较细）
      this.ctx.strokeStyle = '#4ec9b0'; // 绿色
      this.ctx.lineWidth = 1;
      this.ctx.globalAlpha = 0.5;
      this.ctx.beginPath();
      
      let firstPoint = true;
      const step = Math.max(1, Math.floor(frameCount / 1000)); // 采样步长
      
      for (let frame = 0; frame < frameCount; frame += step) {
        const value = this.getFrameValue(frame, curve, false); // 原始值
        if (value !== null) {
          const x = this.frameToX(frame, left, width, frameCount, zoomLevel, scrollLeft);
          const y = this.valueToY(value, top, height, minValue, maxValue);
          
          if (x >= left - 10 && x <= left + width + 10) {
            if (firstPoint) {
              this.ctx.moveTo(x, y);
              firstPoint = false;
            } else {
              this.ctx.lineTo(x, y);
            }
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
      for (let frame = 0; frame < frameCount; frame += step) {
        const value = this.getFrameValue(frame, curve, true); // 编辑后的值
        if (value !== null) {
          const x = this.frameToX(frame, left, width, frameCount, zoomLevel, scrollLeft);
          const y = this.valueToY(value, top, height, minValue, maxValue);
          
          if (x >= left - 10 && x <= left + width + 10) {
            if (firstPoint) {
              this.ctx.moveTo(x, y);
              firstPoint = false;
            } else {
              this.ctx.lineTo(x, y);
            }
          }
        }
      }
      
      this.ctx.stroke();
      
      // 绘制关键帧标记
      keyframes.forEach((kf) => {
        const value = this.getFrameValue(kf.frame, curve, true);
        if (value !== null) {
          const x = this.frameToX(kf.frame, left, width, frameCount, zoomLevel, scrollLeft);
          const y = this.valueToY(value, top, height, minValue, maxValue);
          
          if (x >= left && x <= left + width) {
            // 绘制关键帧点
            this.ctx.fillStyle = curve.color;
            this.ctx.beginPath();
            this.ctx.arc(x, y, 4, 0, Math.PI * 2);
            this.ctx.fill();
            
            // 白色边框
            this.ctx.strokeStyle = getComputedStyle(document.documentElement)
              .getPropertyValue('--bg-secondary').trim();
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
          }
        }
      });
    });
  }

  drawValueLabels(left, top, height, minValue, maxValue) {
    this.ctx.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--text-tertiary').trim();
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
    this.ctx.strokeStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--border-primary').trim();
    this.ctx.lineWidth = 1;
    
    // 绘制四边框
    this.ctx.beginPath();
    this.ctx.rect(left, top, width, height);
    this.ctx.stroke();
  }

  getKeyframeValue(keyframe, curve) {
    if (curve.type === 'joint') {
      // 优先使用残差，如果没有则使用基值
      if (keyframe.residuals?.joints?.[curve.index] !== undefined) {
        const baseValue = keyframe.baseValues?.joints?.[curve.index] || 0;
        const residual = keyframe.residuals.joints[curve.index];
        return baseValue + residual;
      } else if (keyframe.baseValues?.joints?.[curve.index] !== undefined) {
        return keyframe.baseValues.joints[curve.index];
      }
      console.log(`No value for joint ${curve.index}:`, keyframe);
    } else if (curve.type === 'base_position') {
      // 优先使用残差，如果没有则使用基值
      if (keyframe.residuals?.base?.position?.[curve.axis] !== undefined) {
        const baseValue = keyframe.baseValues?.base?.position?.[curve.axis] || 0;
        const residual = keyframe.residuals.base.position[curve.axis];
        return baseValue + residual;
      } else if (keyframe.baseValues?.base?.position?.[curve.axis] !== undefined) {
        return keyframe.baseValues.base.position[curve.axis];
      }
      console.log(`No value for base ${curve.axis}:`, keyframe);
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
    }
    
    return null;
  }

  frameToX(frame, left, width, frameCount, zoomLevel, scrollLeft) {
    // 参考timeline的关键帧标记实现，使用相同的缩放和滚动逻辑
    const timelineController = this.editor.timelineController;
    if (!timelineController) {
      return left + (frame / Math.max(frameCount - 1, 1)) * width;
    }
    
    // 获取timeline slider的位置信息
    const slider = document.getElementById('timeline-slider');
    if (!slider) {
      return left + (frame / Math.max(frameCount - 1, 1)) * width;
    }
    
    // 计算thumb的有效范围
    const oldValue = slider.value;
    slider.value = 0;
    const thumbPos0 = timelineController.getThumbPosition(slider);
    slider.value = slider.max;
    const thumbPosMax = timelineController.getThumbPosition(slider);
    slider.value = oldValue;
    
    const effectiveWidth = thumbPosMax - thumbPos0;
    const offset = thumbPos0;
    
    // 计算帧在slider上的位置
    const ratio = frame / Math.max(frameCount - 1, 1);
    const posInSlider = offset + ratio * effectiveWidth;
    
    // 映射到曲线画布
    return left + (posInSlider / slider.offsetWidth) * width;
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
    const timelineController = this.editor.timelineController;
    const zoomLevel = timelineController ? timelineController.zoomLevel : 1;
    const scrollLeft = document.getElementById('timeline-viewport')?.scrollLeft || 0;
    
    // 计算值域
    let minValue = Infinity;
    let maxValue = -Infinity;
    
    this.curves.forEach((curve) => {
      if (!curve.visible) return;
      keyframes.forEach(kf => {
        const value = this.getKeyframeValue(kf, curve);
        if (value !== null) {
          minValue = Math.min(minValue, value);
          maxValue = Math.max(maxValue, value);
        }
      });
    });
    
    if (minValue === Infinity) return null;
    
    const range = maxValue - minValue;
    const margin = range * 0.1 || 0.1;
    minValue -= margin;
    maxValue += margin;
    
    const hitRadius = 8;
    
    // 检查每条曲线的每个关键帧
    for (const [key, curve] of this.curves) {
      if (!curve.visible) continue;
      
      for (let kfIndex = 0; kfIndex < keyframes.length; kfIndex++) {
        const kf = keyframes[kfIndex];
        const value = this.getKeyframeValue(kf, curve);
        
        if (value !== null) {
          const px = this.frameToX(kf.frame, plotLeft, plotWidth, frameCount, zoomLevel, scrollLeft);
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
    
    // 更新残差
    if (curve.type === 'joint') {
      const baseValue = keyframe.baseValues?.joints?.[curve.index] || 0;
      const newResidual = newValue - baseValue;
      
      if (!keyframe.residuals) keyframe.residuals = {};
      if (!keyframe.residuals.joints) keyframe.residuals.joints = [];
      keyframe.residuals.joints[curve.index] = newResidual;
      
    } else if (curve.type === 'base_position') {
      const baseValue = keyframe.baseValues?.base?.position?.[curve.axis] || 0;
      const newResidual = newValue - baseValue;
      
      if (!keyframe.residuals) keyframe.residuals = {};
      if (!keyframe.residuals.base) keyframe.residuals.base = {};
      if (!keyframe.residuals.base.position) keyframe.residuals.base.position = {};
      keyframe.residuals.base.position[curve.axis] = newResidual;
    }
    
    // 更新时间轴控制器以触发机器人更新
    if (this.editor.timelineController) {
      const currentFrame = this.editor.timelineController.getCurrentFrame();
      this.editor.timelineController.updateFromSlider(currentFrame);
    }
  }
}
