// 多语言系统
const translations = {
  zh: {
    // 工具栏
    loadURDF: '加载 URDF 文件夹',
    loadCSV: '加载 CSV 轨迹',
    exportTrajectory: '导出编辑轨迹',
    exportBaseTrajectory: '导出原始轨迹',
    loadProject: '加载工程文件',
    saveProject: '保存工程文件',
    ready: '就绪',
    dataPrivacy: '本地处理，数据安全',
    
    // 视口标签
    baseTrajectory: '原始轨迹 (Base)',
    editedTrajectory: '编辑后 (Modified)',
    
    // 相机控制按钮
    rotate: '🔄 旋转',
    resetCamera: '🔄 重置视角',
    followOn: '🤖 跟随: 开',
    followOff: '🤖 跟随: 关',
    comOn: '🎯 重心: 开',
    comOff: '🎯 重心: 关',
    refreshFootprint: '👣 刷新包络线',
    autoRefreshOn: '⏱️ 自动刷新: 开',
    autoRefreshOff: '⏱️ 自动刷新: 关',
    
    // 基体控制
    baseControl: '▶ 基体控制 (Base)',
    jointControl: '关节控制',
    reset: '重置',
    
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
  },
  en: {
    // Toolbar
    loadURDF: 'Load URDF Folder',
    loadCSV: 'Load CSV Trajectory',
    exportTrajectory: 'Export Edited Trajectory',
    exportBaseTrajectory: 'Export Base Trajectory',
    loadProject: 'Load Project File',
    saveProject: 'Save Project File',
    ready: 'Ready',
    dataPrivacy: 'Local Processing, Data Secure',
    
    // Viewport labels
    baseTrajectory: 'Base Trajectory (Base)',
    editedTrajectory: 'Edited (Modified)',
    
    // Camera control buttons
    rotate: '🔄 Rotate',
    resetCamera: '🔄 Reset View',
    followOn: '🤖 Follow: On',
    followOff: '🤖 Follow: Off',
    comOn: '🎯 COM: On',
    comOff: '🎯 COM: Off',
    refreshFootprint: '👣 Refresh Footprint',
    autoRefreshOn: '⏱️ Auto Refresh: On',
    autoRefreshOff: '⏱️ Auto Refresh: Off',
    
    // Base control
    baseControl: '▶ Base Control (Base)',
    jointControl: 'Joint Control',
    reset: 'Reset',
    
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
