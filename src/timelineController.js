export class TimelineController {
  constructor(editor) {
    this.editor = editor;
    this.frameCount = 0;
    this.duration = 0;
    this.currentFrame = 0;
    this.fps = 50;
    this.keyframeMarkers = [];
    this.isPlaying = false;
    this.playInterval = null;
    this.zoomLevel = 1.0; // 缩放级别
    this.minZoom = 1.0;
    this.maxZoom = 10.0;
    
    this.setupUI();
  }

  setupUI() {
    const slider = document.getElementById('timeline-slider');
    
    slider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      this.setCurrentFrame(value);
    });
    
    // 缩放按钮
    document.getElementById('timeline-zoom-in').addEventListener('click', () => {
      this.setZoom(this.zoomLevel * 1.5);
    });
    
    document.getElementById('timeline-zoom-out').addEventListener('click', () => {
      this.setZoom(this.zoomLevel / 1.5);
    });
    
    document.getElementById('timeline-zoom-reset').addEventListener('click', () => {
      this.setZoom(1.0);
    });
    
    // 鼠标滚轮缩放（在时间轴区域）
    const viewport = document.getElementById('timeline-viewport');
    viewport.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        this.setZoom(this.zoomLevel * delta);
      }
    }, { passive: false });
    
    // 禁用所有触摸手势
    viewport.addEventListener('touchstart', (e) => {
      e.preventDefault();
    }, { passive: false });
    
    viewport.addEventListener('touchmove', (e) => {
      e.preventDefault();
    }, { passive: false });
    
    // 自定义滚动条
    this.setupCustomScrollbar();
  }
  
  setupCustomScrollbar() {
    const viewport = document.getElementById('timeline-viewport');
    const content = document.getElementById('timeline-content');
    const scrollbar = document.getElementById('timeline-scrollbar');
    const thumb = document.getElementById('timeline-scrollbar-thumb');
    
    let isDragging = false;
    let startX = 0;
    let startScrollLeft = 0;
    
    const updateThumb = () => {
      const viewportWidth = viewport.offsetWidth;
      const contentWidth = content.offsetWidth;
      
      if (contentWidth <= viewportWidth) {
        scrollbar.style.display = 'none';
        return;
      }
      
      scrollbar.style.display = 'block';
      const thumbWidth = (viewportWidth / contentWidth) * scrollbar.offsetWidth;
      thumb.style.width = thumbWidth + 'px';
      
      const scrollRatio = this.scrollLeft / (contentWidth - viewportWidth);
      const maxThumbLeft = scrollbar.offsetWidth - thumbWidth;
      thumb.style.left = (scrollRatio * maxThumbLeft) + 'px';
    };
    
    // 拖动滑块
    thumb.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startScrollLeft = this.scrollLeft || 0;
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const deltaX = e.clientX - startX;
      const scrollbar = document.getElementById('timeline-scrollbar');
      const thumb = document.getElementById('timeline-scrollbar-thumb');
      const content = document.getElementById('timeline-content');
      const viewport = document.getElementById('timeline-viewport');
      
      const thumbWidth = thumb.offsetWidth;
      const maxThumbLeft = scrollbar.offsetWidth - thumbWidth;
      const contentWidth = content.offsetWidth;
      const viewportWidth = viewport.offsetWidth;
      
      const scrollRatio = deltaX / maxThumbLeft;
      this.scrollLeft = startScrollLeft + scrollRatio * (contentWidth - viewportWidth);
      this.scrollLeft = Math.max(0, Math.min(contentWidth - viewportWidth, this.scrollLeft));
      
      this.updateContentPosition();
      updateThumb();
    });
    
    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
    
    // 点击滚动条轨道
    scrollbar.addEventListener('click', (e) => {
      if (e.target === thumb) return;
      
      const rect = scrollbar.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const scrollbar_el = document.getElementById('timeline-scrollbar');
      const thumb_el = document.getElementById('timeline-scrollbar-thumb');
      const content = document.getElementById('timeline-content');
      const viewport = document.getElementById('timeline-viewport');
      
      const thumbWidth = thumb_el.offsetWidth;
      const scrollRatio = (clickX - thumbWidth / 2) / (scrollbar_el.offsetWidth - thumbWidth);
      
      const contentWidth = content.offsetWidth;
      const viewportWidth = viewport.offsetWidth;
      this.scrollLeft = scrollRatio * (contentWidth - viewportWidth);
      this.scrollLeft = Math.max(0, Math.min(contentWidth - viewportWidth, this.scrollLeft));
      
      this.updateContentPosition();
      updateThumb();
    });
    
    this.scrollLeft = 0;
    this.updateScrollbar = updateThumb;
  }

  updateTimeline(frameCount, duration) {
    this.frameCount = frameCount;
    this.duration = duration;
    
    const slider = document.getElementById('timeline-slider');
    slider.max = frameCount - 1;
    slider.value = 0;
    
    this.setCurrentFrame(0);
    this.setZoom(1.0); // 重置缩放
    
    document.getElementById('total-time').textContent = `总时长: ${duration.toFixed(2)}s`;
  }

  updateContentPosition() {
    const content = document.getElementById('timeline-content');
    content.style.transform = `translateX(${-this.scrollLeft}px)`;
  }

  setZoom(zoom) {
    this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    
    const content = document.getElementById('timeline-content');
    const viewport = document.getElementById('timeline-viewport');
    
    // 保存当前滚动位置比例
    const oldContentWidth = content.offsetWidth;
    const scrollRatio = oldContentWidth > viewport.offsetWidth ? 
      this.scrollLeft / (oldContentWidth - viewport.offsetWidth) : 0;
    
    // 设置内容宽度
    content.style.width = `${this.zoomLevel * 100}%`;
    content.style.minWidth = `${this.zoomLevel * 100}%`;
    
    // 更新缩放显示
    document.getElementById('zoom-level').textContent = `缩放: ${this.zoomLevel.toFixed(1)}x`;
    
    // 恢复滚动位置
    setTimeout(() => {
      const newContentWidth = content.offsetWidth;
      if (newContentWidth > viewport.offsetWidth) {
        this.scrollLeft = scrollRatio * (newContentWidth - viewport.offsetWidth);
      } else {
        this.scrollLeft = 0;
      }
      this.updateContentPosition();
      if (this.updateScrollbar) this.updateScrollbar();
      this.updateKeyframeMarkers(Array.from(this.editor.trajectoryManager.keyframes.keys()));
    }, 0);
  }

  setCurrentFrame(frame) {
    this.currentFrame = Math.max(0, Math.min(frame, this.frameCount - 1));
    
    const slider = document.getElementById('timeline-slider');
    slider.value = this.currentFrame;
    
    const time = this.currentFrame / this.fps;
    document.getElementById('current-time').textContent = `时间: ${time.toFixed(2)}s`;
    document.getElementById('current-frame').textContent = `帧: ${this.currentFrame}`;
    
    // 控制删除按钮显示
    const deleteBtn = document.getElementById('delete-keyframe');
    if (deleteBtn && this.editor.trajectoryManager.keyframes.has(this.currentFrame)) {
      deleteBtn.style.display = 'block';
    } else if (deleteBtn) {
      deleteBtn.style.display = 'none';
    }
    
    // 更新机器人状态
    this.editor.updateRobotState(this.currentFrame);
    
    // 更新关键帧指示器
    if (this.editor.jointController && this.editor.jointController.updateKeyframeIndicators) {
      this.editor.jointController.updateKeyframeIndicators();
    }
    if (this.editor.baseController && this.editor.baseController.updateKeyframeIndicators) {
      this.editor.baseController.updateKeyframeIndicators();
    }
    
    // 更新曲线编辑器
    if (this.editor.curveEditor) {
      this.editor.curveEditor.draw();
    }
  }

  getCurrentFrame() {
    return this.currentFrame;
  }

  getThumbPosition(slider) {
    // 计算range input thumb的中心位置
    const rect = slider.getBoundingClientRect();
    const ratio = (slider.value - slider.min) / (slider.max - slider.min);
    
    // 使用CSS自定义属性或计算样式来获取thumb宽度
    // 如果无法获取，使用默认值16px（Chrome/Safari标准）
    let thumbWidth = 16;
    
    // 尝试从计算样式获取
    const style = window.getComputedStyle(slider);
    if (style.getPropertyValue('--thumb-width')) {
      thumbWidth = parseFloat(style.getPropertyValue('--thumb-width'));
    }
    
    const effectiveWidth = rect.width - thumbWidth;
    const thumbCenter = thumbWidth / 2 + ratio * effectiveWidth;
    
    return thumbCenter;
  }

  updateKeyframeMarkers(keyframes) {
    const container = document.getElementById('keyframe-markers');
    if (!container) return;
    
    // 清除旧标记
    container.innerHTML = '';
    this.keyframeMarkers = [];
    
    if (this.frameCount === 0) return;
    
    // 创建新标记
    const slider = document.getElementById('timeline-slider');
    const content = document.getElementById('timeline-content');
    
    // 等待DOM更新后获取宽度
    requestAnimationFrame(() => {
      // 使用slider的getBoundingClientRect来获取精确的可用宽度
      const sliderRect = slider.getBoundingClientRect();
      const sliderWidth = sliderRect.width;
      
      // 动态测量thumb的实际宽度
      // 通过计算slider在不同值时thumb中心的位置来反推
      const oldValue = slider.value;
      slider.value = 0;
      const thumbPos0 = this.getThumbPosition(slider);
      slider.value = slider.max;
      const thumbPosMax = this.getThumbPosition(slider);
      slider.value = oldValue;
      
      const effectiveWidth = thumbPosMax - thumbPos0;
      const offset = thumbPos0;
      
      keyframes.forEach(frameIndex => {
        const marker = document.createElement('div');
        marker.className = 'keyframe-marker';
        
        // 计算位置：使用有效宽度
        const progress = frameIndex / (this.frameCount - 1);
        const leftPos = offset + progress * effectiveWidth;
        
        marker.style.cssText = `
          position: absolute;
          width: 8px;
          height: 20px;
          background: #4ec9b0;
          cursor: pointer;
          border-radius: 2px;
          left: ${leftPos}px;
          transform: translateX(-50%);
          transition: background 0.2s, transform 0.2s;
        `;
        marker.title = `关键帧 ${frameIndex} - 右键删除`;
        
        // 鼠标悬停效果
        marker.addEventListener('mouseenter', () => {
          marker.style.background = '#6fd4bd';
          marker.style.transform = 'translateX(-50%) scale(1.2)';
        });
        
        marker.addEventListener('mouseleave', () => {
          marker.style.background = '#4ec9b0';
          marker.style.transform = 'translateX(-50%)';
        });
        
        // 点击跳转到关键帧
        marker.addEventListener('click', () => {
          this.setCurrentFrame(frameIndex);
        });
        
        // 右键删除关键帧
        marker.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (confirm(`确定删除关键帧 ${frameIndex}？`)) {
            this.editor.trajectoryManager.removeKeyframe(frameIndex);
            this.updateKeyframeMarkers(Array.from(this.editor.trajectoryManager.keyframes.keys()));
            this.editor.updateRobotState(this.currentFrame);
          }
        });
        
        container.appendChild(marker);
        this.keyframeMarkers.push(marker);
      });
    });
  }

  play() {
    if (this.isPlaying || this.frameCount === 0) return;
    
    this.isPlaying = true;
    const playBtn = document.getElementById('play-pause');
    if (playBtn) playBtn.textContent = i18n.t('pause');
    
    const frameTime = 1000 / this.fps;
    this.playInterval = setInterval(() => {
      let nextFrame = this.currentFrame + 1;
      if (nextFrame >= this.frameCount) {
        nextFrame = 0; // 循环播放
      }
      this.setCurrentFrame(nextFrame);
    }, frameTime);
  }

  pause() {
    if (!this.isPlaying) return;
    
    this.isPlaying = false;
    const playBtn = document.getElementById('play-pause');
    if (playBtn) playBtn.textContent = i18n.t('play');
    
    if (this.playInterval) {
      clearInterval(this.playInterval);
      this.playInterval = null;
    }
  }

  togglePlayPause() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  setFPS(fps) {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.pause();
    
    this.fps = fps;
    document.getElementById('fps-display').textContent = `FPS: ${fps}`;
    
    if (wasPlaying) this.play();
  }
}
