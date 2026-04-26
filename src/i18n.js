// 多语言系统
const translations = {
  zh: {
    // 工具栏
    loadURDF: '加载 URDF 文件夹',
    loadCSV: '加载 CSV 轨迹',
    export: '导出数据',
    project: '工程文件',
    exportTrajectory: '导出编辑轨迹',
    exportBaseTrajectory: '导出原始轨迹',
    exportVideo: '导出视频',
    stopRecording: '停止录制',
    loadProject: '加载工程文件',
    saveProject: '保存工程文件',
    ready: '就绪',
    dataPrivacy: '本地处理，数据安全',
    toggleTheme: '切换主题',
    
    // 视口标签
    baseTrajectory: '原始轨迹 (Base)',
    editedTrajectory: '编辑后 (Modified)',
    
    // 相机控制按钮
    rotate: '🔄 旋转',
    pan: '↔️ 平移',
    resetCamera: '🔄 重置视角',
    followOn: '🤖 跟随: 开',
    followOff: '🤖 跟随: 关',
    comOn: '🎯 重心: 开',
    comOff: '🎯 重心: 关',
    palmOn: '🖐 掌心: 开',
    palmOff: '🖐 掌心: 关',
    palmDistance: '掌距',
    refreshFootprint: '👣 刷新包络线',
    autoRefreshOn: '⏱️ 自动刷新: 开',
    autoRefreshOff: '⏱️ 自动刷新: 关',
    
    // 曲线编辑器
    curves: '📈 曲线',
    resetDefault: '恢复默认',
    interpolationLinear: '线性',
    interpolationBezier: '贝塞尔',
    interpolationMode: '插值模式',
    
    // 基体控制
    baseControl: '▶ 基体控制 (Base)',
    jointControl: '关节控制',
    jointGroupCenter: '中',
    jointGroupLeft: '左',
    jointGroupRight: '右',
    reset: '重置',
    alignLowest: '平移对齐',
    alignLowestTitle: '自动调整XYZ，让高度最低的link与原始轨迹对齐',
    
    // 时间轴
    addKeyframe: '添加关键帧',
    deleteKeyframe: '删除关键帧',
    zoomOut: '🔍-',
    zoomReset: '1:1',
    zoomIn: '🔍+',
    play: '▶ 播放',
    pause: '⏸ 暂停',
    fps: 'FPS',
    time: '时间',
    frame: '帧',
    totalTime: '总时长',
    zoom: '缩放',
    
    // 模态框
    appInfo: '🔒 应用信息',
    privacyTitle: '✅ 隐私保护',
    privacyText: '所有数据处理完全在您的浏览器本地完成，不会上传任何文件或数据到服务器。',
    hostingEnv: '托管环境',
    buildInfo: '构建信息',
    version: '版本',
    buildTime: '时间',
    branch: '分支',
    tag: '标签',
    domain: '域名',
    protocol: '协议',
    userAgent: 'User Agent',
    viewOnGitHub: '在 GitHub 上查看源代码',
    loading: '加载中...',
    
    // 状态信息
    copySuccess: '已复制',
    position: '位置',
    quaternion: '四元数',
    
    // 提示文本
    zoomOutTitle: '缩小时间轴',
    zoomResetTitle: '重置缩放',
    zoomInTitle: '放大时间轴',
    copyHostingTitle: '复制托管信息',
    copyBuildTitle: '复制构建信息',
    resetQuaternionTitle: '重置四元数',
    resetPositionXTitle: '重置 X',
    resetPositionYTitle: '重置 Y',
    resetPositionZTitle: '重置 Z',
    resetBaseTitle: '重置基体',
    resetJointTitle: '重置 {name}',
    
    // 对话框文本
    needTrajectory: '请先加载 CSV 轨迹',
    needRobot: '请先加载机器人模型',
    exportFileName: '请输入导出文件名:',
    userCancel: '用户取消导出',
    loadError: '加载失败',
    refreshSuccess: '地面投影包络线已刷新',
    saveProjectFileName: '请输入工程文件名:',
    projectSaved: '工程文件已保存',
    projectLoaded: '工程文件已加载',
    exportVideoFileName: '请输入视频文件名:',
    needRobotForVideo: '请先加载机器人模型和轨迹',
    recordingStarted: '录制已开始',
    recordingFailed: '录制失败',
    recordingStopped: '录制已停止',
    noVideoData: '没有录制数据',
    videoExported: '视频已导出',
    exportingVideo: '导出视频中',
    renderingFrames: '渲染帧',
    encodingVideo: '编码视频',
    cancelExport: '取消导出',
    exportFailed: '导出失败',
    exportCancelled: '导出已取消',
    browserNotSupportVideoExport: '当前浏览器不支持视频导出功能',
    selectFPS: '选择视频帧率',
    useCSVFPS: '使用 CSV 帧率',
    useCustomFPS: '自定义帧率',
    csvInfo: 'CSV 信息',
    frames: '帧',
    confirm: '确认',
    cancel: '取消',
    videoFormat: '视频格式',
    videoOptions: '视频选项',
    addOverlay: '添加时间和帧数标记',
    addMetadata: '添加视频元数据信息',
    keepTabVisible: '请保持此标签页在前台<br>切换标签页会导致导出暂停',
    timeRemaining: '剩余时间',
    minutes: '分',
    seconds: '秒',
    estimating: '正在估算',
    encodingPleaseWait: '正在编码，请稍候',
    
    // 托管环境
    localDeployment: '本地部署',
    localDevelopment: '本地开发环境',
    cloudflarePages: 'Cloudflare Pages',
    vercelEnv: 'Vercel',
    netlifyEnv: 'Netlify',
    githubPages: 'GitHub Pages',
    otherEnv: '其他',
    hostingInfoLabel: '托管环境',
    domainLabel: '域名',
    protocolLabel: '协议',
    userAgentLabel: 'User Agent',
    
    // 状态消息
    ready: '就绪',
    loadingModel: '加载机器人模型中...',
    modelLoadSuccess: '机器人模型加载成功',
    loadingTrajectory: '加载轨迹中...',
    trajectoryLoadSuccess: '轨迹加载成功',
    loadingURDFFolder: '正在加载 URDF 文件夹...',
    urdfLoadSuccess: 'URDF 加载成功 (关节数: {count})',
    urdfLoadFailed: 'URDF 加载失败',
    loadingCSVFile: '正在加载 CSV 文件...',
    csvLoadSuccess: 'CSV 加载成功 (帧数: {frames}, FPS: {fps})',
    csvLoadFailed: 'CSV 加载失败',
    trajectoryExported: '轨迹已导出',
    baseTrajectoryExported: '原始轨迹已导出',
    loadProjectFailed: '加载工程文件失败',
    projectFileNotFound: '工程文件不存在',
    oldProjectVersion: '⚠️ 检测到旧版本工程文件！\n\n四元数运算已优化，建议：\n1. 重新加载CSV轨迹\n2. 重新创建所有关键帧\n\n否则可能出现姿态错误。',
    
    // 曲线编辑器
    curves: '📈 曲线',
    curveEditor: '📈 曲线编辑器',
    resetDefault: '恢复默认',
    
    // 使用说明
    userGuide: '📖 使用说明',
    basicWorkflow: '基本流程',
    coreFeatures: '核心功能',
    quickFeatures: '快捷功能',
    helpStep1: '加载 URDF：选择包含 URDF 和 mesh 文件的文件夹',
    helpStep2: '加载轨迹：加载 CSV 文件（前 7 列为 base xyz + 四元数 xyzw，后续为关节角度）',
    helpStep3: '创建关键帧：点击时间轴上的 + 按钮添加关键帧，然后调整参数编辑（点击自由度名称显示曲线，Shift+点击可多选）',
    helpStep4: '保存工程：保存完整的编辑状态（支持加载恢复）',
    helpStep5: '导出轨迹：导出融合后的 CSV 轨迹',
    helpFeature1: '双视口对比：左侧显示原始轨迹，右侧显示编辑结果，相机同步',
    helpFeature2: '曲线编辑器：可视化关节和基体随时间的变化曲线，支持贝塞尔插值',
    helpFeature3: '动力学可视化：实时显示重心位置和支撑多边形投影',
    helpFeature4: '工程保存/加载：保存完整工程状态（URDF、轨迹、关键帧、编辑历史）',
    helpQuick1: '平移对齐：基座控制中的"平移对齐"按钮可自动调整XYZ，使编辑后机器人的最低点与原始轨迹对齐',
    helpQuick2: '坐标轴指示器：右下角的3D轴指示器，点击X/Y/Z轴可快速切换到对应的正交视角',
    helpQuick3: '相机跟随：开启跟随模式后，相机会自动跟随机器人移动',
    helpQuick4: '重心显示：实时显示机器人重心位置和地面投影包络线',
    helpTip: '💡 提示',
    helpTipText: '所有数据处理完全在浏览器本地完成，不会上传任何文件或数据到服务器',
  },
  en: {
    // Toolbar
    loadURDF: 'Load URDF Folder',
    loadCSV: 'Load CSV Trajectory',    export: 'Export Data',
    project: 'Project Files',    exportTrajectory: 'Export Edited Trajectory',
    exportBaseTrajectory: 'Export Base Trajectory',
    exportVideo: 'Export Video',
    stopRecording: 'Stop Recording',
    loadProject: 'Load Project File',
    saveProject: 'Save Project File',
    ready: 'Ready',
    dataPrivacy: 'Local Processing, Data Secure',
    toggleTheme: 'Toggle Theme',
    
    // Viewport labels
    baseTrajectory: 'Base Trajectory (Base)',
    editedTrajectory: 'Edited (Modified)',
    
    // Camera control buttons
    rotate: '🔄 Rotate',
    pan: '↔️ Pan',
    resetCamera: '🔄 Reset View',
    followOn: '🤖 Follow: On',
    followOff: '🤖 Follow: Off',
    comOn: '🎯 COM: On',
    comOff: '🎯 COM: Off',
    palmOn: '🖐 Palm: On',
    palmOff: '🖐 Palm: Off',
    palmDistance: 'Palm distance',
    refreshFootprint: '👣 Refresh Footprint',
    autoRefreshOn: '⏱️ Auto Refresh: On',
    autoRefreshOff: '⏱️ Auto Refresh: Off',
    
    // Curve editor
    curves: '📈 Curves',
    resetDefault: 'Reset Default',
    interpolationLinear: 'Linear',
    interpolationBezier: 'Bezier',
    interpolationMode: 'Interpolation',
    
    // Base control
    baseControl: '▶ Base Control (Base)',
    jointControl: 'Joint Control',
    jointGroupCenter: 'Center',
    jointGroupLeft: 'Left',
    jointGroupRight: 'Right',
    reset: 'Reset',
    alignLowest: 'Align Lowest',
    alignLowestTitle: 'Auto-adjust XYZ to align the lowest link with the base trajectory',
    
    // Timeline
    addKeyframe: 'Add Keyframe',
    deleteKeyframe: 'Delete Keyframe',
    zoomOut: '🔍-',
    zoomReset: '1:1',
    zoomIn: '🔍+',
    play: '▶ Play',
    pause: '⏸ Pause',
    fps: 'FPS',
    time: 'Time',
    frame: 'Frame',
    totalTime: 'Total Duration',
    zoom: 'Zoom',
    
    // Modal
    appInfo: '🔒 App Information',
    privacyTitle: '✅ Privacy Protection',
    privacyText: 'All data processing is completed locally in your browser. No files or data will be uploaded to any server.',
    hostingEnv: 'Hosting Environment',
    buildInfo: 'Build Information',
    version: 'Version',
    buildTime: 'Time',
    branch: 'Branch',
    tag: 'Tag',
    domain: 'Domain',
    protocol: 'Protocol',
    userAgent: 'User Agent',
    viewOnGitHub: 'View Source Code on GitHub',
    loading: 'Loading...',
    
    // Status
    copySuccess: 'Copied',
    position: 'Position',
    quaternion: 'Quaternion',
    
    // Tooltips
    zoomOutTitle: 'Zoom out timeline',
    zoomResetTitle: 'Reset zoom',
    zoomInTitle: 'Zoom in timeline',
    copyHostingTitle: 'Copy hosting info',
    copyBuildTitle: 'Copy build info',
    resetQuaternionTitle: 'Reset quaternion',
    resetPositionXTitle: 'Reset X',
    resetPositionYTitle: 'Reset Y',
    resetPositionZTitle: 'Reset Z',
    resetBaseTitle: 'Reset base',
    resetJointTitle: 'Reset {name}',
    
    // Dialog texts
    needTrajectory: 'Please load CSV trajectory first',
    needRobot: 'Please load robot model first',
    exportFileName: 'Please enter export file name:',
    userCancel: 'User cancelled export',
    loadError: 'Load failed',
    refreshSuccess: 'Ground footprint refreshed',
    saveProjectFileName: 'Please enter project file name:',
    projectSaved: 'Project file saved',
    projectLoaded: 'Project file loaded',
    exportVideoFileName: 'Please enter video file name:',
    needRobotForVideo: 'Please load robot model and trajectory first',
    recordingStarted: 'Recording started',
    recordingFailed: 'Recording failed',
    recordingStopped: 'Recording stopped',
    noVideoData: 'No video data recorded',
    videoExported: 'Video exported',
    exportingVideo: 'Exporting Video',
    renderingFrames: 'Rendering frames',
    encodingVideo: 'Encoding video',
    cancelExport: 'Cancel Export',
    exportFailed: 'Export failed',
    exportCancelled: 'Export cancelled',
    browserNotSupportVideoExport: 'Your browser does not support video export',
    selectFPS: 'Select Video Frame Rate',
    useCSVFPS: 'Use CSV Frame Rate',
    useCustomFPS: 'Custom Frame Rate',
    csvInfo: 'CSV Info',
    frames: 'frames',
    confirm: 'Confirm',
    cancel: 'Cancel',
    videoFormat: 'Video Format',
    videoOptions: 'Video Options',
    addOverlay: 'Add time and frame overlay',
    addMetadata: 'Add video metadata',    keepTabVisible: 'Keep this tab in foreground<br>Switching tabs will pause export',    timeRemaining: 'Time remaining',
    minutes: 'min',
    seconds: 's',
    estimating: 'Estimating',
    encodingPleaseWait: 'Encoding, please wait',
    
    // Hosting environments
    localDeployment: 'Local Deployment',
    localDevelopment: 'Local Development',
    cloudflarePages: 'Cloudflare Pages',
    vercelEnv: 'Vercel',
    netlifyEnv: 'Netlify',
    githubPages: 'GitHub Pages',
    otherEnv: 'Other',
    hostingInfoLabel: 'Hosting Environment',
    domainLabel: 'Domain',
    protocolLabel: 'Protocol',
    userAgentLabel: 'User Agent',
    
    // Status messages
    ready: 'Ready',
    loadingModel: 'Loading robot model...',
    modelLoadSuccess: 'Robot model loaded successfully',
    loadingTrajectory: 'Loading trajectory...',
    trajectoryLoadSuccess: 'Trajectory loaded successfully',
    loadingURDFFolder: 'Loading URDF folder...',
    urdfLoadSuccess: 'URDF loaded successfully (Joints: {count})',
    urdfLoadFailed: 'URDF load failed',
    loadingCSVFile: 'Loading CSV file...',
    csvLoadSuccess: 'CSV loaded successfully (Frames: {frames}, FPS: {fps})',
    csvLoadFailed: 'CSV load failed',
    trajectoryExported: 'Trajectory exported',
    baseTrajectoryExported: 'Base trajectory exported',
    loadProjectFailed: 'Load project file failed',
    projectFileNotFound: 'Project file not found',
    oldProjectVersion: '⚠️ Old project file version detected!\n\nQuaternion operations have been optimized. It is recommended to:\n1. Reload the CSV trajectory\n2. Recreate all keyframes\n\nOtherwise, pose errors may occur.',    
    // Curve Editor
    curves: '📈 Curves',
    curveEditor: '📈 Curve Editor',
    resetDefault: 'Reset Default',
    
    // User Guide
    userGuide: '📖 User Guide',
    basicWorkflow: 'Basic Workflow',
    coreFeatures: 'Core Features',
    quickFeatures: 'Quick Features',
    helpStep1: 'Load URDF: Select a folder containing URDF and mesh files',
    helpStep2: 'Load Trajectory: Load a CSV file (first 7 columns: base xyz + quaternion xyzw, followed by joint angles)',
    helpStep3: 'Create Keyframes: Click the + button on the timeline to add keyframes, then adjust parameters to edit (click DOF names to show curves, Shift+click for multiple)',
    helpStep4: 'Save Project: Save the complete editing state (can be loaded to restore)',
    helpStep5: 'Export Trajectory: Export the combined CSV trajectory',
    helpFeature1: 'Dual-Viewport Comparison: Original trajectory on the left, edited results on the right with synchronized camera',
    helpFeature2: 'Curve Editor: Visualize joint and base changes over time with Bezier interpolation support',
    helpFeature3: 'Dynamics Visualization: Real-time display of center of mass position and contact polygon projection',
    helpFeature4: 'Project Save/Load: Save complete project state (URDF, trajectories, keyframes, edit history)',
    helpQuick1: 'Align Lowest: The "Align Lowest" button in base control auto-adjusts XYZ to align the edited robot\'s lowest point with the base trajectory',
    helpQuick2: 'Axis Gizmo: The 3D axis indicator in the bottom-right corner allows quick switching to orthogonal views by clicking X/Y/Z axes',
    helpQuick3: 'Follow Robot: When follow mode is enabled, the camera automatically follows the robot movement',
    helpQuick4: 'COM Display: Real-time display of robot center of mass and ground projection footprint',
    helpTip: '💡 Tip',
    helpTipText: 'All data processing is completed locally in your browser. No files or data will be uploaded to any server',
  }
};

class I18n {
  constructor() {
    this.currentLanguage = this.detectLanguage();
  }

  detectLanguage() {
    // 1. 检查 localStorage 中的语言偏好
    const savedLang = localStorage.getItem('app-language');
    if (savedLang === 'en' || savedLang === 'zh') {
      return savedLang;
    }

    // 2. 检查 URL 参数
    const urlParams = new URLSearchParams(window.location.search);
    const urlLang = urlParams.get('lang');
    if (urlLang === 'en' || urlLang === 'zh') {
      return urlLang;
    }

    // 3. 检查浏览器语言设置 (navigator.languages 和 navigator.language)
    const browserLangs = navigator.languages || [navigator.language];
    for (const lang of browserLangs) {
      // 检查是否为中文（包括简体和繁体）
      if (lang.toLowerCase().includes('zh')) {
        return 'zh';
      }
    }

    // 4. 检查 navigator.language
    if (navigator.language.toLowerCase().includes('zh')) {
      return 'zh';
    }

    // 默认使用英语
    return 'en';
  }

  setLanguage(lang) {
    if (lang === 'zh' || lang === 'en') {
      this.currentLanguage = lang;
      localStorage.setItem('app-language', lang);
      return true;
    }
    return false;
  }

  getLanguage() {
    return this.currentLanguage;
  }

  t(key, params = {}) {
    const trans = translations[this.currentLanguage];
    let text = trans[key] || translations.en[key] || key;
    
    // 替换参数
    if (params && Object.keys(params).length > 0) {
      Object.keys(params).forEach(paramKey => {
        text = text.replace(new RegExp(`{${paramKey}}`, 'g'), params[paramKey]);
      });
    }
    
    return text;
  }

  // 批量获取翻译
  tAll() {
    return translations[this.currentLanguage] || translations.en;
  }
}

export const i18n = new I18n();
