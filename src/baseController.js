import * as THREE from 'three';
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
    
    // 添加自动对齐按钮
    const alignBtn = document.createElement('button');
    alignBtn.textContent = '平移对齐';
    alignBtn.title = '自动调整XYZ，让高度最低的link与原始轨迹对齐';
    alignBtn.style.cssText = 'margin-left: 10px; padding: 2px 8px; font-size: 11px; background: var(--success-color); color: white; border: none; border-radius: 3px; cursor: pointer; transition: background-color 0.2s;';
    alignBtn.addEventListener('mouseenter', () => {
      alignBtn.style.opacity = '0.8';
    });
    alignBtn.addEventListener('mouseleave', () => {
      alignBtn.style.opacity = '1';
    });
    alignBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.alignLowestLink();
    });
    header.appendChild(alignBtn);
    
    // 添加全局重置按钮
    const resetAllBtn = document.createElement('button');
    resetAllBtn.textContent = '重置';
    resetAllBtn.title = i18n.t('resetBaseTitle');
    resetAllBtn.style.cssText = 'margin-left: 5px; padding: 2px 8px; font-size: 11px; background: var(--accent-primary); color: white; border: none; border-radius: 3px; cursor: pointer; transition: background-color 0.2s;';
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

    // Position 控制 - 每个轴独立（类似关节控制）
    ['x', 'y', 'z'].forEach(axis => {
      const control = document.createElement('div');
      control.className = 'joint-control'; // 复用关节控制的样式
      control.dataset.baseAxis = `pos_${axis}`;
      control.style.transition = 'background-color 0.2s';

      const label = document.createElement('label');
      label.style.cssText = 'cursor: pointer; display: flex; align-items: center; user-select: none;';
      label.title = '点击切换曲线显示';
      
      const labelText = document.createElement('span');
      labelText.textContent = `Position ${axis.toUpperCase()}`;
      label.appendChild(labelText);
      
      // 添加关键帧状态圈圈
      const keyframeIndicator = document.createElement('span');
      keyframeIndicator.id = `keyframe-indicator-base-pos-${axis}`;
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
          const curveKey = `base_pos_${axis}`;
          const visible = this.editor.curveEditor.toggleCurveVisibility(curveKey, e.shiftKey);
          const color = this.editor.curveEditor.getCurveColor(curveKey);
          if (color) {
            if (visible) {
              control.style.backgroundColor = color + '20';
            } else {
              control.style.backgroundColor = '';
            }
          }
        }
      });
      
      // 初始化显示状态
      setTimeout(() => {
        if (this.editor.curveEditor) {
          const curveKey = `base_pos_${axis}`;
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
      
      row.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      // 滑块
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = -10;
      slider.max = 10;
      slider.step = 0.01;
      slider.value = 0;
      
      slider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        this.baseValues.position[axis] = value;
        numberInput.value = value.toFixed(3);
        this.applyBaseTransform();
      });
      
      row.appendChild(slider);

      // 数字输入
      const numberInput = document.createElement('input');
      numberInput.type = 'number';
      numberInput.min = -10;
      numberInput.max = 10;
      numberInput.step = 0.01;
      numberInput.value = '0.000';
      
      numberInput.addEventListener('change', (e) => {
        let value = parseFloat(e.target.value);
        value = Math.max(-10, Math.min(10, value));
        this.baseValues.position[axis] = value;
        slider.value = value;
        numberInput.value = value.toFixed(3);
        this.applyBaseTransform();
      });
      
      row.appendChild(numberInput);

      // 重置按钮
      const resetBtn = document.createElement('button');
      resetBtn.innerHTML = '↺';
      resetBtn.title = `重置 Position ${axis.toUpperCase()}`;
      resetBtn.style.cssText = 'width: 20px; height: 20px; padding: 0; font-size: 14px; background: var(--bg-input); color: var(--text-secondary); border: 1px solid var(--border-primary); border-radius: 2px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease;';
      resetBtn.addEventListener('mouseover', () => {
        resetBtn.style.background = 'var(--bg-tertiary)';
      });
      resetBtn.addEventListener('mouseout', () => {
        resetBtn.style.background = 'var(--bg-input)';
      });
      resetBtn.addEventListener('click', () => {
        this.resetPosition(axis);
      });
      
      row.appendChild(resetBtn);
      control.appendChild(row);
      container.appendChild(control);
    });

    // Quaternion 控制 - 整体但使用类似关节的样式
    const quatControl = document.createElement('div');
    quatControl.className = 'joint-control';
    quatControl.dataset.baseAxis = 'quat';
    quatControl.style.transition = 'background-color 0.2s';

    // 创建标题行容器（包含label和重置按钮）
    const quatHeaderRow = document.createElement('div');
    quatHeaderRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;';
    
    const quatLabel = document.createElement('label');
    quatLabel.style.cssText = 'cursor: pointer; display: flex; align-items: center; user-select: none;';
    quatLabel.title = '点击切换四元数欧拉角可视化';
    
    const quatLabelText = document.createElement('span');
    quatLabelText.textContent = 'Quaternion (Euler)';
    quatLabel.appendChild(quatLabelText);
    
    // 添加关键帧状态圈圈
    const quatKeyframeIndicator = document.createElement('span');
    quatKeyframeIndicator.id = 'keyframe-indicator-base-quat';
    quatKeyframeIndicator.style.cssText = `
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
    quatLabel.appendChild(quatKeyframeIndicator);
    
    quatHeaderRow.appendChild(quatLabel);
    
    // 点击label切换欧拉角可视化
    quatLabel.addEventListener('click', (e) => {
      if (this.editor.curveEditor) {
        const visible = this.editor.curveEditor.toggleQuaternionVisualization(e.shiftKey);
        const color = this.editor.curveEditor.getCurveColor('base_euler_x');
        if (color) {
          if (visible) {
            quatControl.style.backgroundColor = color + '20';
          } else {
            quatControl.style.backgroundColor = '';
          }
        }
      }
    });
    
    // 初始化显示状态
    setTimeout(() => {
      if (this.editor.curveEditor) {
        const visible = this.editor.curveEditor.isQuaternionVisualizationVisible();
        const color = this.editor.curveEditor.getCurveColor('base_euler_x');
        if (color && visible) {
          quatControl.style.backgroundColor = color + '20';
        }
      }
    }, 100);
    
    // 创建重置按钮（放在标题行右侧）
    const quatResetBtn = document.createElement('button');
    quatResetBtn.innerHTML = '↺';
    quatResetBtn.title = '重置整个四元数';
    quatResetBtn.style.cssText = 'width: 20px; height: 20px; padding: 0; font-size: 14px; background: var(--bg-input); color: var(--text-secondary); border: 1px solid var(--border-primary); border-radius: 2px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease;';
    quatResetBtn.addEventListener('mouseover', () => {
      quatResetBtn.style.background = 'var(--bg-tertiary)';
    });
    quatResetBtn.addEventListener('mouseout', () => {
      quatResetBtn.style.background = 'var(--bg-input)';
    });
    quatResetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.resetQuaternion();
    });
    
    quatHeaderRow.appendChild(quatResetBtn);
    quatControl.appendChild(quatHeaderRow);
    
    // Quaternion 控制行
    ['x', 'y', 'z', 'w'].forEach(axis => {
      const row = document.createElement('div');
      row.className = 'joint-control-row';
      row.dataset.quatAxis = axis;
      row.style.cssText = 'padding-left: 10px;';
      
      row.addEventListener('click', (e) => {
        e.stopPropagation();
      });
      
      // 轴标签
      const axisLabel = document.createElement('span');
      axisLabel.textContent = axis.toUpperCase() + ':';
      axisLabel.style.cssText = 'width: 20px; font-size: 11px; color: var(--text-primary); transition: color 0.3s ease;';
      row.appendChild(axisLabel);

      // 滑块
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = -1;
      slider.max = 1;
      slider.step = 0.01;
      slider.value = axis === 'w' ? 1 : 0;
      slider.style.flex = '1';
      
      slider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        this.baseValues.quaternion[axis] = value;
        numberInput.value = value.toFixed(3);
        this.normalizeQuaternion();
        this.applyBaseTransform();
      });
      
      row.appendChild(slider);

      // 数字输入
      const numberInput = document.createElement('input');
      numberInput.type = 'number';
      numberInput.min = -1;
      numberInput.max = 1;
      numberInput.step = 0.01;
      numberInput.value = axis === 'w' ? '1.000' : '0.000';
      numberInput.style.cssText = 'width: 70px; padding: 2px 4px; background: var(--bg-input); border: 1px solid var(--border-primary); color: var(--text-primary); border-radius: 2px; font-size: 11px; transition: all 0.3s ease;';
      
      numberInput.addEventListener('change', (e) => {
        let value = parseFloat(e.target.value);
        value = Math.max(-1, Math.min(1, value));
        this.baseValues.quaternion[axis] = value;
        slider.value = value;
        numberInput.value = value.toFixed(3);
        this.normalizeQuaternion();
        this.applyBaseTransform();
      });
      
      row.appendChild(numberInput);
      
      quatControl.appendChild(row);
    });
    
    container.appendChild(quatControl);
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
    
    // 防止递归调用
    if (this.editor.isUpdatingKeyframe) {
      return;
    }
    
    const currentFrame = this.editor.timelineController.getCurrentFrame();
    
    if (this.editor.trajectoryManager.keyframes.has(currentFrame)) {
      this.editor.isUpdatingKeyframe = true;
      
      const currentJointValues = this.editor.jointController.getCurrentJointValues();
      const currentBaseValues = this.getCurrentBaseValues();
      this.editor.trajectoryManager.addKeyframe(currentFrame, currentJointValues, currentBaseValues);
      
      // 使用防抖版本更新曲线编辑器，避免短时间内多次绘制
      if (this.editor.curveEditor) {
        this.editor.curveEditor.drawDebounced();
      }
      
      this.editor.isUpdatingKeyframe = false;
    }
  }

  updateBase(position, quaternion) {
    this.baseValues.position = { ...position };
    this.baseValues.quaternion = { ...quaternion };
    
    const container = document.getElementById('base-controls');
    if (!container) return;
    
    // 更新 position UI - 使用新的独立控制结构
    ['x', 'y', 'z'].forEach(axis => {
      const control = container.querySelector(`[data-base-axis="pos_${axis}"]`);
      if (control) {
        const slider = control.querySelector('input[type="range"]');
        const numberInput = control.querySelector('input[type="number"]');
        const value = position[axis];
        if (slider && slider.min <= value && slider.max >= value) {
          slider.value = value;
          if (numberInput) numberInput.value = value.toFixed(3);
        }
      }
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
  
  /**
   * 自动对齐最低link - 调整XYZ使得编辑后轨迹中高度最低的link与原始轨迹对齐
   */
  alignLowestLink() {
    if (!this.editor.robotLeft || !this.editor.robotRight) {
      console.warn('未加载机器人模型');
      return;
    }
    
    // 找到左侧（原始轨迹）机器人中高度最低的link
    let lowestLinkLeft = null;
    let lowestHeightLeft = Infinity;
    
    this.editor.robotLeft.traverse((child) => {
      if (child.isURDFLink) {
        const worldPos = new THREE.Vector3();
        child.getWorldPosition(worldPos);
        if (worldPos.z < lowestHeightLeft) {
          lowestHeightLeft = worldPos.z;
          lowestLinkLeft = child;
        }
      }
    });
    
    if (!lowestLinkLeft) {
      console.warn('未找到最低link');
      return;
    }
    
    // 找到右侧（编辑后轨迹）机器人中对应的link（同名）
    let correspondingLinkRight = null;
    this.editor.robotRight.traverse((child) => {
      if (child.isURDFLink && child.name === lowestLinkLeft.name) {
        correspondingLinkRight = child;
      }
    });
    
    if (!correspondingLinkRight) {
      console.warn('未找到对应的右侧link');
      return;
    }
    
    // 获取两个link的世界坐标位置
    const leftPos = new THREE.Vector3();
    lowestLinkLeft.getWorldPosition(leftPos);
    
    const rightPos = new THREE.Vector3();
    correspondingLinkRight.getWorldPosition(rightPos);
    
    // 计算XYZ方向的偏移量
    const offsetX = leftPos.x - rightPos.x;
    const offsetY = leftPos.y - rightPos.y;
    const offsetZ = leftPos.z - rightPos.z;
    
    // 应用偏移到基座位置
    this.baseValues.position.x += offsetX;
    this.baseValues.position.y += offsetY;
    this.baseValues.position.z += offsetZ;
    
    // 更新UI
    const container = document.getElementById('base-controls');
    ['x', 'y', 'z'].forEach(axis => {
      const control = container.querySelector(`[data-base-axis="pos_${axis}"]`);
      if (control) {
        const slider = control.querySelector('input[type="range"]');
        const numberInput = control.querySelector('input[type="number"]');
        const value = this.baseValues.position[axis];
        if (slider) slider.value = value;
        if (numberInput) numberInput.value = value.toFixed(3);
      }
    });
    
    // 应用变换
    this.applyBaseTransform();
    
    console.log(`✅ 已对齐最低link: ${lowestLinkLeft.name}`);
    console.log(`   偏移: X=${offsetX.toFixed(3)}m, Y=${offsetY.toFixed(3)}m, Z=${offsetZ.toFixed(3)}m`);
  }

  resetPosition(axis) {
    // 重置单个position维度到base值
    if (this.editor.trajectoryManager.hasTrajectory()) {
      const currentFrame = this.editor.timelineController.getCurrentFrame();
      const baseState = this.editor.trajectoryManager.getBaseState(currentFrame);
      if (baseState) {
        const baseValue = baseState.base.position[axis];
        this.baseValues.position[axis] = baseValue;
        
        // 更新UI - 使用新的独立控制结构
        const container = document.getElementById('base-controls');
        const control = container.querySelector(`[data-base-axis="pos_${axis}"]`);
        if (control) {
          const slider = control.querySelector('input[type="range"]');
          const numberInput = control.querySelector('input[type="number"]');
          if (slider) slider.value = baseValue;
          if (numberInput) numberInput.value = baseValue.toFixed(3);
        }
        
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
  
  updateCurveBackgrounds() {
    // 更新position控制的背景色
    ['x', 'y', 'z'].forEach(axis => {
      const control = document.querySelector(`[data-base-axis="pos_${axis}"]`);
      if (control && this.editor.curveEditor) {
        const curveKey = `base_pos_${axis}`;
        const visible = this.editor.curveEditor.isCurveVisible(curveKey);
        const color = this.editor.curveEditor.getCurveColor(curveKey);
        if (color && visible) {
          control.style.backgroundColor = color + '20';
        } else {
          control.style.backgroundColor = '';
        }
      }
    });
    
    // 更新quaternion控制的背景色
    const quatControl = document.querySelector('[data-base-axis="quat"]');
    if (quatControl && this.editor.curveEditor) {
      const visible = this.editor.curveEditor.isQuaternionVisualizationVisible();
      const color = this.editor.curveEditor.getCurveColor('base_euler_x');
      if (color && visible) {
        quatControl.style.backgroundColor = color + '20';
      } else {
        quatControl.style.backgroundColor = '';
      }
    }
  }
  
  updateKeyframeIndicators() {
    if (!this.editor.trajectoryManager || !this.editor.trajectoryManager.hasTrajectory()) {
      // 隐藏所有indicator
      ['x', 'y', 'z'].forEach(axis => {
        const indicator = document.getElementById(`keyframe-indicator-base-pos-${axis}`);
        if (indicator) indicator.style.display = 'none';
      });
      const quatIndicator = document.getElementById('keyframe-indicator-base-quat');
      if (quatIndicator) quatIndicator.style.display = 'none';
      return;
    }
    
    const currentFrame = this.editor.timelineController.getCurrentFrame();
    const keyframes = this.editor.trajectoryManager.getKeyframes();
    
    // 检查position各轴
    ['x', 'y', 'z'].forEach(axis => {
      const indicator = document.getElementById(`keyframe-indicator-base-pos-${axis}`);
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
        const hasResidual = keyframes[i].baseResidual && 
                           keyframes[i].baseResidual.position &&
                           Math.abs(keyframes[i].baseResidual.position[axis] || 0) > 0.001;
        
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
      } else if (hasOtherResidual) {
        // 空心圈：其他关键帧有残差
        indicator.style.display = 'inline-block';
        indicator.style.backgroundColor = 'transparent';
        indicator.style.borderColor = '#f4b942';
      } else {
        indicator.style.display = 'none';
      }
    });
    
    // 检查quaternion
    const quatIndicator = document.getElementById('keyframe-indicator-base-quat');
    if (quatIndicator) {
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
      
      const checkQuatResidual = (kf) => {
        if (kf.baseResidual && kf.baseResidual.quaternion) {
          const q = kf.baseResidual.quaternion;
          return Math.abs(q.x) > 0.001 || Math.abs(q.y) > 0.001 || 
                 Math.abs(q.z) > 0.001 || Math.abs(q.w - 1) > 0.001;
        }
        return false;
      };
      
      // 遍历所有关键帧，分类检查残差
      for (let i = 0; i < keyframes.length; i++) {
        const hasResidual = checkQuatResidual(keyframes[i]);
        
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
        quatIndicator.style.display = 'inline-block';
        quatIndicator.style.backgroundColor = '#f4b942';
        quatIndicator.style.borderColor = '#f4b942';
      } else if (hasOtherResidual) {
        // 空心圈：其他关键帧有残差
        quatIndicator.style.display = 'inline-block';
        quatIndicator.style.backgroundColor = 'transparent';
        quatIndicator.style.borderColor = '#f4b942';
      } else {
        quatIndicator.style.display = 'none';
      }
    }
  }
}
