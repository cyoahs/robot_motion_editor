/**
 * 时间轴与曲线编辑器 X 轴视图双向同步（缩放 + 平移）
 */
export class TimelineCurveViewSync {
  constructor(editor) {
    this.editor = editor;
    /** @type {'timeline' | 'curve' | null} */
    this._suppress = null;
    this._curveSyncTimer = null;
  }

  _timeline() {
    return this.editor.timelineController;
  }

  _curve() {
    return this.editor.curveEditor;
  }

  _metrics() {
    const viewport = document.getElementById('timeline-viewport');
    const content = document.getElementById('timeline-content');
    const timeline = this._timeline();
    if (!viewport || !content || !timeline) return null;

    const vw = viewport.offsetWidth;
    const cw = content.offsetWidth;
    if (vw <= 0 || cw <= 0) return null;

    return {
      vw,
      cw,
      scroll: timeline.scrollLeft || 0,
      maxScroll: Math.max(0, cw - vw)
    };
  }

  /** 时间轴滚动/缩放 → 曲线 viewTransform */
  syncFromTimeline() {
    if (this._suppress === 'curve') return;

    const curve = this._curve();
    const timeline = this._timeline();
    const m = this._metrics();
    if (!curve || !timeline || !m) return;

    const scaleX = Math.max(1, m.cw / m.vw);
    const centerNorm = (m.scroll + m.vw / 2) / m.cw;

    this._suppress = 'timeline';
    const maxScale = timeline.maxZoom ?? curve.viewTransform.maxScaleX;
    curve.viewTransform.scaleX = Math.max(1, Math.min(maxScale, scaleX));
    curve.viewTransform.offsetX = centerNorm - 0.5;

    if (curve.isExpanded) {
      curve._markStaticDirty?.();
      curve._scheduleViewRedraw?.();
    }
    this._suppress = null;
  }

  /** 曲线 viewTransform → 时间轴 zoomLevel + scrollLeft */
  syncFromCurve() {
    if (this._suppress === 'timeline') return;

    const timeline = this._timeline();
    const curve = this._curve();
    if (!timeline || !curve) return;

    const scaleX = curve.viewTransform.scaleX || 1;
    const offsetX = curve.viewTransform.offsetX || 0;
    const targetZoom = Math.max(
      timeline.minZoom,
      Math.min(timeline.maxZoom, scaleX)
    );
    const centerNorm = 0.5 + offsetX;

    this._suppress = 'curve';
    timeline.setZoom(targetZoom, null, { skipCurveSync: true });

    requestAnimationFrame(() => {
      const m = this._metrics();
      if (m) {
        if (m.maxScroll > 0) {
          let scroll = centerNorm * m.cw - m.vw / 2;
          scroll = Math.max(0, Math.min(m.maxScroll, scroll));
          timeline.scrollLeft = scroll;
        } else {
          timeline.scrollLeft = 0;
        }
        timeline.updateContentPosition();
        timeline.updateScrollbar?.();
        const kfs = this.editor.trajectoryManager?.keyframes;
        if (kfs) {
          timeline.updateKeyframeMarkers(Array.from(kfs.keys()));
        }
      }
      this._suppress = null;
    });
  }

  syncFromCurveDebounced(delayMs = 16) {
    if (this._curveSyncTimer) {
      clearTimeout(this._curveSyncTimer);
    }
    this._curveSyncTimer = setTimeout(() => {
      this._curveSyncTimer = null;
      this.syncFromCurve();
    }, delayMs);
  }

  /** 重置两侧为整段可见 */
  resetBoth() {
    this._suppress = 'timeline';
    const timeline = this._timeline();
    const curve = this._curve();
    if (timeline) {
      timeline.scrollLeft = 0;
      timeline.setZoom(1.0, null, { skipCurveSync: true });
      timeline.updateContentPosition();
      timeline.updateScrollbar?.();
    }
    if (curve) {
      curve.viewTransform.offsetX = 0;
      curve.viewTransform.scaleX = 1;
      if (curve.isExpanded) {
        curve._markStaticDirty?.();
        curve.invalidateAndDraw?.();
      }
    }
    this._suppress = null;
  }
}
