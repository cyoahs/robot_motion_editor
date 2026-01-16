import { i18n } from './i18n.js';

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
    const headerTitle = header.querySelector('h3');
    
    // 添加全局重置按钮
    const resetAllBtn = document.createElement('button');
    resetAllBtn.textContent = i18n.t('resetBaseTitle');
    resetAllBtn.title = i18n.t('resetBaseTitle');
    resetAllBtn.style.cssText = 'margin-left: 10px; padding: 2px 8px; font-size: 11px; background: var(--accent-primary); color: white; border: none; border-radius: 3px; cursor: pointer; transition: background-color 0.2s;';
    resetAllBtn.addEventListener('mouseenter', () => {
      resetAllBtn.style.background = 'var(--accent-hover)';
    });
    resetAllBtn.addEventListener('mouseleave', () => {
      resetAllBtn.style.background = 'var(--accent-primary)';
    });
    resetAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.resetToBase();
    });
    header.appendChild(resetAllBtn);
    
    headerTitle.addEventListener('click', () => {
      this.toggleExpand();
    });
    
    const container = document.getElementById('base-controls');
    container.innerHTML = '';

    // Position 控制
    const posGroup = document.createElement('div');
    posGroup.style.cssText = 'margin-bottom: 10px; padding: 8px; background: var(--bg-primary); border-radius: 4px; transition: background-color 0.3s ease;';
    
    const posLabel = document.createElement('div');
    posLabel.textContent = 'Position (xyz)';
    posLabel.style.cssText = 'font-size: 11px; color: var(--text-secondary); margin-bottom: 5px; transition: color 0.3s ease;';
    posGroup.appendChild(posLabel);
    
    ['x', 'y', 'z'].forEach(axis => {
      const row = this.createInputRow(axis.toUpperCase(), -10, 10, 0.01, (value) => {
        this.baseValues.position[axis] = value;
        this.applyBaseTransform();
      }, 0, 'position', axis);
      posGroup.appendChild(row);
    });
    
    container.appendChild(posGroup);

    // Quaternion 控制
    const quatGroup = document.createElement('div');
    quatGroup.style.cssText = 'margin-bottom: 10px; padding: 8px; background: var(--bg-primary); border-radius: 4px; transition: background-color 0.3s ease;';
    
    const quatLabel = document.createElement('div');
    quatLabel.textContent = 'Quaternion (xyzw)';
    quatLabel.style.cssText = 'font-size: 11px; color: var(--text-secondary); margin-bottom: 5px; transition: color 0.3s ease;';
    quatGroup.appendChild(quatLabel);
    
    ['x', 'y', 'z', 'w'].forEach(axis => {
      const defaultValue = axis === 'w' ? 1 : 0;
      const row = this.createInputRow(axis.toUpperCase(), -1, 1, 0.01, (value) => {
        this.baseValues.quaternion[axis] = value;
        this.normalizeQuaternion();
        this.applyBaseTransform();
      }, defaultValue, 'quaternion', axis);
      row.dataset.quatAxis = axis;
      quatGroup.appendChild(row);
    });
    
    container.appendChild(quatGroup);
  }

  createInputRow(label, min, max, step, onChange, defaultValue = 0, type = null, axis = null) {
    const row = document.createElement('div');
    row.className = 'joint-control-row';
    row.style.cssText = 'display: flex; gap: 8px; align-items: center; margin-bottom: 5px;';
    
    const labelEl = document.createElement('span');
    labelEl.textContent = label + ':';
    labelEl.style.cssText = 'width: 20px; font-size: 11px; color: var(--text-primary); transition: color 0.3s ease;';
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
    numberInput.style.cssText = 'width: 70px; padding: 2px 4px; background: var(--bg-input); border: 1px solid var(--border-primary); color: var(--text-primary); border-radius: 2px; font-size: 11px; transition: all 0.3s ease;';
    
    // 添加重置按钮
    const resetBtn = document.createElement('button');
    resetBtn.innerHTML = '↺';
    const titleKey = type === 'quaternion' ? 'resetQuaternionTitle' : 
                     (axis === 'x' ? 'resetPositionXTitle' : axis === 'y' ? 'resetPositionYTitle' : 'resetPositionZTitle');
    resetBtn.title = i18n.t(titleKey);
    resetBtn.style.cssText = 'width: 20px; height: 20px; padding: 0; font-size: 14px; background: var(--bg-input); color: var(--text-secondary); border: 1px solid var(--border-primary); border-radius: 2px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease;';
    resetBtn.addEventListener('mouseover', () => {
      resetBtn.style.background = 'var(--bg-tertiary)';
    });
    resetBtn.addEventListener('mouseout', () => {
      resetBtn.style.background = 'var(--bg-input)';
    });
    resetBtn.addEventListener('click', () => {
      if (type === 'quaternion') {
        // 重置整个四元数
        this.resetQuaternion();
      } else if (type === 'position') {
        this.resetPosition(axis);
      }
    });
    
    slider.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      numberInput.value = value.toFixed(3);
      onChange(value);
      // 更新COM显示
      if (this.editor.showCOM && this.editor.comVisualizerRight && this.editor.robotRight) {
        this.editor.comVisualizerRight.update(this.editor.robotRight);
        // 触发包络线防抖更新
        this.editor.scheduleFootprintUpdate();
      }
    });
    
    numberInput.addEventListener('change', (e) => {
      let value = parseFloat(e.target.value);
      value = Math.max(min, Math.min(max, value));
      slider.value = value;
      numberInput.value = value.toFixed(3);
      onChange(value);
      // 更新COM显示
      if (this.editor.showCOM && this.editor.comVisualizerRight && this.editor.robotRight) {
        this.editor.comVisualizerRight.update(this.editor.robotRight);
        // 触发包络线防抖更新
        this.editor.scheduleFootprintUpdate();
      }
    });
    
    row.appendChild(slider);
    row.appendChild(numberInput);
    row.appendChild(resetBtn);
    
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
    
    if (length < 0.0001) {
      console.warn('⚠️ 四元数长度接近0，恢复为单位四元数');
      q.x = 0;
      q.y = 0;
      q.z = 0;
      q.w = 1;
    } else if (length > 0.0001) {
      const oldLength = length;
      q.x /= length;
      q.y /= length;
      q.z /= length;
      q.w /= length;
      
      if (Math.abs(oldLength - 1.0) > 0.01) {
        console.log(`🔄 四元数归一化: ${oldLength.toFixed(4)} → 1.0`);
      }
      
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
    
    // 更新COM显示
    if (this.editor.showCOM && this.editor.comVisualizerRight && this.editor.robotRight) {
      this.editor.comVisualizerRight.update(this.editor.robotRight);
      // 触发包络线防抖更新
      this.editor.scheduleFootprintUpdate();
    }
    
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

  resetPosition(axis) {
    // 重置单个position维度到base值
    if (this.editor.trajectoryManager.hasTrajectory()) {
      const currentFrame = this.editor.timelineController.getCurrentFrame();
      const baseState = this.editor.trajectoryManager.getBaseState(currentFrame);
      if (baseState) {
        const baseValue = baseState.base.position[axis];
        this.baseValues.position[axis] = baseValue;
        
        // 更新UI
        const container = document.getElementById('base-controls');
        const rows = container.querySelectorAll('.joint-control-row');
        rows.forEach(row => {
          const label = row.querySelector('span');
          if (label && label.textContent === axis.toUpperCase() + ':') {
            const slider = row.querySelector('input[type="range"]');
            const numberInput = row.querySelector('input[type="number"]');
            if (slider) slider.value = baseValue;
            if (numberInput) numberInput.value = baseValue.toFixed(3);
          }
        });
        
        this.applyBaseTransform();
        console.log(`✅ Position ${axis} 已重置到 base 值: ${baseValue.toFixed(3)}`);
      }
    }
  }

  resetQuaternion() {
    // 重置整个四元数到base值
    if (this.editor.trajectoryManager.hasTrajectory()) {
      const currentFrame = this.editor.timelineController.getCurrentFrame();
      const baseState = this.editor.trajectoryManager.getBaseState(currentFrame);
      if (baseState) {
        const baseQuat = baseState.base.quaternion;
        this.baseValues.quaternion = { ...baseQuat };
        
        // 更新UI
        const container = document.getElementById('base-controls');
        ['x', 'y', 'z', 'w'].forEach(axis => {
          const row = container.querySelector(`[data-quat-axis="${axis}"]`);
          if (row) {
            const slider = row.querySelector('input[type="range"]');
            const numberInput = row.querySelector('input[type="number"]');
            const value = baseQuat[axis];
            if (slider) slider.value = value;
            if (numberInput) numberInput.value = value.toFixed(3);
          }
        });
        
        this.applyBaseTransform();
        console.log('✅ Quaternion 已重置到 base 值');
      }
    }
  }
}
