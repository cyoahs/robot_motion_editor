export class BaseController {
  constructor(editor) {
    this.editor = editor;
    this.baseValues = {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 }
    };
    this.isExpanded = false;
    
    this.setupUI();
  }

  setupUI() {
    // 展开/折叠控制
    const header = document.getElementById('base-control-header');
    header.addEventListener('click', () => {
      this.toggleExpand();
    });
    
    const container = document.getElementById('base-controls');
    container.innerHTML = '';

    // Position 控制
    const posGroup = document.createElement('div');
    posGroup.style.cssText = 'margin-bottom: 10px; padding: 8px; background: #1e1e1e; border-radius: 4px;';
    
    const posLabel = document.createElement('div');
    posLabel.textContent = 'Position (xyz)';
    posLabel.style.cssText = 'font-size: 11px; color: #cccccc; margin-bottom: 5px;';
    posGroup.appendChild(posLabel);
    
    ['x', 'y', 'z'].forEach(axis => {
      const row = this.createInputRow(axis.toUpperCase(), -10, 10, 0.01, (value) => {
        this.baseValues.position[axis] = value;
        this.applyBaseTransform();
      });
      posGroup.appendChild(row);
    });
    
    container.appendChild(posGroup);

    // Quaternion 控制
    const quatGroup = document.createElement('div');
    quatGroup.style.cssText = 'margin-bottom: 10px; padding: 8px; background: #1e1e1e; border-radius: 4px;';
    
    const quatLabel = document.createElement('div');
    quatLabel.textContent = 'Quaternion (xyzw)';
    quatLabel.style.cssText = 'font-size: 11px; color: #cccccc; margin-bottom: 5px;';
    quatGroup.appendChild(quatLabel);
    
    ['x', 'y', 'z', 'w'].forEach(axis => {
      const defaultValue = axis === 'w' ? 1 : 0;
      const row = this.createInputRow(axis.toUpperCase(), -1, 1, 0.01, (value) => {
        this.baseValues.quaternion[axis] = value;
        this.normalizeQuaternion();
        this.applyBaseTransform();
      }, defaultValue);
      row.dataset.quatAxis = axis;
      quatGroup.appendChild(row);
    });
    
    container.appendChild(quatGroup);
  }

  createInputRow(label, min, max, step, onChange, defaultValue = 0) {
    const row = document.createElement('div');
    row.className = 'joint-control-row';
    row.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-bottom: 5px;';
    
    const labelEl = document.createElement('span');
    labelEl.textContent = label + ':';
    labelEl.style.cssText = 'width: 20px; font-size: 11px;';
    row.appendChild(labelEl);
    
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = defaultValue;
    slider.style.flex = '1';
    
    const numberInput = document.createElement('input');
    numberInput.type = 'number';
    numberInput.min = min;
    numberInput.max = max;
    numberInput.step = step;
    numberInput.value = defaultValue.toFixed(3);
    numberInput.style.cssText = 'width: 70px; padding: 2px 4px; background: #3c3c3c; border: 1px solid #3e3e42; color: #d4d4d4; border-radius: 2px; font-size: 11px;';
    
    slider.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      numberInput.value = value.toFixed(3);
      onChange(value);
    });
    
    numberInput.addEventListener('change', (e) => {
      let value = parseFloat(e.target.value);
      value = Math.max(min, Math.min(max, value));
      slider.value = value;
      numberInput.value = value.toFixed(3);
      onChange(value);
    });
    
    row.appendChild(slider);
    row.appendChild(numberInput);
    
    return row;
  }

  toggleExpand() {
    this.isExpanded = !this.isExpanded;
    const container = document.getElementById('base-controls');
    const header = document.getElementById('base-control-header');
    
    if (this.isExpanded) {
      container.style.display = 'block';
      header.querySelector('h3').textContent = '▼ 基体控制 (Base)';
    } else {
      container.style.display = 'none';
      header.querySelector('h3').textContent = '▶ 基体控制 (Base)';
    }
  }

  normalizeQuaternion() {
    const q = this.baseValues.quaternion;
    const length = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
    
    if (length > 0.0001) {
      q.x /= length;
      q.y /= length;
      q.z /= length;
      q.w /= length;
      
      // 更新UI
      const container = document.getElementById('base-controls');
      ['x', 'y', 'z', 'w'].forEach(axis => {
        const row = container.querySelector(`[data-quat-axis="${axis}"]`);
        if (row) {
          const slider = row.querySelector('input[type="range"]');
          const numberInput = row.querySelector('input[type="number"]');
          const value = q[axis];
          if (slider) slider.value = value;
          if (numberInput) numberInput.value = value.toFixed(3);
        }
      });
    }
  }

  applyBaseTransform() {
    if (!this.editor.robot) return;
    
    const robot = this.editor.robot;
    const pos = this.baseValues.position;
    const quat = this.baseValues.quaternion;
    
    robot.position.set(pos.x, pos.y, pos.z);
    robot.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    
    // 如果当前帧是关键帧，自动更新
    this.autoUpdateKeyframe();
  }

  autoUpdateKeyframe() {
    if (!this.editor.trajectoryManager.hasTrajectory()) {
      return;
    }
    
    const currentFrame = this.editor.timelineController.getCurrentFrame();
    
    if (this.editor.trajectoryManager.keyframes.has(currentFrame)) {
      const currentJointValues = this.editor.jointController.getCurrentJointValues();
      const currentBaseValues = this.getCurrentBaseValues();
      this.editor.trajectoryManager.addKeyframe(currentFrame, currentJointValues, currentBaseValues);
      console.log(`✅ 自动更新关键帧 ${currentFrame} 的基体残差`);
    }
  }

  updateBase(position, quaternion) {
    this.baseValues.position = { ...position };
    this.baseValues.quaternion = { ...quaternion };
    
    const container = document.getElementById('base-controls');
    if (!container) return;
    
    // 更新 position UI
    ['x', 'y', 'z'].forEach(axis => {
      const rows = container.querySelectorAll('.joint-control-row');
      rows.forEach(row => {
        const label = row.querySelector('span');
        if (label && label.textContent === axis.toUpperCase() + ':') {
          const slider = row.querySelector('input[type="range"]');
          const numberInput = row.querySelector('input[type="number"]');
          const value = position[axis];
          if (slider && slider.min <= value && slider.max >= value) {
            slider.value = value;
            numberInput.value = value.toFixed(3);
          }
        }
      });
    });
    
    // 更新 quaternion UI
    ['x', 'y', 'z', 'w'].forEach(axis => {
      const row = container.querySelector(`[data-quat-axis="${axis}"]`);
      if (row) {
        const slider = row.querySelector('input[type="range"]');
        const numberInput = row.querySelector('input[type="number"]');
        const value = quaternion[axis];
        if (slider) slider.value = value;
        if (numberInput) numberInput.value = value.toFixed(3);
      }
    });
    
    this.applyBaseTransform();
  }

  getCurrentBaseValues() {
    return {
      position: { ...this.baseValues.position },
      quaternion: { ...this.baseValues.quaternion }
    };
  }

  resetToBase() {
    if (this.editor.trajectoryManager.hasTrajectory()) {
      const currentFrame = this.editor.timelineController.getCurrentFrame();
      const baseState = this.editor.trajectoryManager.getBaseState(currentFrame);
      if (baseState) {
        this.updateBase(baseState.base.position, baseState.base.quaternion);
        console.log('✅ 基体已重置到 CSV base 值');
      }
    }
  }
}
