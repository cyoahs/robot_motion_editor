import { i18n } from './i18n.js';
import { JOINT_GROUPS, groupJointsBySide } from './jointGrouping.js';

export class JointController {
  constructor(joints, editor) {
    console.log('🎮 JointController 构造函数');
    console.log('接收到的关节数量:', joints.length);
    console.log('关节详情:', joints);
    
    this.joints = joints;
    this.editor = editor;
    this.jointValues = new Array(joints.length).fill(0);
    
    console.log('🔧 开始设置 UI...');
    this.setupUI();
    console.log('✅ JointController 初始化完成');
  }

  setupUI() {
    console.log('📋 setupUI 开始');
    const container = document.getElementById('joint-controls');
    
    if (!container) {
      console.error('❌ 找不到 joint-controls 容器');
      return;
    }
    
    console.log('✅ 找到 joint-controls 容器');
    container.innerHTML = '';

    const groupedJoints = groupJointsBySide(this.joints);

    console.log(`🔄 创建 ${this.joints.length} 个关节控制器...`);
    JOINT_GROUPS.forEach((group) => {
      const section = this.createGroupSection(group, groupedJoints[group.key].length);
      const sectionBody = section.querySelector('.joint-group-body');

      groupedJoints[group.key].forEach(({ joint, index }) => {
        console.log(`  - 创建关节 ${index}: ${joint.name}`);
        const control = document.createElement('div');
        control.className = 'joint-control';
        control.dataset.jointIndex = index;
        control.style.transition = 'background-color 0.2s';

        const label = document.createElement('label');
        label.style.cssText = 'cursor: pointer; display: flex; align-items: center; user-select: none;';
        label.title = '点击切换曲线显示';
        
        const labelText = document.createElement('span');
        labelText.textContent = joint.name || `Joint ${index + 1}`;
        label.appendChild(labelText);
        
        // 添加关键帧状态圈圈
        const keyframeIndicator = document.createElement('span');
        keyframeIndicator.id = `keyframe-indicator-${index}`;
        keyframeIndicator.style.cssText = `
          display: none;
          width: 10px;
          height: 10px;
          min-width: 10px;
          min-height: 10px;
          border-radius: 50%;
          margin-left: 8px;
          border: 2px solid #f4b942;
          box-sizing: border-box;
          flex-shrink: 0;
        `;
        label.appendChild(keyframeIndicator);
        
        // 点击label切换曲线可见性
        label.addEventListener('click', (e) => {
          if (this.editor.curveEditor) {
            const curveKey = `joint_${index}`;
            const visible = this.editor.curveEditor.toggleCurveVisibility(curveKey, e.shiftKey);
            const color = this.editor.curveEditor.getCurveColor(curveKey);
            if (color) {
              // 更新背景色
              if (visible) {
                control.style.backgroundColor = color + '20'; // 20% 透明度
              } else {
                control.style.backgroundColor = '';
              }
            }
          }
        });
        
        // 初始化显示状态
        setTimeout(() => {
          if (this.editor.curveEditor) {
            const curveKey = `joint_${index}`;
            const visible = this.editor.curveEditor.isCurveVisible(curveKey);
            const color = this.editor.curveEditor.getCurveColor(curveKey);
            if (color && visible) {
              control.style.backgroundColor = color + '20';
            }
          }
        }, 100);
        
        control.appendChild(label);

        // 创建水平布局容器
        const row = document.createElement('div');
        row.className = 'joint-control-row';
        
        // 阻止row内的点击事件冒泡到control
        row.addEventListener('click', (e) => {
          e.stopPropagation();
        });

        // 滑块
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = joint.limits.lower;
        slider.max = joint.limits.upper;
        slider.step = 0.01;
        slider.value = 0;
        slider.dataset.jointIndex = index;
        
        slider.addEventListener('input', (e) => {
          const value = parseFloat(e.target.value);
          this.jointValues[index] = value;
          numberInput.value = value.toFixed(3);
          this.applyJointValue(index, value);
        });
        
        row.appendChild(slider);

        // 数字输入（放在滑块右边）
        const numberInput = document.createElement('input');
        numberInput.type = 'number';
        numberInput.min = joint.limits.lower;
        numberInput.max = joint.limits.upper;
        numberInput.step = 0.01;
        numberInput.value = '0.000';
        numberInput.dataset.jointIndex = index;
        
        numberInput.addEventListener('change', (e) => {
          let value = parseFloat(e.target.value);
          value = Math.max(joint.limits.lower, Math.min(joint.limits.upper, value));
          this.jointValues[index] = value;
          slider.value = value;
          numberInput.value = value.toFixed(3);
          this.applyJointValue(index, value);
        });
        
        row.appendChild(numberInput);

        // 添加重置按钮
        const resetBtn = document.createElement('button');
        resetBtn.innerHTML = '↺';
        resetBtn.title = joint.name ? `${i18n.t('resetJointTitle').replace('{name}', joint.name)}` : `Reset Joint ${index + 1}`;
        resetBtn.style.cssText = 'width: 20px; height: 20px; padding: 0; font-size: 14px; background: var(--bg-input); color: var(--text-secondary); border: 1px solid var(--border-primary); border-radius: 2px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease;';
        resetBtn.addEventListener('mouseover', () => {
          resetBtn.style.background = 'var(--bg-tertiary)';
        });
        resetBtn.addEventListener('mouseout', () => {
          resetBtn.style.background = 'var(--bg-input)';
        });
        resetBtn.addEventListener('click', () => {
          this.resetJoint(index);
        });
        
        row.appendChild(resetBtn);
        control.appendChild(row);
        sectionBody.appendChild(control);
      });

      container.appendChild(section);
    });
    
    console.log(`✅ ${this.joints.length} 个关节控制器创建完成`);
  }

  createGroupSection(group, count) {
    const section = document.createElement('div');
    section.className = 'joint-group-section';
    section.dataset.jointGroup = group.key;

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'joint-group-header';
    header.style.cssText = `
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 0 0 8px 0;
      padding: 6px 8px;
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border: 1px solid var(--border-primary);
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      transition: background-color 0.2s ease, border-color 0.2s ease;
    `;

    const label = document.createElement('span');
    const labelText = document.createElement('span');
    labelText.dataset.i18n = group.labelKey;
    labelText.textContent = i18n.t(group.labelKey) || group.fallbackLabel;
    label.appendChild(labelText);
    label.appendChild(document.createTextNode(` (${count})`));
    header.appendChild(label);

    const icon = document.createElement('span');
    icon.textContent = '▼';
    icon.style.fontSize = '10px';
    header.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'joint-group-body';
    body.style.marginBottom = '10px';

    header.addEventListener('click', () => {
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      icon.textContent = collapsed ? '▼' : '▶';
    });

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  updateKeyframeIndicators() {
    const t0 = performance.now();
    
    if (!this.editor.trajectoryManager || !this.editor.trajectoryManager.hasTrajectory()) {
      // 没有轨迹时隐藏所有圈圈
      this.joints.forEach((joint, index) => {
        const indicator = document.getElementById(`keyframe-indicator-${index}`);
        if (indicator) {
          indicator.style.display = 'none';
        }
      });
      return;
    }
    
    const currentFrame = this.editor.timelineController.getCurrentFrame();
    const keyframes = this.editor.trajectoryManager.getKeyframes();
    
    let totalVisible = 0;
    
    this.joints.forEach((joint, index) => {
      const indicator = document.getElementById(`keyframe-indicator-${index}`);
      if (!indicator) return;
      
      let hasAdjacentResidual = false;  // i-1, i, i+1 有残差
      let hasOtherResidual = false;     // 其他关键帧有残差
      let currentKeyframeIndex = -1;
      
      // 找到当前帧在关键帧列表中的位置
      for (let i = 0; i < keyframes.length; i++) {
        if (keyframes[i].frame === currentFrame) {
          currentKeyframeIndex = i;
          break;
        }
      }
      
      // 遍历所有关键帧，分类检查残差
      for (let i = 0; i < keyframes.length; i++) {
        const hasResidual = keyframes[i].residual && 
                           Math.abs(keyframes[i].residual[index] || 0) > 0.001;
        
        if (!hasResidual) continue;
        
        // 判断是否在相邻范围内（i-1, i, i+1）
        if (currentKeyframeIndex >= 0 && 
            i >= currentKeyframeIndex - 1 && 
            i <= currentKeyframeIndex + 1) {
          hasAdjacentResidual = true;
        } else {
          hasOtherResidual = true;
        }
      }
      
      if (hasAdjacentResidual) {
        // 实心圈：i-1、i 或 i+1 有残差
        indicator.style.display = 'inline-block';
        indicator.style.backgroundColor = '#f4b942';
        indicator.style.borderColor = '#f4b942';
        totalVisible++;
      } else if (hasOtherResidual) {
        // 空心圈：其他关键帧有残差
        indicator.style.display = 'inline-block';
        indicator.style.backgroundColor = 'transparent';
        indicator.style.borderColor = '#f4b942';
        totalVisible++;
      } else {
        // 不显示：完全没有残差
        indicator.style.display = 'none';
      }
    });
    
    const t1 = performance.now();
    console.log(`⏱️ updateKeyframeIndicators 耗时: ${(t1-t0).toFixed(2)}ms`);
  }
  
  updateCurveBackgrounds() {
    if (!this.editor.curveEditor) return;
    
    this.joints.forEach((joint, index) => {
      const control = this.getJointControl(index);
      if (!control) return;
      
      const curveKey = `joint_${index}`;
      const visible = this.editor.curveEditor.isCurveVisible(curveKey);
      const color = this.editor.curveEditor.getCurveColor(curveKey);
      
      if (color && visible) {
        control.style.backgroundColor = color + '20';
      } else {
        control.style.backgroundColor = '';
      }
    });
  }

  applyJointValue(index, value) {
    if (this.joints[index] && this.joints[index].joint) {
      this.joints[index].joint.setJointValue(value);
    }
    
    // 更新COM显示
    if (this.editor.showCOM) {
      if (this.editor.comVisualizerRight && this.editor.robotRight) {
        this.editor.comVisualizerRight.update(this.editor.robotRight);
      }
      // 触发包络线防抖更新
      this.editor.scheduleFootprintUpdate();
    }

    if (this.editor.updatePalmVisualizers) {
      this.editor.updatePalmVisualizers();
    }
    
    // 如果当前帧是关键帧，自动更新残差
    this.autoUpdateKeyframe();
  }

  autoUpdateKeyframe() {
    if (!this.editor.trajectoryManager.hasTrajectory()) {
      return;
    }
    
    // 防止递归调用
    if (this.editor.isUpdatingKeyframe) {
      return;
    }
    
    const currentFrame = this.editor.timelineController.getCurrentFrame();
    
    // 如果当前帧是关键帧，自动更新
    if (this.editor.trajectoryManager.keyframes.has(currentFrame)) {
      const t0 = performance.now();
      this.editor.isUpdatingKeyframe = true;
      
      const t1 = performance.now();
      const currentJointValues = this.getCurrentJointValues();
      const t2 = performance.now();
      const currentBaseValues = this.editor.baseController ? 
        this.editor.baseController.getCurrentBaseValues() : null;
      const t3 = performance.now();
      this.editor.trajectoryManager.addKeyframe(currentFrame, currentJointValues, currentBaseValues);
      const t4 = performance.now();
      
      // 更新关键帧指示器
      this.updateKeyframeIndicators();
      const t5 = performance.now();
      
      // 使用防抖版本更新曲线编辑器，避免短时间内多次绘制
      if (this.editor.curveEditor) {
        this.editor.curveEditor.drawDebounced();
      }
      const t6 = performance.now();
      
      console.log(`⏱️ autoUpdateKeyframe 耗时: 总=${(t6-t0).toFixed(2)}ms | 获取joint=${(t2-t1).toFixed(2)}ms | 获取base=${(t3-t2).toFixed(2)}ms | 添加关键帧=${(t4-t3).toFixed(2)}ms | 更新指示器=${(t5-t4).toFixed(2)}ms | 调度绘制=${(t6-t5).toFixed(2)}ms`);
      
      this.editor.isUpdatingKeyframe = false;
    }
  }

  updateJoints(jointValues) {
    this.jointValues = [...jointValues];
    
    jointValues.forEach((value, index) => {
      const control = this.getJointControl(index);
      if (!control) return;
      
      const slider = control.querySelector('input[type="range"]');
      const numberInput = control.querySelector('input[type="number"]');
      
      if (slider) slider.value = value;
      if (numberInput) numberInput.value = value.toFixed(3);
      
      this.applyJointValue(index, value);
    });
    
    // 更新关键帧指示器
    this.updateKeyframeIndicators();
  }

  getCurrentJointValues() {
    return [...this.jointValues];
  }

  resetToBase() {
    // 重置到当前帧的base值
    if (this.editor.trajectoryManager.hasTrajectory()) {
      const currentFrame = this.editor.timelineController.getCurrentFrame();
      const baseState = this.editor.trajectoryManager.getBaseState(currentFrame);
      if (baseState) {
        this.updateJoints(baseState.joints);
        console.log('✅ 已重置到 CSV base 值');
      }
    } else {
      // 如果没有轨迹，重置到 0
      this.updateJoints(new Array(this.joints.length).fill(0));
      console.log('✅ 已重置到 0');
    }
  }

  resetJoint(index) {
    // 重置单个关节到base值
    if (this.editor.trajectoryManager.hasTrajectory()) {
      const currentFrame = this.editor.timelineController.getCurrentFrame();
      const baseState = this.editor.trajectoryManager.getBaseState(currentFrame);
      if (baseState) {
        const baseValue = baseState.joints[index];
        this.jointValues[index] = baseValue;
        
        // 更新UI
        const control = this.getJointControl(index);
        if (control) {
          const slider = control.querySelector('input[type="range"]');
          const numberInput = control.querySelector('input[type="number"]');
          if (slider) slider.value = baseValue;
          if (numberInput) numberInput.value = baseValue.toFixed(3);
        }
        
        this.applyJointValue(index, baseValue);
        console.log(`✅ 关节 ${index} 已重置到 base 值: ${baseValue.toFixed(3)}`);
      }
    } else {
      // 如果没有轨迹，重置到 0
      this.jointValues[index] = 0;
      const control = this.getJointControl(index);
      if (control) {
        const slider = control.querySelector('input[type="range"]');
        const numberInput = control.querySelector('input[type="number"]');
        if (slider) slider.value = 0;
        if (numberInput) numberInput.value = '0.000';
      }
      this.applyJointValue(index, 0);
      console.log(`✅ 关节 ${index} 已重置到 0`);
    }
  }

  getJointControl(index) {
    const container = document.getElementById('joint-controls');
    if (!container) return null;
    return container.querySelector(`.joint-control[data-joint-index="${index}"]`);
  }
}
