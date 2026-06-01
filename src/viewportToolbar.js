import { i18n } from './i18n.js';

const STORAGE_KEY = 'robot_motion_editor_viewport_pins';
const STORAGE_EXPANDED = 'robot_motion_editor_viewport_panel_expanded';
const STORAGE_PANEL_POS = 'robot_motion_editor_viewport_panel_pos';

const DISPLAY_BLOCK_ID = 'viewport-tool-block';
const CAMERA_BLOCK_ID = 'viewport-tool-camera-block';

const LEGACY_VIEWPORT_PIN_IDS = [
  'viewport-tool-overlay',
  'viewport-tool-split',
  'viewport-tool-ghost',
  'viewport-tool-edited'
];
const LEGACY_CAMERA_PIN_IDS = [
  'toggle-camera-mode',
  'reset-camera',
  'follow-robot',
  'toggle-com'
];
const LEGACY_FOOTPRINT_PIN_IDS = ['refresh-footprint', 'toggle-auto-refresh'];

/** 可固定到顶栏的配置块（后续新增块在此追加） */
const PINNABLE_TOOLS = [
  { id: DISPLAY_BLOCK_ID, labelKey: 'viewportPinDisplayMode', section: 'viewport' },
  { id: CAMERA_BLOCK_ID, labelKey: 'viewportPinCamera', section: 'camera' }
];

const DEFAULT_PINNED = [CAMERA_BLOCK_ID];

export class ViewportToolbar {
  constructor() {
    this.pinnedIds = this._loadPinned();
    this._panelOpen = this._loadExpanded();
    this._home = new Map();
    this._pinOptionsEl = null;
    this._toolbar = null;
    this._panel = null;
    this._toggle = null;
    this._mirrorObservers = new Map();
    this._dragState = null;
  }

  init() {
    this._toolbar = document.getElementById('viewport-toolbar');
    this._panel = document.getElementById('viewport-toolbar-panel');
    this._toggle = document.getElementById('viewport-toolbar-toggle');
    const closeBtn = document.getElementById('viewport-toolbar-close');

    if (!this._toolbar || !this._panel || !this._toggle) {
      console.warn('ViewportToolbar: missing DOM nodes');
      return;
    }

    this._registerHomes();
    this._pinOptionsEl = document.getElementById('viewport-pin-options');
    const normalized = this._normalizePinnedIds(this.pinnedIds);
    if (normalized.join(',') !== this.pinnedIds.join(',')) {
      this.pinnedIds = normalized;
      this._savePinned();
    }
    this._renderPinSettings();
    this._applyPinnedLayout();
    this._initPanelDrag();
    this._setPanelOpen(this._panelOpen, false);

    this._toolbar.addEventListener('pointerdown', (e) => e.stopPropagation());
    this._toolbar.addEventListener('mousedown', (e) => e.stopPropagation());
    this._toolbar.addEventListener('click', (e) => {
      if (e.target.closest('#viewport-toolbar-toggle')) {
        e.preventDefault();
        e.stopPropagation();
        this._setPanelOpen(!this._panelOpen);
        return;
      }
      if (e.target.closest('#viewport-toolbar-close')) {
        e.preventDefault();
        e.stopPropagation();
        this._setPanelOpen(false);
      }
    });

    closeBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._setPanelOpen(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._panelOpen) {
        this._setPanelOpen(false);
      }
    });
  }

  _getSectionElement(sectionName) {
    return this._panel?.querySelector(`[data-section="${sectionName}"]`);
  }

  _registerHomes() {
    PINNABLE_TOOLS.forEach(({ id, section }) => {
      const el = document.getElementById(id);
      const sectionEl = this._getSectionElement(section);
      if (!el || !sectionEl) return;
      if (!sectionEl.contains(el)) {
        sectionEl.appendChild(el);
      }
      this._home.set(id, { parent: sectionEl });
    });
  }

  _normalizePinnedIds(arr) {
    let ids = arr.filter((id) => PINNABLE_TOOLS.some((t) => t.id === id));
    if (LEGACY_VIEWPORT_PIN_IDS.some((legacyId) => arr.includes(legacyId))) {
      if (!ids.includes(DISPLAY_BLOCK_ID)) {
        ids.push(DISPLAY_BLOCK_ID);
      }
      ids = ids.filter((id) => !LEGACY_VIEWPORT_PIN_IDS.includes(id));
    }
    if (LEGACY_CAMERA_PIN_IDS.some((legacyId) => arr.includes(legacyId))) {
      if (!ids.includes(CAMERA_BLOCK_ID)) {
        ids.push(CAMERA_BLOCK_ID);
      }
      ids = ids.filter((id) => !LEGACY_CAMERA_PIN_IDS.includes(id));
    }
    ids = ids.filter((id) => !LEGACY_FOOTPRINT_PIN_IDS.includes(id));
    return ids;
  }

  _loadPinned() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) {
          return this._normalizePinnedIds(arr);
        }
      }
    } catch (_) { /* ignore */ }
    return [...DEFAULT_PINNED];
  }

  _savePinned() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.pinnedIds));
  }

  _loadExpanded() {
    return localStorage.getItem(STORAGE_EXPANDED) === '1';
  }

  _saveExpanded() {
    localStorage.setItem(STORAGE_EXPANDED, this._panelOpen ? '1' : '0');
  }

  _renderPinSettings() {
    if (!this._pinOptionsEl) return;
    this._pinOptionsEl.innerHTML = '';
    PINNABLE_TOOLS.forEach(({ id, labelKey }) => {
      const label = document.createElement('label');
      label.className = 'viewport-pin-option';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this.pinnedIds.includes(id);
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (!this.pinnedIds.includes(id)) this.pinnedIds.push(id);
        } else {
          this.pinnedIds = this.pinnedIds.filter((x) => x !== id);
        }
        this._savePinned();
        this._applyPinnedLayout();
      });
      const span = document.createElement('span');
      span.setAttribute('data-i18n', labelKey);
      span.textContent = i18n.t(labelKey);
      label.appendChild(cb);
      label.appendChild(span);
      this._pinOptionsEl.appendChild(label);
    });
  }

  _clearMirrors() {
    this._mirrorObservers.forEach((obs) => obs.disconnect());
    this._mirrorObservers.clear();
  }

  _syncMirrorFromSource(source, mirror) {
    const sourceControls = this._listControls(source);
    const mirrorControls = this._listControls(mirror);
    mirrorControls.forEach((mCtrl, i) => {
      const sCtrl = sourceControls[i];
      if (!sCtrl) return;
      if (sCtrl.type === 'radio' || sCtrl.type === 'checkbox') {
        mCtrl.checked = sCtrl.checked;
      } else if (sCtrl.tagName === 'BUTTON') {
        mCtrl.textContent = sCtrl.textContent;
        mCtrl.style.cssText = sCtrl.style.cssText;
      } else if (sCtrl.value !== undefined) {
        mCtrl.value = sCtrl.value;
      }
    });
  }

  _listControls(root) {
    if (root.matches('input, button, select, textarea')) {
      return [root];
    }
    return Array.from(root.querySelectorAll('input, button, select, textarea'));
  }

  _wireMirror(mirror, source, sourceId) {
    const sourceControls = this._listControls(source);
    const mirrorControls = this._listControls(mirror);

    mirrorControls.forEach((mCtrl, i) => {
      const sCtrl = sourceControls[i];
      if (!sCtrl) return;

      if (sCtrl.type === 'radio') {
        mCtrl.checked = sCtrl.checked;
        mCtrl.addEventListener('change', () => {
          if (!mCtrl.checked) return;
          const match = source.querySelector(
            `input[type="radio"][name="${sCtrl.name}"][value="${mCtrl.value}"]`
          );
          if (match) {
            match.checked = true;
            match.dispatchEvent(new Event('change', { bubbles: true }));
          }
          this._syncMirrorFromSource(source, mirror);
        });
      } else if (sCtrl.type === 'checkbox') {
        mCtrl.checked = sCtrl.checked;
        mCtrl.addEventListener('change', () => {
          sCtrl.checked = mCtrl.checked;
          sCtrl.dispatchEvent(new Event('change', { bubbles: true }));
        });
      } else if (sCtrl.tagName === 'BUTTON') {
        mCtrl.addEventListener('click', (e) => {
          e.preventDefault();
          sCtrl.click();
          this._syncMirrorFromSource(source, mirror);
        });
      } else {
        if (sCtrl.value !== undefined) mCtrl.value = sCtrl.value;
        const evt = sCtrl.tagName === 'SELECT' ? 'change' : 'input';
        mCtrl.addEventListener(evt, () => {
          sCtrl.value = mCtrl.value;
          sCtrl.dispatchEvent(new Event(evt, { bubbles: true }));
        });
      }
    });

    const obs = new MutationObserver(() => this._syncMirrorFromSource(source, mirror));
    obs.observe(source, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'checked']
    });
    this._mirrorObservers.set(sourceId, obs);
  }

  _createMirror(source, sourceId) {
    const mirror = source.cloneNode(true);
    mirror.removeAttribute('id');
    mirror.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    // 避免与面板内单选共用 name，否则浏览器会把镜像与源控件当成同一组
    mirror.querySelectorAll('input[type="radio"]').forEach((radio) => {
      radio.removeAttribute('name');
    });
    mirror.classList.add('viewport-toolbar-mirror');
    mirror.dataset.mirrorSource = sourceId;
    this._wireMirror(mirror, source, sourceId);
    this._syncMirrorFromSource(source, mirror);
    return mirror;
  }

  /** 面板状态变更后同步顶栏镜像（如视口模式单选） */
  syncAllMirrors() {
    document.querySelectorAll('.viewport-toolbar-mirror[data-mirror-source]').forEach((mirror) => {
      const sourceId = mirror.dataset.mirrorSource;
      const source = document.getElementById(sourceId);
      if (source) {
        this._syncMirrorFromSource(source, mirror);
      }
    });
  }

  _applyPinnedLayout() {
    const pinBar = document.getElementById('viewport-toolbar-pin');
    if (!pinBar) return;

    PINNABLE_TOOLS.forEach(({ id }) => {
      const el = document.getElementById(id);
      const home = this._home.get(id);
      if (!el || !home) return;
      if (el.parentElement !== home.parent) {
        home.parent.appendChild(el);
      }
    });

    this._clearMirrors();
    pinBar.innerHTML = '';

    this.pinnedIds.forEach((id) => {
      const source = document.getElementById(id);
      if (!source) return;
      const wrap = document.createElement('div');
      wrap.className = 'viewport-pin-item';
      wrap.appendChild(this._createMirror(source, id));
      pinBar.appendChild(wrap);
    });

    this._panel?.querySelectorAll('.viewport-toolbar-section[data-section]').forEach((section) => {
      section.style.display = '';
    });
    this.syncAllMirrors();
  }

  _initPanelDrag() {
    const header = document.getElementById('viewport-toolbar-panel-header');
    if (!header || !this._panel) return;

    try {
      const raw = localStorage.getItem(STORAGE_PANEL_POS);
      if (raw) {
        const pos = JSON.parse(raw);
        if (Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
          this._panel.classList.add('is-floating');
          this._panel.style.left = `${pos.left}px`;
          this._panel.style.top = `${pos.top}px`;
          if (pos.width) this._panel.style.width = `${pos.width}px`;
        }
      }
    } catch (_) { /* ignore */ }

    const onMove = (e) => {
      if (!this._dragState) return;
      const dx = e.clientX - this._dragState.startX;
      const dy = e.clientY - this._dragState.startY;
      const left = Math.max(8, this._dragState.originLeft + dx);
      const top = Math.max(8, this._dragState.originTop + dy);
      this._panel.style.left = `${left}px`;
      this._panel.style.top = `${top}px`;
    };

    const onUp = () => {
      if (!this._dragState) return;
      const rect = this._panel.getBoundingClientRect();
      localStorage.setItem(
        STORAGE_PANEL_POS,
        JSON.stringify({ left: rect.left, top: rect.top, width: rect.width })
      );
      this._dragState = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    header.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('#viewport-toolbar-close')) return;
      e.preventDefault();
      const rect = this._panel.getBoundingClientRect();
      if (!this._panel.classList.contains('is-floating')) {
        this._panel.classList.add('is-floating');
        this._panel.style.width = `${rect.width}px`;
      }
      this._panel.style.left = `${rect.left}px`;
      this._panel.style.top = `${rect.top}px`;
      this._dragState = {
        startX: e.clientX,
        startY: e.clientY,
        originLeft: rect.left,
        originTop: rect.top
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  _setPanelOpen(open, persist = true) {
    if (!this._panel || !this._toggle) return;
    this._panelOpen = !!open;
    this._panel.classList.toggle('is-open', this._panelOpen);
    this._toggle.setAttribute('aria-expanded', this._panelOpen ? 'true' : 'false');
    if (persist) {
      this._saveExpanded();
    }
  }

  refreshLabels() {
    const root = document.getElementById('viewport-pin-settings');
    root?.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = i18n.t(key);
    });
    this._pinOptionsEl?.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = i18n.t(key);
    });
    [DISPLAY_BLOCK_ID, CAMERA_BLOCK_ID].forEach((blockId) => {
      document.getElementById(blockId)?.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (key) el.textContent = i18n.t(key);
      });
    });
    document.getElementById('viewport-toolbar-pin')?.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = i18n.t(key);
    });
  }
}
