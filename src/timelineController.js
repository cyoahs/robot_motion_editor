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
    
    this.setupUI();
  }

  setupUI() {
    const slider = document.getElementById('timeline-slider');
    
    slider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      this.setCurrentFrame(value);
    });
    
    // 添加关键帧标记容器
    const timeline = document.getElementById('timeline');
    const markerContainer = document.createElement('div');
    markerContainer.id = 'keyframe-markers';
    markerContainer.style.cssText = 'position: relative; height: 20px; margin-bottom: 10px;';
    timeline.insertBefore(markerContainer, slider);
  }

  updateTimeline(frameCount, duration) {
    this.frameCount = frameCount;
    this.duration = duration;
    
    const slider = document.getElementById('timeline-slider');
    slider.max = frameCount - 1;
    slider.value = 0;
    
    this.setCurrentFrame(0);
    
    document.getElementById('total-time').textContent = `总时长: ${duration.toFixed(2)}s`;
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
  }

  getCurrentFrame() {
    return this.currentFrame;
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
    const sliderWidth = slider.offsetWidth;
    
    keyframes.forEach(frameIndex => {
      const marker = document.createElement('div');
      marker.className = 'keyframe-marker';
      marker.style.cssText = `
        position: absolute;
        width: 8px;
        height: 20px;
        background: #4ec9b0;
        cursor: pointer;
        border-radius: 2px;
        left: ${(frameIndex / (this.frameCount - 1)) * sliderWidth}px;
        transform: translateX(-50%);
      `;
      marker.title = `关键帧 ${frameIndex} - 右键删除`;
      
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
  }

  play() {
    if (this.isPlaying || this.frameCount === 0) return;
    
    this.isPlaying = true;
    const playBtn = document.getElementById('play-pause');
    if (playBtn) playBtn.textContent = '⏸ 暂停';
    
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
    if (playBtn) playBtn.textContent = '▶ 播放';
    
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
