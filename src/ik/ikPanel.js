import { i18n } from '../i18n.js';
import {
  listUrdfLinks,
  guessDefaultEndLink,
  G1_END_EFFECTOR_PRESETS
} from './ikChainRegistry.js';

export class IkPanel {
  constructor(editor) {
    this.editor = editor;
    this.enabled = false;
    this.endEffectorLink = '';
    this.goalMode = 'pose';
    this.lockFootZ = false;
    this._container = document.getElementById('ik-controls');
    this._header = document.getElementById('ik-control-header');
    this._render();
  }

  onUrdfLoaded() {
    const robot = this.editor.robotRight;
    if (!robot) return;
    const links = listUrdfLinks(robot);
    this.endEffectorLink = guessDefaultEndLink(robot);
    this._render(links);
    if (this._container) {
      this._container.style.display = 'block';
      const title = this._header?.querySelector('h3');
      if (title) title.textContent = i18n.t('ikControlOpen');
    }
    this._applyToControls();
  }

  getSettingsForProject() {
    return {
      enabled: this.enabled,
      endEffectorLink: this.endEffectorLink,
      chainRootJoint: null,
      legLockFootZ: this.lockFootZ,
      goalMode: this.goalMode
    };
  }

  applyProjectSettings(ik) {
    if (!ik) return;
    if (typeof ik.endEffectorLink === 'string') this.endEffectorLink = ik.endEffectorLink;
    if (ik.goalMode === 'position' || ik.goalMode === 'pose') this.goalMode = ik.goalMode;
    if (typeof ik.legLockFootZ === 'boolean') this.lockFootZ = ik.legLockFootZ;
    if (typeof ik.enabled === 'boolean') {
      this.enabled = ik.enabled && !!this.editor.robotRight;
    }
    this._render(listUrdfLinks(this.editor.robotRight));
    void this._applyToControls();
  }

  async _applyToControls() {
    if (this.editor._ikReady) {
      await this.editor._ikReady;
    }
    const ec = this.editor.endEffectorControls;
    if (!ec) {
      console.warn('IK controls not ready');
      return;
    }
    ec.setGoalMode(this.goalMode);
    ec.setLockFootZ(this.lockFootZ);
    ec.setEndLink(this.endEffectorLink);
    const ok = ec.setEnabled(this.enabled);
    if (this.enabled && !ok) {
      this.enabled = false;
      const cb = document.getElementById('ik-enable');
      if (cb) cb.checked = false;
    }
  }

  _render(links = []) {
    if (!this._container) return;

    const presetButtons = G1_END_EFFECTOR_PRESETS.map((p) => {
      const match = links.find((l) => p.patterns.some((rx) => rx.test(l)));
      if (!match) return '';
      return `<button type="button" class="ik-preset-btn" data-link="${match}" style="margin: 2px; padding: 4px 8px; font-size: 11px;">${p.id}</button>`;
    }).join('');

    const options = links.map((l) =>
      `<option value="${l}"${l === this.endEffectorLink ? ' selected' : ''}>${l}</option>`
    ).join('');

    this._container.innerHTML = `
      <label style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
        <input type="checkbox" id="ik-enable" ${this.enabled ? 'checked' : ''} />
        <span data-i18n="ikEnable">${i18n.t('ikEnable')}</span>
      </label>
      <label style="display: block; margin-bottom: 6px;">
        <span data-i18n="ikEndLink">${i18n.t('ikEndLink')}</span>
        <select id="ik-end-link" style="width: 100%; margin-top: 4px; padding: 4px; font-size: 12px;">${options}</select>
      </label>
      <div style="margin-bottom: 8px;">${presetButtons}</div>
      <div style="margin-bottom: 8px;">
        <label style="margin-right: 10px;">
          <input type="radio" name="ik-goal-mode" value="pose" ${this.goalMode === 'pose' ? 'checked' : ''} />
          ${i18n.t('ikGoalPose')}
        </label>
        <label>
          <input type="radio" name="ik-goal-mode" value="position" ${this.goalMode === 'position' ? 'checked' : ''} />
          ${i18n.t('ikGoalPosition')}
        </label>
      </div>
      <label style="display: flex; align-items: center; gap: 6px;">
        <input type="checkbox" id="ik-lock-foot-z" ${this.lockFootZ ? 'checked' : ''} />
        <span data-i18n="ikLockFootZ">${i18n.t('ikLockFootZ')}</span>
      </label>
    `;

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

    document.getElementById('ik-end-link')?.addEventListener('change', async (e) => {
      this.endEffectorLink = e.target.value;
      await this._applyToControls();
    });

    document.querySelectorAll('.ik-preset-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        this.endEffectorLink = btn.getAttribute('data-link');
        const sel = document.getElementById('ik-end-link');
        if (sel) sel.value = this.endEffectorLink;
        await this._applyToControls();
      });
    });

    document.querySelectorAll('input[name="ik-goal-mode"]').forEach((radio) => {
      radio.addEventListener('change', async (e) => {
        if (e.target.checked) {
          this.goalMode = e.target.value;
          await this._applyToControls();
        }
      });
    });

    document.getElementById('ik-lock-foot-z')?.addEventListener('change', async (e) => {
      this.lockFootZ = e.target.checked;
      await this._applyToControls();
    });
  }
}
