import { i18n } from './i18n.js';

/**
 * 视频导出器类
 * 用于将左右两个视口合并为16:9比例的视频并导出
 * 采用离线渲染模式：逐帧渲染整个轨迹
 */
export class VideoExporter {
  constructor(editor) {
    this.editor = editor;
    this.isExporting = false;
    this.canvas = null;
    this.ctx = null;
    this.stream = null;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.progressModal = null;
    this.progressBar = null;
    this.progressText = null;
    
    // 16:9 比例
    this.aspectRatio = 16 / 9;
    // 默认分辨率 1920x1080
    this.outputWidth = 1920;
    this.outputHeight = 1080;
    // 输出帧率
    this.fps = 30;
  }

  /**
   * 初始化录制画布
   */
  initCanvas() {
    if (this.canvas) return;
    
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.outputWidth;
    this.canvas.height = this.outputHeight;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  /**
   * 创建进度条UI
   */
  createProgressModal() {
    if (this.progressModal) return;
    
    // 创建模态框
    this.progressModal = document.createElement('div');
    this.progressModal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      z-index: 10001;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    
    // 创建内容容器
    const content = document.createElement('div');
    content.style.cssText = `
      background: var(--bg-secondary);
      border: 1px solid var(--border-primary);
      border-radius: 8px;
      padding: 30px;
      min-width: 400px;
      max-width: 500px;
    `;
    
    // 标题
    const title = document.createElement('h3');
    title.style.cssText = `
      margin: 0 0 20px 0;
      color: var(--text-secondary);
      font-size: 18px;
      text-align: center;
    `;
    title.textContent = '🎬 ' + i18n.t('exportingVideo');
    
    // 进度文本
    this.progressText = document.createElement('div');
    this.progressText.style.cssText = `
      color: var(--text-primary);
      font-size: 14px;
      margin-bottom: 5px;
      text-align: center;
    `;
    this.progressText.textContent = i18n.t('renderingFrames') + ' 0%';
    
    // 时间信息文本
    this.timeText = document.createElement('div');
    this.timeText.style.cssText = `
      color: var(--text-tertiary);
      font-size: 12px;
      margin-bottom: 10px;
      text-align: center;
    `;
    this.timeText.textContent = i18n.t('estimating') + '...';
    
    // 进度条容器
    const progressContainer = document.createElement('div');
    progressContainer.style.cssText = `
      width: 100%;
      height: 20px;
      background: var(--bg-primary);
      border: 1px solid var(--border-primary);
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 15px;
      position: relative;
    `;
    
    // 进度条
    this.progressBar = document.createElement('div');
    this.progressBar.style.cssText = `
      width: 0%;
      height: 100%;
      background: linear-gradient(90deg, #4ec9b0, #569cd6);
      transition: width 0.2s ease;
    `;
    
    progressContainer.appendChild(this.progressBar);
    
    // 取消按钮
    const cancelBtn = document.createElement('button');
    cancelBtn.style.cssText = `
      width: 100%;
      padding: 10px;
      background: var(--warning-color);
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
    `;
    cancelBtn.textContent = i18n.t('cancelExport');
    cancelBtn.onclick = () => this.cancelExport();
    
    content.appendChild(title);
    content.appendChild(this.progressText);
    content.appendChild(this.timeText);
    content.appendChild(progressContainer);
    content.appendChild(cancelBtn);
    this.progressModal.appendChild(content);
    document.body.appendChild(this.progressModal);
    
    // 初始化时间追踪
    this.startTime = null;
  }

  /**
   * 更新进度
   */
  updateProgress(current, total, stage = 'rendering') {
    const percent = Math.round((current / total) * 100);
    
    // 更新进度条
    if (this.progressBar) {
      this.progressBar.style.width = percent + '%';
    }
    
    // 更新进度文本
    if (this.progressText) {
      let text = '';
      if (stage === 'rendering') {
        text = i18n.t('renderingFrames') + ` ${percent}% (${current}/${total})`;
      } else if (stage === 'encoding') {
        text = i18n.t('encodingVideo') + ` ${percent}%`;
      }
      this.progressText.textContent = text;
    }
    
    // 更新剩余时间
    if (this.timeText && stage === 'rendering') {
      if (!this.startTime) {
        this.startTime = Date.now();
      }
      
      const elapsed = (Date.now() - this.startTime) / 1000; // 秒
      
      if (current > 0) {
        const timePerFrame = elapsed / current;
        const remaining = (total - current) * timePerFrame;
        
        if (remaining > 60) {
          const minutes = Math.floor(remaining / 60);
          const seconds = Math.round(remaining % 60);
          this.timeText.textContent = i18n.t('timeRemaining') + `: ${minutes}${i18n.t('minutes')} ${seconds}${i18n.t('seconds')}`;
        } else {
          this.timeText.textContent = i18n.t('timeRemaining') + `: ${Math.round(remaining)}${i18n.t('seconds')}`;
        }
      } else {
        this.timeText.textContent = i18n.t('estimating') + '...';
      }
    } else if (this.timeText && stage === 'encoding') {
      this.timeText.textContent = i18n.t('encodingPleaseWait') + '...';
    }
  }

  /**
   * 显示进度条
   */
  showProgress() {
    if (!this.progressModal) {
      this.createProgressModal();
    }
    this.progressModal.style.display = 'flex';
  }

  /**
   * 隐藏进度条
   */
  hideProgress() {
    if (this.progressModal) {
      this.progressModal.style.display = 'none';
    }
  }

  /**
   * 显示FPS选择对话框
   */
  async showFPSDialog() {
    return new Promise((resolve) => {
      // 获取CSV的帧率
      const csvFPS = this.editor.trajectoryManager.fps || 50;
      const csvFrameCount = this.editor.trajectoryManager.getFrameCount();
      
      // 创建对话框
      const dialog = document.createElement('div');
      dialog.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
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
        padding: 30px;
        min-width: 400px;
        max-width: 500px;
      `;
      
      const title = document.createElement('h3');
      title.style.cssText = `
        margin: 0 0 20px 0;
        color: var(--text-secondary);
        font-size: 18px;
      `;
      title.textContent = '⚙️ ' + (i18n.t('videoOptions') || '视频选项');
      
      // 选项1：使用CSV帧率
      const option1 = document.createElement('div');
      option1.style.cssText = `
        margin-bottom: 15px;
        padding: 15px;
        border: 2px solid var(--border-primary);
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
      `;
      option1.innerHTML = `
        <label style="cursor: pointer; display: flex; align-items: flex-start; gap: 10px;">
          <input type="radio" name="fps-option" value="csv" checked style="margin-top: 3px;">
          <div>
            <div style="color: var(--text-secondary); font-weight: bold; margin-bottom: 5px;">
              ${i18n.t('useCSVFPS')}
            </div>
            <div style="color: var(--text-tertiary); font-size: 13px;">
              ${i18n.t('csvInfo')}: ${csvFPS} FPS, ${csvFrameCount} ${i18n.t('frames')}
            </div>
          </div>
        </label>
      `;
      
      // 选项2：自定义帧率
      const option2 = document.createElement('div');
      option2.style.cssText = `
        margin-bottom: 20px;
        padding: 15px;
        border: 2px solid var(--border-primary);
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s;
      `;
      option2.innerHTML = `
        <label style="cursor: pointer; display: flex; align-items: flex-start; gap: 10px;">
          <input type="radio" name="fps-option" value="custom" style="margin-top: 3px;">
          <div style="flex: 1;">
            <div style="color: var(--text-secondary); font-weight: bold; margin-bottom: 8px;">
              ${i18n.t('useCustomFPS')}
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <input type="number" id="custom-fps-input" value="30" min="1" max="120" 
                style="width: 80px; padding: 5px; background: var(--bg-primary); 
                color: var(--text-primary); border: 1px solid var(--border-primary); 
                border-radius: 4px; font-size: 14px;" disabled>
              <span style="color: var(--text-tertiary); font-size: 13px;">FPS</span>
            </div>
          </div>
        </label>
      `;
      
      // 检测浏览器支持的格式并排序
      const formatOptions = [
        { 
          id: 'mp4', 
          label: 'MP4 (H.264)', 
          mimeTypes: ['video/mp4;codecs=h264', 'video/mp4;codecs=avc1.42E01E'],
          priority: 1
        },
        { 
          id: 'webm-vp9', 
          label: 'WebM (VP9)', 
          mimeTypes: ['video/webm;codecs=vp9'],
          priority: 2
        }
      ];
      
      // 过滤出浏览器支持的格式
      const supportedFormats = formatOptions.filter(format => {
        return format.mimeTypes.some(mime => MediaRecorder.isTypeSupported(mime));
      });
      
      // 如果没有支持的格式，显示错误
      if (supportedFormats.length === 0) {
        alert(i18n.t('browserNotSupportVideoExport') || '当前浏览器不支持视频导出功能');
        resolve(null);
        return;
      }
      
      // 视频格式选择
      const formatSection = document.createElement('div');
      formatSection.style.cssText = `
        margin-bottom: 20px;
        padding: 15px;
        background: var(--bg-secondary);
        border-radius: 6px;
        border: 1px solid var(--border-secondary);
      `;
      
      const formatTitle = document.createElement('div');
      formatTitle.style.cssText = `
        color: var(--text-secondary); 
        font-weight: bold; 
        margin-bottom: 10px;
      `;
      formatTitle.textContent = i18n.t('videoFormat');
      formatSection.appendChild(formatTitle);
      
      const formatOptionsContainer = document.createElement('div');
      formatOptionsContainer.style.cssText = `
        display: flex; 
        flex-direction: column;
        gap: 8px;
      `;
      
      // 生成格式选项（只显示支持的）
      supportedFormats.forEach((format, index) => {
        const label = document.createElement('label');
        label.style.cssText = `
          cursor: pointer; 
          display: flex; 
          align-items: center; 
          gap: 8px;
          padding: 5px;
          border-radius: 4px;
          transition: background 0.2s;
        `;
        label.innerHTML = `
          <input type="radio" name="format-option" value="${format.id}" ${index === 0 ? 'checked' : ''}>
          <span style="color: var(--text-primary);">${format.label}</span>
        `;
        formatOptionsContainer.appendChild(label);
      });
      
      formatSection.appendChild(formatOptionsContainer);
      
      // 视频选项（Overlay和元数据）
      const optionsSection = document.createElement('div');
      optionsSection.style.cssText = `
        margin-bottom: 20px;
        padding: 15px;
        background: var(--bg-secondary);
        border-radius: 6px;
        border: 1px solid var(--border-secondary);
      `;
      
      const optionsTitle = document.createElement('div');
      optionsTitle.style.cssText = `
        color: var(--text-secondary); 
        font-weight: bold; 
        margin-bottom: 10px;
      `;
      optionsTitle.textContent = i18n.t('videoOptions') || '视频选项';
      optionsSection.appendChild(optionsTitle);
      
      const optionsContainer = document.createElement('div');
      optionsContainer.style.cssText = `
        display: flex; 
        flex-direction: column;
        gap: 8px;
      `;
      
      // 时间帧数选项
      const timeFrameLabel = document.createElement('label');
      timeFrameLabel.style.cssText = `
        cursor: pointer; 
        display: flex; 
        align-items: center; 
        gap: 8px;
        padding: 5px;
      `;
      timeFrameLabel.innerHTML = `
        <input type="checkbox" id="add-time-frame" checked style="cursor: pointer;">
        <span style="color: var(--text-primary);">${i18n.t('addOverlay') || '添加时间和帧数标记'}</span>
      `;
      optionsContainer.appendChild(timeFrameLabel);
      
      // 详细信息选项
      const detailsLabel = document.createElement('label');
      detailsLabel.style.cssText = `
        cursor: pointer; 
        display: flex; 
        align-items: center; 
        gap: 8px;
        padding: 5px;
      `;
      detailsLabel.innerHTML = `
        <input type="checkbox" id="add-details" style="cursor: pointer;">
        <span style="color: var(--text-primary);">添加详细信息（URDF/轨迹/工程等）</span>
      `;
      optionsContainer.appendChild(detailsLabel);
      
      optionsSection.appendChild(optionsContainer);
      
      // 按钮容器
      const buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = `
        display: flex;
        gap: 10px;
      `;
      
      const confirmBtn = document.createElement('button');
      confirmBtn.style.cssText = `
        flex: 1;
        padding: 10px;
        background: var(--accent-primary);
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
      `;
      confirmBtn.textContent = i18n.t('confirm') || '确认';
      
      const cancelBtn = document.createElement('button');
      cancelBtn.style.cssText = `
        flex: 1;
        padding: 10px;
        background: var(--bg-tertiary);
        color: var(--text-primary);
        border: 1px solid var(--border-primary);
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
      `;
      cancelBtn.textContent = i18n.t('cancel') || '取消';
      
      buttonContainer.appendChild(confirmBtn);
      buttonContainer.appendChild(cancelBtn);
      
      content.appendChild(title);
      content.appendChild(option1);
      content.appendChild(option2);
      content.appendChild(formatSection);
      content.appendChild(optionsSection);
      content.appendChild(buttonContainer);
      dialog.appendChild(content);
      document.body.appendChild(dialog);
      
      // 交互逻辑
      const radio1 = option1.querySelector('input[type="radio"]');
      const radio2 = option2.querySelector('input[type="radio"]');
      const customInput = option2.querySelector('#custom-fps-input');
      const formatRadios = formatSection.querySelectorAll('input[name="format-option"]');
      
      // 点击选项1
      option1.addEventListener('click', () => {
        radio1.checked = true;
        customInput.disabled = true;
        option1.style.borderColor = 'var(--accent-primary)';
        option2.style.borderColor = 'var(--border-primary)';
      });
      
      // 点击选项2
      option2.addEventListener('click', () => {
        radio2.checked = true;
        customInput.disabled = false;
        customInput.focus();
        option2.style.borderColor = 'var(--accent-primary)';
        option1.style.borderColor = 'var(--border-primary)';
      });
      
      // 初始高亮
      option1.style.borderColor = 'var(--accent-primary)';
      
      // 确认按钮
      confirmBtn.addEventListener('click', () => {
        const selectedFPS = radio1.checked ? csvFPS : parseInt(customInput.value) || 30;
        const selectedFormat = Array.from(formatRadios).find(r => r.checked)?.value || 'mp4';
        const addTimeFrame = document.getElementById('add-time-frame').checked;
        const addDetails = document.getElementById('add-details').checked;
        document.body.removeChild(dialog);
        resolve({ 
          fps: selectedFPS, 
          format: selectedFormat,
          addTimeFrame: addTimeFrame,
          addDetails: addDetails
        });
      });
      
      // 取消按钮
      cancelBtn.addEventListener('click', () => {
        document.body.removeChild(dialog);
        resolve(null);
      });
      
      // ESC键取消
      const escHandler = (e) => {
        if (e.key === 'Escape') {
          document.body.removeChild(dialog);
          document.removeEventListener('keydown', escHandler);
          resolve(null);
        }
      };
      document.addEventListener('keydown', escHandler);
    });
  }

  /**
   * 开始导出视频
   */
  async startExport() {
    if (this.isExporting) return;
    
    if (!this.editor.robotLeft || !this.editor.robotRight) {
      alert(i18n.t('needRobotForVideo'));
      return;
    }
    
    if (!this.editor.trajectoryManager.hasTrajectory()) {
      alert(i18n.t('needTrajectory'));
      return;
    }
    
    // 显示FPS选择对话框
    const exportOptions = await this.showFPSDialog();
    if (exportOptions === null) {
      // 用户取消
      return;
    }
    
    this.fps = exportOptions.fps;
    this.selectedFormat = exportOptions.format;
    this.addTimeFrame = exportOptions.addTimeFrame;
    this.addDetails = exportOptions.addDetails;
    
    // 保存导出信息用于详细overlay
    this.exportInfo = {
      urdfFolder: this.editor.currentURDFFolder || '',
      urdfFile: this.editor.currentURDFFile || '',
      trajectoryFile: this.editor.trajectoryManager.currentFile || '',
      projectFile: this.editor.currentProjectFile || '',
      exportTime: new Date().toLocaleString('zh-CN', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      })
    };
    
    this.isExporting = true;
    this.recordedChunks = [];
    this.startTime = null; // 重置开始时间
    
    try {
      this.initCanvas();
      this.showProgress();
      
      // 初始化MediaRecorder进行流式编码
      await this.initMediaRecorder();
      
      // 保存当前状态
      const originalFrame = this.editor.timelineController.getCurrentFrame();
      const originalPlaying = this.editor.timelineController.isPlaying;
      
      // 停止播放
      if (originalPlaying) {
        this.editor.timelineController.pause();
      }
      
      // 计算总帧数
      const duration = this.editor.trajectoryManager.getDuration();
      const totalFrames = Math.ceil(duration * this.fps);
      
      // 开始录制，每100ms flush一次数据
      this.mediaRecorder.start(100);
      
      // 逐帧渲染并实时编码
      for (let i = 0; i < totalFrames; i++) {
        if (!this.isExporting) {
          // 用户取消
          break;
        }
        
        // 计算对应的帧索引
        const frameIndex = Math.round((i / this.fps) * this.editor.trajectoryManager.fps);
        
        // 更新时间轴
        this.editor.timelineController.setCurrentFrame(frameIndex);
        
        // 等待一帧以确保渲染完成
        await new Promise(resolve => requestAnimationFrame(resolve));
        
        // 捕获当前帧并绘制到canvas（流式编码会自动捕获）
        const currentTime = i / this.fps;
        this.captureFrameToCanvas(i, totalFrames, currentTime, duration);
        
        // 请求MediaRecorder捕获帧
        const track = this.stream.getVideoTracks()[0];
        if (track && track.requestFrame) {
          track.requestFrame();
        }
        
        // 每10帧更新一次进度
        if (i % 10 === 0 || i === totalFrames - 1) {
          this.updateProgress(i + 1, totalFrames, 'rendering');
        }
      }
      
      // 停止录制
      this.updateProgress(100, 100, 'encoding');
      await this.stopRecording();
      
      // 恢复原始状态
      this.editor.timelineController.setCurrentFrame(originalFrame);
      if (originalPlaying) {
        this.editor.timelineController.play();
      }
      
      if (this.isExporting && this.recordedChunks.length > 0) {
        // 保存视频
        this.saveVideo(this.recordedChunks);
      }
      
    } catch (error) {
      console.error('Export failed:', error);
      alert(i18n.t('exportFailed') + ': ' + error.message);
    } finally {
      this.isExporting = false;
      this.hideProgress();
      this.recordedChunks = [];
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
    }
  }

  /**
   * 取消导出
   */
  cancelExport() {
    this.isExporting = false;
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.hideProgress();
    this.recordedChunks = [];
    this.editor.updateStatus(i18n.t('exportCancelled'), 'info');
  }

  /**
   * 捕获当前帧到canvas（用于流式编码）
   */
  captureFrameToCanvas(currentFrame, totalFrames, currentTime, totalTime) {
    const renderer = this.editor.renderer;
    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;
    const halfWidth = canvasWidth / 2;
    
    // 保存原始渲染器状态
    const originalWidth = renderer.domElement.width;
    const originalHeight = renderer.domElement.height;
    
    // 临时设置渲染器大小为输出分辨率
    renderer.setSize(canvasWidth, canvasHeight, false);
    
    // 清除canvas
    this.ctx.fillStyle = '#1a1a1a';
    this.ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    
    // 渲染左侧场景
    renderer.clear();
    renderer.setViewport(0, 0, halfWidth, canvasHeight);
    renderer.setScissor(0, 0, halfWidth, canvasHeight);
    renderer.setScissorTest(true);
    renderer.render(this.editor.sceneLeft, this.editor.cameraLeft);
    
    // 渲染右侧场景
    renderer.setViewport(halfWidth, 0, halfWidth, canvasHeight);
    renderer.setScissor(halfWidth, 0, halfWidth, canvasHeight);
    renderer.setScissorTest(true);
    renderer.render(this.editor.sceneRight, this.editor.cameraRight);
    
    // 禁用scissor test
    renderer.setScissorTest(false);
    
    // 复制到录制canvas
    this.ctx.drawImage(renderer.domElement, 0, 0);
    
    // 添加overlay文字
    if ((this.addTimeFrame || this.addDetails) && currentFrame !== undefined) {
      this.drawOverlay(currentFrame, totalFrames, currentTime, totalTime);
    }
    
    // 恢复原始渲染器大小
    renderer.setSize(originalWidth, originalHeight, false);
    
    // 不返回ImageData，MediaRecorder会自动从 canvas stream 捕获
  }

  /**
   * 在视频上绘制overlay文字
   */
  drawOverlay(currentFrame, totalFrames, currentTime, totalTime) {
    const ctx = this.ctx;
    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;
    
    // 设置字体和样式 - 使用常规字体
    const fontSize = Math.round(canvasHeight / 45);
    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillStyle = '#000000';
    
    const padding = Math.round(fontSize * 0.8);
    const lineHeight = fontSize * 1.3;
    
    // 如果添加详细信息，显示四个角
    if (this.addDetails) {
      // 左上角：详细信息
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      let y = padding;
      if (this.exportInfo.urdfFolder || this.exportInfo.urdfFile) {
        const urdfPath = this.exportInfo.urdfFolder ? 
          `${this.exportInfo.urdfFolder}/${this.exportInfo.urdfFile}` : 
          this.exportInfo.urdfFile;
        ctx.fillText(`URDF: ${urdfPath}`, padding, y);
        y += lineHeight;
      }
      if (this.exportInfo.trajectoryFile) {
        ctx.fillText(`Trajectory: ${this.exportInfo.trajectoryFile}`, padding, y);
        y += lineHeight;
      }
      if (this.exportInfo.projectFile) {
        ctx.fillText(`Project: ${this.exportInfo.projectFile}`, padding, y);
        y += lineHeight;
      }
      if (this.exportInfo.exportTime) {
        ctx.fillText(`Export: ${this.exportInfo.exportTime}`, padding, y);
      }
      
      // 右上角：时间和帧数（两行）
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      const timeText = `Time: ${currentTime.toFixed(2)}s / ${totalTime.toFixed(2)}s`;
      const frameText = `Frame: ${currentFrame + 1} / ${totalFrames}`;
      ctx.fillText(timeText, canvasWidth - padding, padding);
      ctx.fillText(frameText, canvasWidth - padding, padding + lineHeight);
      
      // 左下角：Base Trajectory
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Base Trajectory', padding, canvasHeight - padding);
      
      // 右下角：Modified Trajectory
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Modified Trajectory', canvasWidth - padding, canvasHeight - padding);
    }
    // 如果只添加时间帧数，显示三个角（无左上角）
    else if (this.addTimeFrame) {
      // 右上角：时间和帧数（两行）
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      const timeText = `Time: ${currentTime.toFixed(2)}s / ${totalTime.toFixed(2)}s`;
      const frameText = `Frame: ${currentFrame + 1} / ${totalFrames}`;
      ctx.fillText(timeText, canvasWidth - padding, padding);
      ctx.fillText(frameText, canvasWidth - padding, padding + lineHeight);
      
      // 左下角：Base Trajectory
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Base Trajectory', padding, canvasHeight - padding);
      
      // 右下角：Modified Trajectory
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Modified Trajectory', canvasWidth - padding, canvasHeight - padding);
    }
  }

  /**
   * 初始化MediaRecorder进行流式编码
   */
  async initMediaRecorder() {
    this.stream = this.canvas.captureStream(0); // 0 fps = 手动添加帧
    
    // 根据用户选择的格式设置编码选项
    let mimeTypes;
    if (this.selectedFormat === 'mp4') {
      mimeTypes = [
        'video/mp4;codecs=h264',
        'video/mp4;codecs=avc1.42E01E'
      ];
    } else if (this.selectedFormat === 'webm-vp9') {
      mimeTypes = ['video/webm;codecs=vp9'];
    } else {
      // Fallback到全局优先级列表
      mimeTypes = [
        'video/mp4;codecs=h264',
        'video/mp4;codecs=avc1.42E01E',
        'video/webm;codecs=vp9'
      ];
    }
    
    let selectedMimeType = null;
    for (const mimeType of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        selectedMimeType = mimeType;
        console.log('Using codec:', mimeType);
        break;
      }
    }
    
    if (!selectedMimeType) {
      throw new Error(i18n.t('browserNotSupportVideoExport') || 'No supported video codec found');
    }
    
    const options = {
      mimeType: selectedMimeType,
      videoBitsPerSecond: 8000000
    };
    
    this.recordedChunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream, options);
    
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.recordedChunks.push(e.data);
        console.log('Chunk received:', e.data.size, 'bytes');
      }
    };
    
    this.mediaRecorder.onerror = (e) => {
      console.error('MediaRecorder error:', e);
    };
  }

  /**
   * 停止录制并等待完成
   */
  async stopRecording() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        resolve();
        return;
      }
      
      this.mediaRecorder.onstop = () => {
        resolve();
      };
      
      // 等待一小段时间确保所有帧都被录制
      setTimeout(() => {
        this.mediaRecorder.stop();
      }, 100);
    });
  }

  /**
   * 保存视频文件
   */
  saveVideo(chunks) {
    // 检测实际的视频类型
    const mimeType = this.mediaRecorder.mimeType || 'video/webm';
    const isMP4 = mimeType.includes('mp4');
    const extension = isMP4 ? 'mp4' : 'webm';
    
    console.log('Saving video with mimeType:', mimeType);
    console.log('Total chunks:', chunks.length);
    console.log('Total size:', chunks.reduce((sum, c) => sum + c.size, 0), 'bytes');
    
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    
    // 获取文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const defaultName = `robot_motion_${timestamp}.${extension}`;
    const fileName = prompt(i18n.t('exportVideoFileName'), defaultName);
    
    if (!fileName) {
      this.editor.updateStatus(i18n.t('userCancel'), 'info');
      URL.revokeObjectURL(url);
      return;
    }
    
    // 确保文件扩展名正确
    let finalFileName = fileName;
    if (!finalFileName.endsWith(`.${extension}`)) {
      finalFileName += `.${extension}`;
    }
    
    // 创建下载链接
    const a = document.createElement('a');
    a.href = url;
    a.download = finalFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // 清理
    setTimeout(() => URL.revokeObjectURL(url), 100);
    
    this.editor.updateStatus(i18n.t('videoExported'), 'success');
  }

  /**
   * 清理资源
   */
  dispose() {
    this.isExporting = false;
    if (this.canvas) {
      this.canvas = null;
      this.ctx = null;
    }
    if (this.progressModal && this.progressModal.parentNode) {
      this.progressModal.parentNode.removeChild(this.progressModal);
      this.progressModal = null;
    }
    this.frames = [];
  }
}
