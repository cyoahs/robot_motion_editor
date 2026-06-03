import { i18n } from './i18n.js';

export class TimelineController {
  constructor(editor) {
    this.editor = editor;
    this.frameCount = 0;
    this.duration = 0;
    this.currentFrame = 0;
    this.fps = 50;
    this.playbackRate = 1;
    this.keyframeMarkers = [];
    this.isPlaying = false;
    this.playInterval = null;
    this.zoomLevel = 1.0; // 1× = 视口内显示整段轨迹
    this.minZoom = 1.0;
    this.maxZoom = 50.0;
    this.selectedKeyframes = new Set(); // 选中的关键帧
    this._keyframeDragSession = null;
    this._keyframeContextMenu = null;
    /** @type {{ absolute: object, sourceFrame: number } | null} */
    this._keyframeClipboard = null;
    
    this.setupUI();
  }

  setupUI() {
    const slider = document.getElementById('timeline-slider');
    
    slider.addEventListener('input', (e) => {
      const value = parseInt(e.target.value);
      this.setCurrentFrame(value);
    });
    
    // 缩放按钮（以视口中心为锚点）
    document.getElementById('timeline-zoom-in')?.addEventListener('click', () => {
      this.setZoom(this.zoomLevel * 1.5, this._getViewportZoomAnchorX());
    });

    document.getElementById('timeline-zoom-out')?.addEventListener('click', () => {
      this.setZoom(this.zoomLevel / 1.5, this._getViewportZoomAnchorX());
    });

    document.getElementById('timeline-zoom-reset')?.addEventListener('click', () => {
      this.editor.timelineCurveViewSync?.resetBoth();
    });

    const viewport = document.getElementById('timeline-viewport');

    // 滚轮缩放 / Shift+滚轮平移（时间轴轨道区域，不含顶部控制按钮行）
    const timelineRoot = document.getElementById('timeline');
    timelineRoot?.addEventListener('wheel', (e) => {
      if (e.target.closest('#keyframe-controls')) return;
      this._onTimelineWheel(e);
    }, { passive: false });

    // 禁用所有触摸手势
    if (viewport) {
      viewport.addEventListener('touchstart', (e) => {
        e.preventDefault();
      }, { passive: false });

      viewport.addEventListener('touchmove', (e) => {
        e.preventDefault();
      }, { passive: false });
    }
    
    // 自定义滚动条
    this.setupCustomScrollbar();

    const rateSelect = document.getElementById('playback-rate');
    if (rateSelect) {
      rateSelect.addEventListener('change', () => {
        this.setPlaybackRate(parseFloat(rateSelect.value) || 1);
      });
    }

    const markersBar = document.getElementById('keyframe-markers');
    markersBar?.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.keyframe-marker')) return;
      e.preventDefault();
      this._showKeyframeContextMenu(e, this.currentFrame);
    });

    const fpsInput = document.getElementById('project-fps');
    if (fpsInput) {
      const commitFps = () => {
        if (fpsInput.disabled || !this.editor?.applyProjectFPS) return;
        this.editor.applyProjectFPS(fpsInput.value);
      };
      fpsInput.addEventListener('change', commitFps);
      fpsInput.addEventListener('blur', commitFps);
      fpsInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          fpsInput.blur();
        }
      });
    }
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
      this._syncCurveViewFromTimeline();
    });
    
    document.addEventListener('mouseup', () => {
      if (isDragging) {
        this._syncCurveViewFromTimeline();
      }
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
      this._syncCurveViewFromTimeline();
    });
    
    this.scrollLeft = 0;
    this.updateScrollbar = updateThumb;
  }

  updateTimeline(frameCount, duration) {
    this.frameCount = frameCount;
    this.duration = duration;
    
    const slider = document.getElementById('timeline-slider');
    slider.max = Math.max(0, frameCount - 1);
    slider.value = 0;
    
    this.setCurrentFrame(0);
    this.setZoom(1.0); // 重置缩放
    
    document.getElementById('total-time').textContent = `总时长: ${duration.toFixed(2)}s`;
    this.setTrajectoryFpsControlEnabled(frameCount > 0);
  }

  setTrajectoryFpsControlEnabled(enabled) {
    const fpsInput = document.getElementById('project-fps');
    if (fpsInput) fpsInput.disabled = !enabled;
  }

  syncFpsInputFromState() {
    const fps = this.editor?.trajectoryManager?.fps ?? this.fps ?? 50;
    this._syncFpsInput(fps);
  }

  _syncFpsInput(fps) {
    const fpsInput = document.getElementById('project-fps');
    if (fpsInput && document.activeElement !== fpsInput) {
      fpsInput.value = String(Math.round(fps));
    }
  }

  updateContentPosition() {
    const content = document.getElementById('timeline-content');
    content.style.transform = `translateX(${-this.scrollLeft}px)`;
  }

  _getViewportZoomAnchorX() {
    const viewport = document.getElementById('timeline-viewport');
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    return rect.left + rect.width / 2;
  }

  _normalizeWheelDelta(e) {
    let dy = e.deltaY;
    if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      dy *= 16;
    } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      const viewport = document.getElementById('timeline-viewport');
      dy *= viewport?.clientHeight || 400;
    }
    return dy;
  }

  _onTimelineWheel(e) {
    if (!this.frameCount || this.frameCount <= 1) return;

    const viewport = document.getElementById('timeline-viewport');
    const content = document.getElementById('timeline-content');
    if (!viewport || !content) return;

    const deltaY = this._normalizeWheelDelta(e);
    const useHorizontalPan =
      this.zoomLevel > this.minZoom &&
      (e.shiftKey || (Math.abs(e.deltaX) > Math.abs(deltaY) && Math.abs(e.deltaX) > 0));

    if (useHorizontalPan) {
      e.preventDefault();
      const panDelta = e.shiftKey ? deltaY : e.deltaX;
      const maxScroll = Math.max(0, content.offsetWidth - viewport.offsetWidth);
      this.scrollLeft = Math.max(0, Math.min(maxScroll, this.scrollLeft + panDelta));
      this.updateContentPosition();
      if (this.updateScrollbar) this.updateScrollbar();
      this._syncCurveViewFromTimeline();
      return;
    }

    if (Math.abs(deltaY) < 0.5) return;
    e.preventDefault();

    const factor = deltaY > 0 ? 0.92 : 1.08;
    this.setZoom(this.zoomLevel * factor, e.clientX);
  }

  /**
   * @param {number} zoom 目标缩放倍数（最小 1× 为整段轨迹适配视口宽度）
   * @param {number|null} anchorClientX 缩放锚点屏幕 X；null 则按滚动比例保持视口
   */
  setZoom(zoom, anchorClientX = null, options = {}) {
    const { skipCurveSync = false } = options;
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    if (Math.abs(newZoom - this.zoomLevel) < 1e-6 && anchorClientX == null) {
      return;
    }

    const content = document.getElementById('timeline-content');
    const viewport = document.getElementById('timeline-viewport');
    const oldContentWidth = content.offsetWidth;
    const viewportWidth = viewport.offsetWidth;
    const oldMaxScroll = Math.max(0, oldContentWidth - viewportWidth);
    const scrollRatio = oldMaxScroll > 0 ? this.scrollLeft / oldMaxScroll : 0;

    let anchorContentX = null;
    let pointerX = 0;
    if (anchorClientX != null) {
      const rect = viewport.getBoundingClientRect();
      pointerX = anchorClientX - rect.left;
      anchorContentX = this.scrollLeft + pointerX;
    }

    this.zoomLevel = newZoom;
    content.style.width = `${this.zoomLevel * 100}%`;
    content.style.minWidth = `${this.zoomLevel * 100}%`;

    const zoomEl = document.getElementById('zoom-level');
    if (zoomEl) {
      zoomEl.textContent = `缩放: ${this.zoomLevel.toFixed(1)}x`;
    }

    requestAnimationFrame(() => {
      const newContentWidth = content.offsetWidth;
      const newMaxScroll = Math.max(0, newContentWidth - viewportWidth);

      if (anchorContentX != null && oldContentWidth > 0) {
        this.scrollLeft = (anchorContentX / oldContentWidth) * newContentWidth - pointerX;
      } else if (newMaxScroll > 0) {
        this.scrollLeft = scrollRatio * newMaxScroll;
      } else {
        this.scrollLeft = 0;
      }

      this.scrollLeft = Math.max(0, Math.min(newMaxScroll, this.scrollLeft));
      this.updateContentPosition();
      if (this.updateScrollbar) this.updateScrollbar();
      const keyframes = this.editor.trajectoryManager?.keyframes;
      if (keyframes) {
        this.updateKeyframeMarkers(Array.from(keyframes.keys()));
      }
      if (!skipCurveSync) {
        this.editor.timelineCurveViewSync?.syncFromTimeline();
      }
    });
  }

  _syncCurveViewFromTimeline() {
    this.editor.timelineCurveViewSync?.syncFromTimeline();
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
    
    // 播放中跳过关键帧指示器刷新，减轻卡顿
    if (!this.isPlaying) {
      if (this.editor.jointController?.updateKeyframeIndicators) {
        this.editor.jointController.updateKeyframeIndicators();
      }
      if (this.editor.baseController?.updateKeyframeIndicators) {
        this.editor.baseController.updateKeyframeIndicators();
      }
    }
    
    // 更新曲线编辑器：仅移动当前帧竖线（不重绘整条曲线）
    const curveEditor = this.editor.curveEditor;
    if (curveEditor?.isExpanded) {
      curveEditor.drawPlayheadOnly();
    }

    if (this.editor.endEffectorControls) {
      this.editor.endEffectorControls.onFrameChanged();
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

  /** 测量滑条上关键帧标记的可拖动轨道（与 updateKeyframeMarkers 一致） */
  _measureMarkerTrack(slider) {
    if (!slider || this.frameCount <= 0) {
      return { offset: 0, effectiveWidth: 0 };
    }
    const oldValue = slider.value;
    slider.value = 0;
    const thumbPos0 = this.getThumbPosition(slider);
    slider.value = slider.max;
    const thumbPosMax = this.getThumbPosition(slider);
    slider.value = oldValue;
    return {
      offset: thumbPos0,
      effectiveWidth: Math.max(0, thumbPosMax - thumbPos0)
    };
  }

  _frameToProgress(frameIndex) {
    if (this.frameCount <= 1) return 0;
    return frameIndex / (this.frameCount - 1);
  }

  _frameToLeftPx(frameIndex, track) {
    const t = track || this._markerTrack;
    if (!t || t.effectiveWidth <= 0) return t?.offset ?? 0;
    return t.offset + this._frameToProgress(frameIndex) * t.effectiveWidth;
  }

  /** 将屏幕 X 坐标映射为帧号 */
  clientXToFrame(clientX) {
    const slider = document.getElementById('timeline-slider');
    const track = this._markerTrack;
    if (!slider || !track || track.effectiveWidth <= 0 || this.frameCount <= 0) {
      return 0;
    }
    const rect = slider.getBoundingClientRect();
    const x = clientX - rect.left - track.offset;
    const ratio = Math.max(0, Math.min(1, x / track.effectiveWidth));
    if (this.frameCount <= 1) return 0;
    return Math.round(ratio * (this.frameCount - 1));
  }

  _handleKeyframeMarkerClick(e, frameIndex) {
    if (e.ctrlKey || e.metaKey) {
      if (this.selectedKeyframes.has(frameIndex)) {
        this.selectedKeyframes.delete(frameIndex);
      } else {
        this.selectedKeyframes.add(frameIndex);
      }
      this.updateSmoothButtonVisibility();
      this.updateKeyframeMarkers(Array.from(this.editor.trajectoryManager.keyframes.keys()));
    } else if (e.shiftKey) {
      const allKeyframes = Array.from(this.editor.trajectoryManager.keyframes.keys()).sort((a, b) => a - b);

      if (this.selectedKeyframes.size === 0) {
        this.selectedKeyframes.add(frameIndex);
      } else {
        const selectedArray = Array.from(this.selectedKeyframes).sort((a, b) => a - b);
        const firstSelected = selectedArray[0];
        const lastSelected = selectedArray[selectedArray.length - 1];
        const rangeStart = Math.min(firstSelected, frameIndex);
        const rangeEnd = Math.max(lastSelected, frameIndex);

        allKeyframes.forEach((kf) => {
          if (kf >= rangeStart && kf <= rangeEnd) {
            this.selectedKeyframes.add(kf);
          }
        });
      }

      this.updateSmoothButtonVisibility();
      this.updateKeyframeMarkers(Array.from(this.editor.trajectoryManager.keyframes.keys()));
    } else {
      this.selectedKeyframes.clear();
      this.updateSmoothButtonVisibility();
      this.updateKeyframeMarkers(Array.from(this.editor.trajectoryManager.keyframes.keys()));
      this.setCurrentFrame(frameIndex);
    }
  }

  _refreshAfterKeyframeChange() {
    const keys = Array.from(this.editor.trajectoryManager.keyframes.keys());
    this.updateKeyframeMarkers(keys);
    this.editor.updateRobotState(this.currentFrame);
    this.editor.jointController?.updateKeyframeIndicators?.();
    this.editor.baseController?.updateKeyframeIndicators?.();
    this.editor.curveEditor?.onKeyframesChanged?.();
    this.editor.triggerAutoSave?.();
  }

  _finishKeyframeDrag(fromFrame, toFrame) {
    const from = Math.round(fromFrame);
    const to = Math.round(toFrame);
    if (to === from) {
      this._refreshAfterKeyframeChange();
      return;
    }
    const tm = this.editor.trajectoryManager;
    if (tm.moveKeyframe(from, to)) {
      if (this.selectedKeyframes.has(from)) {
        this.selectedKeyframes.delete(from);
        this.selectedKeyframes.add(to);
      }
      this.setCurrentFrame(to);
    }
    this._refreshAfterKeyframeChange();
  }

  _getKeyframeCopySourceFrame() {
    const tm = this.editor?.trajectoryManager;
    if (!tm?.hasTrajectory()) return null;

    const current = this.currentFrame;
    if (tm.keyframes.has(current)) return current;

    if (this.selectedKeyframes.size > 0) {
      const sorted = Array.from(this.selectedKeyframes).sort((a, b) => a - b);
      for (const frame of sorted) {
        if (tm.keyframes.has(frame)) return frame;
      }
    }
    return null;
  }

  /**
   * 处理关键帧复制/粘贴/删除快捷键（由 main.js 在 capture 阶段调用）
   * @returns {boolean} 是否已处理该按键
   */
  handleKeyframeShortcut(e) {
    const tm = this.editor?.trajectoryManager;
    if (!tm?.hasTrajectory()) return false;

    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.code === 'KeyC') {
      const from = this._getKeyframeCopySourceFrame();
      if (from == null) {
        this.editor.updateStatus?.(i18n.t('keyframeCopyNone'), 'warning');
        return true;
      }
      e.preventDefault();
      e.stopPropagation();
      if (this._copyKeyframeToClipboard(from)) {
        this.editor.updateStatus?.(i18n.t('keyframeCopyDone', { from }), 'success');
      }
      return true;
    }

    if (mod && e.code === 'KeyV') {
      e.preventDefault();
      e.stopPropagation();
      if (!this._keyframeClipboard?.absolute) {
        this.editor.updateStatus?.(i18n.t('keyframePasteEmpty'), 'warning');
        return true;
      }
      const to = this.currentFrame;
      const source = this._keyframeClipboard.sourceFrame;
      if (this._pasteKeyframeFromClipboard(to)) {
        this._refreshAfterKeyframeChange();
        this.editor.updateStatus?.(i18n.t('keyframePasted', { from: source, to }), 'success');
      }
      return true;
    }

    if (!mod && !e.altKey && (e.code === 'Delete' || e.code === 'Backspace')) {
      if (!this._deleteKeyframesByShortcut()) return false;
      e.preventDefault();
      e.stopPropagation();
      return true;
    }

    return false;
  }

  /** @returns {boolean} 是否删除了至少一个关键帧 */
  _deleteKeyframesByShortcut() {
    const tm = this.editor.trajectoryManager;
    if (!tm.hasTrajectory()) return false;

    let framesToDelete;
    if (this.selectedKeyframes.size > 0) {
      framesToDelete = Array.from(this.selectedKeyframes)
        .filter((f) => tm.keyframes.has(f))
        .sort((a, b) => a - b);
    } else if (tm.keyframes.has(this.currentFrame)) {
      framesToDelete = [this.currentFrame];
    } else {
      return false;
    }

    if (framesToDelete.length === 0) return false;

    framesToDelete.forEach((frame) => {
      tm.removeKeyframe(frame);
      this.selectedKeyframes.delete(frame);
    });
    this.updateSmoothButtonVisibility();
    this._refreshAfterKeyframeChange();
    return true;
  }

  _copyKeyframeToClipboard(fromFrame) {
    const tm = this.editor.trajectoryManager;
    const absolute = tm.getKeyframeAbsolute(fromFrame);
    if (!absolute) return false;
    this._keyframeClipboard = {
      absolute,
      sourceFrame: Math.round(fromFrame)
    };
    return true;
  }

  _pasteKeyframeFromClipboard(toFrame) {
    if (!this._keyframeClipboard?.absolute) return false;
    const tm = this.editor.trajectoryManager;
    const to = Math.round(toFrame);
    if (!tm.setKeyframeFromAbsolute(to, this._keyframeClipboard.absolute)) {
      return false;
    }
    this.setCurrentFrame(to);
    return true;
  }

  _isMacPlatform() {
    return /Mac|iPhone|iPad/i.test(navigator.userAgent || navigator.platform || '');
  }

  _keyframeMenuShortcut(action) {
    const mac = this._isMacPlatform();
    switch (action) {
      case 'copy':
        return mac ? '⌘C' : 'Ctrl+C';
      case 'paste':
        return mac ? '⌘V' : 'Ctrl+V';
      case 'delete':
        return mac ? '⌫' : 'Del';
      default:
        return '';
    }
  }

  _createKeyframeMenuButton(label, shortcut, { disabled = false, className = '', onClick }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    if (className) btn.className = className;
    btn.disabled = disabled;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'keyframe-menu-label';
    labelSpan.textContent = label;

    const shortcutSpan = document.createElement('span');
    shortcutSpan.className = 'keyframe-menu-shortcut';
    shortcutSpan.textContent = shortcut;

    btn.append(labelSpan, shortcutSpan);
    btn.addEventListener('click', onClick);
    return btn;
  }

  _hideKeyframeContextMenu() {
    if (this._keyframeContextMenu) {
      this._keyframeContextMenu.remove();
      this._keyframeContextMenu = null;
    }
    if (this._keyframeContextMenuDismiss) {
      document.removeEventListener('pointerdown', this._keyframeContextMenuDismiss, true);
      this._keyframeContextMenuDismiss = null;
    }
  }

  _showKeyframeContextMenu(e, frameIndex) {
    e.preventDefault();
    e.stopPropagation();
    this._hideKeyframeContextMenu();

    const targetFrame = Math.round(frameIndex);
    const tm = this.editor.trajectoryManager;
    const hasKeyframeAtTarget = tm.keyframes?.has(targetFrame);
    const hasClipboard = !!this._keyframeClipboard?.absolute;

    const menu = document.createElement('div');
    menu.className = 'keyframe-context-menu';
    menu.setAttribute('role', 'menu');

    const copyBtn = this._createKeyframeMenuButton(
      i18n.t('keyframeCopy'),
      this._keyframeMenuShortcut('copy'),
      {
        disabled: !hasKeyframeAtTarget,
        onClick: (ev) => {
          ev.stopPropagation();
          this._hideKeyframeContextMenu();
          if (this._copyKeyframeToClipboard(targetFrame) && this.editor.updateStatus) {
            this.editor.updateStatus(
              i18n.t('keyframeCopyDone', { from: targetFrame }),
              'success'
            );
          }
        }
      }
    );

    const pasteBtn = this._createKeyframeMenuButton(
      i18n.t('keyframePaste', { frame: targetFrame }),
      this._keyframeMenuShortcut('paste'),
      {
        disabled: !hasClipboard,
        onClick: (ev) => {
          ev.stopPropagation();
          this._hideKeyframeContextMenu();
          const source = this._keyframeClipboard?.sourceFrame;
          if (this._pasteKeyframeFromClipboard(targetFrame)) {
            this._refreshAfterKeyframeChange();
            if (this.editor.updateStatus) {
              this.editor.updateStatus(
                i18n.t('keyframePasted', { from: source, to: targetFrame }),
                'success'
              );
            }
          }
        }
      }
    );

    const deleteBtn = this._createKeyframeMenuButton(
      i18n.t('keyframeDelete'),
      this._keyframeMenuShortcut('delete'),
      {
        disabled: !hasKeyframeAtTarget,
        className: 'danger',
        onClick: (ev) => {
          ev.stopPropagation();
          this._hideKeyframeContextMenu();
          if (confirm(i18n.t('keyframeDeleteConfirm', { frame: targetFrame }))) {
            this.editor.trajectoryManager.removeKeyframe(targetFrame);
            this.selectedKeyframes.delete(targetFrame);
            this.updateSmoothButtonVisibility();
            this._refreshAfterKeyframeChange();
          }
        }
      }
    );

    menu.append(copyBtn, pasteBtn, deleteBtn);
    document.body.appendChild(menu);

    const pad = 4;
    let left = e.clientX;
    let top = e.clientY;
    const rect = menu.getBoundingClientRect();
    if (left + rect.width > window.innerWidth - pad) {
      left = window.innerWidth - rect.width - pad;
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = window.innerHeight - rect.height - pad;
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    this._keyframeContextMenu = menu;
    this._keyframeContextMenuDismiss = (ev) => {
      if (menu.contains(ev.target)) return;
      this._hideKeyframeContextMenu();
    };
    requestAnimationFrame(() => {
      document.addEventListener('pointerdown', this._keyframeContextMenuDismiss, true);
    });
  }

  _bindKeyframeMarkerDrag(marker, frameIndex) {
    const dragThreshold = 4;

    marker.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      this._hideKeyframeContextMenu();

      const slider = document.getElementById('timeline-slider');
      this._markerTrack = this._measureMarkerTrack(slider);

      const session = {
        marker,
        frameIndex,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        dragging: false,
        previewFrame: frameIndex,
        finished: false
      };
      this._keyframeDragSession = session;

      const onMove = (ev) => {
        if (session.finished || ev.pointerId !== session.pointerId) return;

        const dx = ev.clientX - session.startX;
        const dy = ev.clientY - session.startY;
        if (!session.dragging && Math.hypot(dx, dy) >= dragThreshold) {
          session.dragging = true;
          marker.classList.add('is-dragging');
        }
        if (!session.dragging) return;

        this._markerTrack = this._measureMarkerTrack(slider);
        session.previewFrame = this.clientXToFrame(ev.clientX);
        marker.style.left = `${this._frameToLeftPx(session.previewFrame)}px`;
      };

      const finish = (ev) => {
        if (session.finished) return;
        if (ev && ev.pointerId !== session.pointerId) return;
        session.finished = true;
        this._keyframeDragSession = null;

        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', finish);
        document.removeEventListener('pointercancel', finish);
        window.removeEventListener('blur', onBlur);

        marker.classList.remove('is-dragging');
        try {
          if (marker.hasPointerCapture(session.pointerId)) {
            marker.releasePointerCapture(session.pointerId);
          }
        } catch (_) { /* ignore */ }

        if (session.dragging) {
          if (ev) {
            this._markerTrack = this._measureMarkerTrack(slider);
            session.previewFrame = this.clientXToFrame(ev.clientX);
          }
          this._finishKeyframeDrag(session.frameIndex, session.previewFrame);
        } else if (ev) {
          this._handleKeyframeMarkerClick(ev, frameIndex);
        } else {
          this._refreshAfterKeyframeChange();
        }
      };

      const onBlur = () => finish(null);

      try {
        marker.setPointerCapture(e.pointerId);
      } catch (_) { /* ignore */ }

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', finish);
      document.addEventListener('pointercancel', finish);
      window.addEventListener('blur', onBlur);
    });
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
      const sliderRect = slider.getBoundingClientRect();
      const sliderWidth = sliderRect.width;

      this._markerTrack = this._measureMarkerTrack(slider);
      const { offset, effectiveWidth } = this._markerTrack;

      keyframes.forEach(frameIndex => {
        const marker = document.createElement('div');
        marker.className = 'keyframe-marker';

        const isSelected = this.selectedKeyframes.has(frameIndex);
        const leftPos = this._frameToLeftPx(frameIndex, this._markerTrack);

        marker.style.cssText = `
          position: absolute;
          width: 8px;
          height: 20px;
          background: ${isSelected ? '#ff6b6b' : '#4ec9b0'};
          border-radius: 2px;
          left: ${leftPos}px;
          transform: translateX(-50%);
          transition: background 0.2s, transform 0.2s;
        `;
        marker.title = `Keyframe ${frameIndex} — drag to move, right-click for menu`;

        marker.addEventListener('mouseenter', () => {
          if (marker.classList.contains('is-dragging')) return;
          marker.style.background = '#6fd4bd';
          marker.style.transform = 'translateX(-50%) scale(1.2)';
        });

        marker.addEventListener('mouseleave', () => {
          if (marker.classList.contains('is-dragging')) return;
          const selected = this.selectedKeyframes.has(frameIndex);
          marker.style.background = selected ? '#ff6b6b' : '#4ec9b0';
          marker.style.transform = 'translateX(-50%)';
        });

        this._bindKeyframeMarkerDrag(marker, frameIndex);

        marker.addEventListener('contextmenu', (e) => {
          this._showKeyframeContextMenu(e, frameIndex);
        });

        container.appendChild(marker);
        this.keyframeMarkers.push(marker);
      });
    });
  }

  /**
   * 获取选中的关键帧（排序后的数组）
   */
  getSelectedKeyframes() {
    return Array.from(this.selectedKeyframes).sort((a, b) => a - b);
  }

  /**
   * 清除关键帧选择
   */
  clearSelection() {
    this.selectedKeyframes.clear();
    this.updateKeyframeMarkers(Array.from(this.editor.trajectoryManager.keyframes.keys()));
    this.updateSmoothButtonVisibility();
  }

  /**
   * 更新平滑按钮的显示状态
   */
  updateSmoothButtonVisibility() {
    const smoothBtn = document.getElementById('smooth-keyframes');
    if (smoothBtn) {
      const selectedCount = this.selectedKeyframes.size;
      // 至少选中3个关键帧才显示平滑按钮
      smoothBtn.style.display = selectedCount >= 3 ? 'inline-block' : 'none';
    }
  }

  play() {
    if (this.isPlaying || this.frameCount === 0) return;
    
    this.isPlaying = true;
    if (this.editor.endEffectorControls) {
      this.editor.endEffectorControls.onPlaybackChanged(true);
    }
    const playBtn = document.getElementById('play-pause');
    if (playBtn) playBtn.textContent = i18n.t('pause');

    this.editor.curveEditor?.prepareForPlayback();
    
    const frameTime = this._getFrameIntervalMs();
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
    if (this.editor.endEffectorControls) {
      this.editor.endEffectorControls.onPlaybackChanged(false);
    }
    const playBtn = document.getElementById('play-pause');
    if (playBtn) playBtn.textContent = i18n.t('play');
    
    if (this.playInterval) {
      clearInterval(this.playInterval);
      this.playInterval = null;
    }

    if (this.editor.curveEditor?.isExpanded) {
      this.editor.curveEditor.invalidateAndDraw();
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
    const n = Math.round(Number(fps));
    if (!Number.isFinite(n) || n < 1) return;

    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.pause();

    this.fps = n;
    this._syncFpsInput(n);

    if (this.frameCount > 0) {
      this.duration = this.frameCount / n;
      const totalEl = document.getElementById('total-time');
      if (totalEl) {
        totalEl.textContent = `总时长: ${this.duration.toFixed(2)}s`;
      }
      this.setCurrentFrame(this.currentFrame);
    }

    if (wasPlaying) this.play();
  }

  setPlaybackRate(rate) {
    const r = Number.isFinite(rate) && rate > 0 ? rate : 1;
    this.playbackRate = r;
    const sel = document.getElementById('playback-rate');
    if (sel && sel.value !== String(r)) {
      const opt = Array.from(sel.options).find((o) => parseFloat(o.value) === r);
      if (opt) sel.value = opt.value;
    }
    if (this.isPlaying) {
      this.pause();
      this.play();
    }
  }

  _getFrameIntervalMs() {
    const rate = this.playbackRate > 0 ? this.playbackRate : 1;
    return 1000 / (this.fps * rate);
  }
}
