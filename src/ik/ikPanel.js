import { i18n } from '../i18n.js';
import {
  listUrdfLinks,
  guessDefaultEndLink,
  G1_END_EFFECTOR_PRESETS
} from './ikChainRegistry.js';
import {
  IK_WEIGHT_DEFAULTS,
  readIkWeightsFromDom,
  writeIkWeightsToDom,
  sanitizeIkWeights,
  refreshIkWeightDisplays
} from './ikWeightConfig.js';

export class IkPanel {
  constructor(editor) {
    this.editor = editor;
    this.enabled = false;
    this.endEffectorLink = '';
    this.goalMode = 'pose';
    this.ikWeights = sanitizeIkWeights(IK_WEIGHT_DEFAULTS);

    this._container = document.getElementById('ik-controls');
    this._body = document.getElementById('ik-controls-body');
    this._hint = document.getElementById('ik-load-hint');
    this._header = document.getElementById('ik-control-header');
    this._select = document.getElementById('ik-end-link');
    this._presets = document.getElementById('ik-preset-buttons');

    this._bindStaticControls();
    this._bindTuningControls();
    writeIkWeightsToDom(this.ikWeights);
    if (this.editor.robotRight) {
      this.onUrdfLoaded();
    } else {
      this._syncUrdfUi(false);
    }
  }

  _bindStaticControls() {
    document.getElementById('ik-enable')?.addEventListener('change', async (e) => {
      this.enabled = e.target.checked;
      if (this.enabled && !this.editor.robotRight) {
        alert(i18n.t('ikNeedUrdf'));
        this.enabled = false;
        e.target.checked = false;
        return;
      }
      await this._applyToControls();
      if (!this.enabled) e.target.checked = false;
    });

    this._select?.addEventListener('change', async (e) => {
      this.endEffectorLink = e.target.value;
      await this._onEndLinkChanged();
    });

    document.querySelectorAll('input[name="ik-goal-mode"]').forEach((radio) => {
      radio.addEventListener('change', async (e) => {
        if (e.target.checked) {
          this.goalMode = e.target.value;
          const ec = this.editor.endEffectorControls;
          if (ec) {
            ec.setGoalMode(this.goalMode);
          }
        }
      });
    });

    document.getElementById('ik-reset-reference')?.addEventListener('click', () => {
      this.editor.endEffectorControls?.resetToReference();
    });

    this._body?.querySelectorAll('.ik-nudge-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const ec = this.editor.endEffectorControls;
        if (!ec?.enabled) return;
        const kind = btn.getAttribute('data-kind');
        const axis = btn.getAttribute('data-axis');
        const sign = parseInt(btn.getAttribute('data-sign'), 10);
        if (kind === 'pos') {
          ec.nudgePosition(axis, sign);
        } else if (kind === 'rot') {
          ec.nudgeOrientation(axis, sign);
        }
      });
    });
  }

  _bindTuningControls() {
    const ids = [
      'ik-w-pos-trans', 'ik-w-pos-rot', 'ik-w-pos-iter', 'ik-w-pos-damp',
      'ik-w-pos-clamp', 'ik-w-pos-diverge', 'ik-w-pos-tol'
    ];
    const onChange = () => {
      this.ikWeights = readIkWeightsFromDom(this.ikWeights);
      writeIkWeightsToDom(this.ikWeights);
      refreshIkWeightDisplays(this.ikWeights);
      this.editor.endEffectorControls?.setStoredIkWeights(this.ikWeights);
    };
    for (const id of ids) {
      const el = document.getElementById(id);
      el?.addEventListener('change', onChange);
      el?.addEventListener('input', onChange);
    }
  }

  getIkWeights() {
    this.ikWeights = readIkWeightsFromDom(this.ikWeights);
    return this.ikWeights;
  }

  _syncUrdfUi(hasUrdf) {
    if (this._hint) this._hint.style.display = hasUrdf ? 'none' : 'block';
    if (this._body) this._body.style.display = hasUrdf ? 'block' : 'none';
  }

  onUrdfLoaded() {
    const robot = this.editor.robotRight;
    if (!robot) {
      this.editor.refreshIkPanelUi?.();
      return;
    }

    const links = listUrdfLinks(robot);
    this.endEffectorLink = guessDefaultEndLink(robot);
    this._populateLinkSelect(links);
    this._populatePresets(links);
    this._syncUrdfUi(true);
    this.editor.refreshIkPanelUi?.();

    if (this._container) {
      this._container.style.display = 'block';
      const title = this._header?.querySelector('h3');
      if (title) title.textContent = i18n.t('ikControlOpen');
    }

    void this._onEndLinkChanged();
  }

  _populateLinkSelect(links) {
    if (!this._select) return;
    this._select.innerHTML = links.map((l) =>
      `<option value="${l}"${l === this.endEffectorLink ? ' selected' : ''}>${l}</option>`
    ).join('');
    if (links.length && !links.includes(this.endEffectorLink)) {
      this.endEffectorLink = links[0];
      this._select.value = this.endEffectorLink;
    }
  }

  _populatePresets(links) {
    if (!this._presets) return;
    this._presets.innerHTML = G1_END_EFFECTOR_PRESETS.map((p) => {
      const match = links.find((l) => p.patterns.some((rx) => rx.test(l)));
      if (!match) return '';
      return `<button type="button" class="ik-preset-btn" data-link="${match}" style="margin: 2px; padding: 4px 8px; font-size: 11px; cursor: pointer;">${p.id}</button>`;
    }).join('');

    this._presets.querySelectorAll('.ik-preset-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        this.endEffectorLink = btn.getAttribute('data-link');
        if (this._select) this._select.value = this.endEffectorLink;
        await this._onEndLinkChanged();
      });
    });
  }

  async _onEndLinkChanged() {
    await this._applyToControls();
    this.editor.curveEditor?.setActiveEndEffector(this.endEffectorLink);
  }

  getSettingsForProject() {
    return {
      enabled: this.enabled,
      endEffectorLink: this.endEffectorLink,
      chainRootJoint: null,
      goalMode: this.goalMode,
      ikWeights: this.getIkWeights()
    };
  }

  applyProjectSettings(ik) {
    if (!ik) return;
    if (typeof ik.endEffectorLink === 'string') this.endEffectorLink = ik.endEffectorLink;
    if (ik.goalMode === 'pose' || ik.goalMode === 'position' || ik.goalMode === 'orientation') {
      this.goalMode = ik.goalMode;
    }
    if (ik.ikWeights) {
      this.ikWeights = sanitizeIkWeights(ik.ikWeights);
      writeIkWeightsToDom(this.ikWeights);
    }
    if (typeof ik.enabled === 'boolean') {
      this.enabled = ik.enabled && !!this.editor.robotRight;
    }

    const enableCb = document.getElementById('ik-enable');
    if (enableCb) enableCb.checked = this.enabled;
    document.querySelectorAll('input[name="ik-goal-mode"]').forEach((r) => {
      r.checked = r.value === this.goalMode;
    });

    if (this.editor.robotRight) {
      const links = listUrdfLinks(this.editor.robotRight);
      this._populateLinkSelect(links);
      this._populatePresets(links);
      this._syncUrdfUi(true);
    }

    void this._applyToControls();
  }

  async _applyToControls() {
    const ec = this.editor.endEffectorControls;
    if (!ec) return;

    ec.setGoalMode(this.goalMode);
    ec.setEndLink(this.endEffectorLink);
    ec.setStoredIkWeights(this.getIkWeights());

    const ok = ec.setEnabled(this.enabled);
    if (this.enabled && !ok) {
      this.enabled = false;
      const cb = document.getElementById('ik-enable');
      if (cb) cb.checked = false;
    }

    if (this.endEffectorLink) {
      this.editor.curveEditor?.setActiveEndEffector(this.endEffectorLink);
    }
  }
}
