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

    console.log(`🔄 创建 ${this.joints.length} 个关节控制器...`);
    this.joints.forEach((joint, index) => {
      console.log(`  - 创建关节 ${index}: ${joint.name}`);
      const control = document.createElement('div');
      control.className = 'joint-control';

      const label = document.createElement('label');
      label.textContent = joint.name || `Joint ${index + 1}`;
      control.appendChild(label);

      // 创建水平布局容器
      const row = document.createElement('div');
      row.className = 'joint-control-row';

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
      resetBtn.title = `重置 ${joint.name || 'Joint ' + (index + 1)}`;
      resetBtn.style.cssText = 'width: 20px; height: 20px; padding: 0; font-size: 14px; background: #3c3c3c; color: #cccccc; border: 1px solid #3e3e42; border-radius: 2px; cursor: pointer; display: flex; align-items: center; justify-content: center;';
      resetBtn.addEventListener('mouseover', () => {
        resetBtn.style.background = '#505050';
      });
      resetBtn.addEventListener('mouseout', () => {
        resetBtn.style.background = '#3c3c3c';
      });
      resetBtn.addEventListener('click', () => {
        this.resetJoint(index);
      });
      
      row.appendChild(resetBtn);
      control.appendChild(row);
      container.appendChild(control);
    });
    
    console.log(`✅ ${this.joints.length} 个关节控制器创建完成`);
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
    
    // 如果当前帧是关键帧，自动更新残差
    this.autoUpdateKeyframe();
  }

  autoUpdateKeyframe() {
    if (!this.editor.trajectoryManager.hasTrajectory()) {
      return;
    }
    
    const currentFrame = this.editor.timelineController.getCurrentFrame();
    
    // 如果当前帧是关键帧，自动更新
    if (this.editor.trajectoryManager.keyframes.has(currentFrame)) {
      const currentJointValues = this.getCurrentJointValues();
      const currentBaseValues = this.editor.baseController ? 
        this.editor.baseController.getCurrentBaseValues() : null;
      this.editor.trajectoryManager.addKeyframe(currentFrame, currentJointValues, currentBaseValues);
      console.log(`✅ 自动更新关键帧 ${currentFrame} 的残差`);
    }
  }

  updateJoints(jointValues) {
    this.jointValues = [...jointValues];
    
    const container = document.getElementById('joint-controls');
    const controls = container.querySelectorAll('.joint-control');
    
    controls.forEach((control, index) => {
      if (index >= jointValues.length) return;
      
      const value = jointValues[index];
      const slider = control.querySelector('input[type="range"]');
      const numberInput = control.querySelector('input[type="number"]');
      
      if (slider) slider.value = value;
      if (numberInput) numberInput.value = value.toFixed(3);
      
      this.applyJointValue(index, value);
    });
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
        const container = document.getElementById('joint-controls');
        const controls = container.querySelectorAll('.joint-control');
        if (controls[index]) {
          const slider = controls[index].querySelector('input[type="range"]');
          const numberInput = controls[index].querySelector('input[type="number"]');
          if (slider) slider.value = baseValue;
          if (numberInput) numberInput.value = baseValue.toFixed(3);
        }
        
        this.applyJointValue(index, baseValue);
        console.log(`✅ 关节 ${index} 已重置到 base 值: ${baseValue.toFixed(3)}`);
      }
    } else {
      // 如果没有轨迹，重置到 0
      this.jointValues[index] = 0;
      const container = document.getElementById('joint-controls');
      const controls = container.querySelectorAll('.joint-control');
      if (controls[index]) {
        const slider = controls[index].querySelector('input[type="range"]');
        const numberInput = controls[index].querySelector('input[type="number"]');
        if (slider) slider.value = 0;
        if (numberInput) numberInput.value = '0.000';
      }
      this.applyJointValue(index, 0);
      console.log(`✅ 关节 ${index} 已重置到 0`);
    }
  }
}
