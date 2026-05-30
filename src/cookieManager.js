/**
 * Cookie 管理器 - 处理应用状态的自动保存和恢复
 */
import { IndexedDBManager } from './indexedDBManager.js';

export class CookieManager {
  constructor() {
    this.COOKIE_NAME = 'robot_editor_state';
    this.COOKIE_ENABLED_KEY = 'robot_editor_autosave';
    this.MAX_COOKIE_SIZE = 5 * 1024 * 1024; // 5MB (localStorage 实际限制)
    this.MAX_SMALL_FILE_SIZE = 50 * 1024; // 50KB - 小文件存 localStorage
    this.MAX_LARGE_FILE_SIZE = 50 * 1024 * 1024; // 50MB - 大文件上限
    this.saveDebounceTimer = null;
    this.saveDebounceDelay = 2000; // 2秒防抖
    this.lastSavedUrdfHash = null; // 用于跟踪 URDF 是否变化
    this.indexedDBManager = new IndexedDBManager(); // IndexedDB 管理器
  }

  /**
   * 将 ArrayBuffer 转换为 Base64
   */
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * 将 Base64 转换为 ArrayBuffer
   */
  base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * 检查是否启用了自动保存
   */
  isAutoSaveEnabled() {
    try {
      return localStorage.getItem(this.COOKIE_ENABLED_KEY) === 'true';
    } catch (e) {
      console.warn('无法访问 localStorage:', e);
      return false;
    }
  }

  /**
   * 设置自动保存开关
   */
  async setAutoSaveEnabled(enabled) {
    try {
      if (enabled) {
        localStorage.setItem(this.COOKIE_ENABLED_KEY, 'true');
      } else {
        localStorage.removeItem(this.COOKIE_ENABLED_KEY);
        // 同时清除已保存的状态（包括 IndexedDB）
        await this.clearState();
      }
      return true;
    } catch (e) {
      console.error('无法设置自动保存状态:', e);
      return false;
    }
  }

  /**
   * 保存应用状态（带防抖）
   * @param {Object} editor - 编辑器实例
   * @param {boolean} fullSave - 是否完整保存（包括 URDF）
   */
  saveStateDebounced(editor, fullSave = false) {
    if (!this.isAutoSaveEnabled()) {
      return;
    }

    // 清除之前的定时器
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    // 设置新的定时器
    this.saveDebounceTimer = setTimeout(async () => {
      await this.saveState(editor, fullSave);
    }, this.saveDebounceDelay);
  }

  /**
   * 立即保存应用状态
   * @param {Object} editor - 编辑器实例
   * @param {boolean} fullSave - 是否完整保存（包括 URDF）
   */
  async saveState(editor, fullSave = false) {
    if (!this.isAutoSaveEnabled()) {
      return false;
    }

    try {
      const state = {
        version: '2.1', // 版本号，用于未来的兼容性检查（增加到 2.1 支持增量保存）
        timestamp: Date.now(),
        
        // 轨迹数据
        trajectory: null,
        
        // URDF 文件映射（保存文件名和内容）
        urdfFileMap: null,
        urdfHash: null, // URDF 的哈希值，用于检测变化
        
        // 当前状态
        currentFrame: editor.timelineController ? editor.timelineController.getCurrentFrame() : 0,
        fps: editor.trajectoryManager ? editor.trajectoryManager.fps : 50,
        
        // 关键帧和残差
        keyframes: null,
        
        // 插值模式
        interpolationMode: editor.trajectoryManager ? editor.trajectoryManager.interpolationMode : 'linear',
        
        // 相机状态
        cameraPosition: editor.cameraRight ? {
          x: editor.cameraRight.position.x,
          y: editor.cameraRight.position.y,
          z: editor.cameraRight.position.z
        } : null,
        cameraZoom: editor.cameraRight ? editor.cameraRight.zoom : 1,
        cameraTarget: editor.controls ? {
          x: editor.controls.target.x,
          y: editor.controls.target.y,
          z: editor.controls.target.z
        } : null,
        
        // UI 状态
        cameraMode: editor.cameraMode,
        followRobot: editor.followRobot,
        showCOM: editor.showCOM,
        autoRefreshFootprint: editor.autoRefreshFootprint,
        footprintHeightThresholdCm: editor.footprintHeightThresholdCm,
        
        // 曲线编辑器状态
        curveEditorExpanded: editor.curveEditor ? editor.curveEditor.isExpanded : false,
        visibleCurves: editor.curveEditor ? Array.from(editor.curveEditor.curves.entries())
          .filter(([_, curve]) => curve.visible)
          .map(([key, _]) => key) : [],
        
        // 文件名
        originalFileName: editor.trajectoryManager ? editor.trajectoryManager.originalFileName : null,
      };

      // 保存轨迹数据
      if (editor.trajectoryManager && editor.trajectoryManager.hasTrajectory()) {
        state.trajectory = {
          baseTrajectory: Array.from(editor.trajectoryManager.baseTrajectory),
          fps: editor.trajectoryManager.fps,
          originalFileName: editor.trajectoryManager.originalFileName
        };
        
        // 保存关键帧
        if (editor.trajectoryManager.keyframes.size > 0) {
          state.keyframes = Array.from(editor.trajectoryManager.keyframes.entries()).map(([frame, data]) => {
            return {
              frame,
              residual: Array.from(data.residual || []),
              baseResidual: data.baseResidual ? {
                position: { ...data.baseResidual.position },
                quaternion: { ...data.baseResidual.quaternion }
              } : null
            };
          });
        }
      }

      // 保存 URDF 文件映射（仅在完整保存时）
      if (fullSave && editor.urdfLoader && editor.urdfLoader.fileMap && editor.urdfLoader.fileMap.size > 0) {
        console.log('💾 完整保存：包含 URDF 文件映射...');
        
        // 将 File 对象转换为可序列化的格式
        // 小文件存 localStorage，大文件存 IndexedDB
        const smallFiles = []; // 存到 localStorage
        const largeFilePaths = []; // 存到 IndexedDB 的文件路径列表
        let skippedFiles = [];
        let indexedDBFiles = 0;
        
        for (const [path, file] of editor.urdfLoader.fileMap.entries()) {
          if (typeof file === 'string') {
            // 已经是字符串，检查大小
            if (file.length > this.MAX_LARGE_FILE_SIZE) {
              console.warn(`⚠️ 文件过大，跳过: ${path} (${(file.length / 1024 / 1024).toFixed(2)}MB)`);
              skippedFiles.push(path);
              continue;
            }
            
            if (file.length <= this.MAX_SMALL_FILE_SIZE) {
              // 小文件，存 localStorage
              smallFiles.push([path, file]);
            } else {
              // 大文件，存 IndexedDB
              const blob = new Blob([file], { type: 'text/plain' });
              await this.indexedDBManager.saveFile(path, blob);
              largeFilePaths.push(path);
              indexedDBFiles++;
            }
          } else {
            // 是 File/Blob 对象
            const fileName = path.toLowerCase();
            
            // 检查文件大小
            if (file.size > this.MAX_LARGE_FILE_SIZE) {
              console.warn(`⚠️ 文件过大，跳过: ${path} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
              skippedFiles.push(path);
              continue;
            }
            
            // 文本文件类型（URDF, XML, DAE 等）
            const textExtensions = ['.urdf', '.xml', '.dae', '.obj', '.mtl', '.sdf'];
            const isTextFile = textExtensions.some(ext => fileName.endsWith(ext));
            
            if (file.size <= this.MAX_SMALL_FILE_SIZE) {
              // 小文件，存 localStorage
              if (isTextFile) {
                const text = await file.text();
                smallFiles.push([path, { type: 'text', content: text }]);
              } else {
                const arrayBuffer = await file.arrayBuffer();
                const base64 = this.arrayBufferToBase64(arrayBuffer);
                smallFiles.push([path, { type: 'binary', content: base64, mimeType: file.type || 'application/octet-stream' }]);
              }
            } else {
              // 大文件，存 IndexedDB（直接存 Blob，不转换）
              await this.indexedDBManager.saveFile(path, file, {
                isText: isTextFile
              });
              largeFilePaths.push(path);
              indexedDBFiles++;
            }
          }
        }
        
        if (skippedFiles.length > 0) {
          console.warn(`⚠️ 共跳过 ${skippedFiles.length} 个超大文件`);
        }
        
        if (indexedDBFiles > 0) {
          console.log(`💾 ${indexedDBFiles} 个大文件已存入 IndexedDB`);
        }
        
        state.urdfFileMap = smallFiles;
        state.urdfLargeFiles = largeFilePaths; // 记录存在 IndexedDB 中的文件路径
        
        // 计算 URDF 的简单哈希（用于检测变化）
        const urdfKeys = Array.from(editor.urdfLoader.fileMap.keys()).sort().join('|');
        state.urdfHash = this.simpleHash(urdfKeys);
        this.lastSavedUrdfHash = state.urdfHash;
      } else if (this.lastSavedUrdfHash) {
        // 增量保存：保留之前的 URDF 数据，只更新其他状态
        state.urdfHash = this.lastSavedUrdfHash;
        
        // 从之前保存的状态中读取 URDF 数据
        try {
          const prevStateStr = localStorage.getItem(this.COOKIE_NAME);
          if (prevStateStr) {
            const prevState = JSON.parse(prevStateStr);
            if (prevState.urdfFileMap) {
              state.urdfFileMap = prevState.urdfFileMap;
              console.log(`💾 增量保存：保留 ${prevState.urdfFileMap.length} 个小文件`);
            }
            if (prevState.urdfLargeFiles) {
              state.urdfLargeFiles = prevState.urdfLargeFiles;
              console.log(`💾 增量保存：保留 ${prevState.urdfLargeFiles.length} 个大文件引用`);
            }
          }
        } catch (e) {
          console.warn('⚠️ 无法读取之前的 URDF 数据:', e);
        }
        
        console.log('💾 增量保存：仅更新状态，保留 URDF 数据');
      }

      const stateStr = JSON.stringify(state);
      const sizeMB = (stateStr.length / (1024 * 1024)).toFixed(2);
      const limitMB = (this.MAX_COOKIE_SIZE / (1024 * 1024)).toFixed(0);
      
      // 检查大小
      if (stateStr.length > this.MAX_COOKIE_SIZE) {
        console.error(`❌ 状态数据过大 (${sizeMB}MB)，超过限制 (${limitMB}MB)，无法保存`);
        if (editor.updateStatus) {
          const message = editor.i18n ? 
            editor.i18n.t('autoSaveFailedSize', { size: sizeMB, limit: limitMB }) : 
            `❌ 数据过大 (${sizeMB}MB)，超过 ${limitMB}MB 限制`;
          editor.updateStatus(message, 'error');
        }
        return false;
      }
      
      try {
        localStorage.setItem(this.COOKIE_NAME, stateStr);
      } catch (quotaError) {
        console.error(`❌ 存储配额超出 (数据: ${sizeMB}MB):`, quotaError);
        if (editor.updateStatus) {
          const message = editor.i18n ? 
            editor.i18n.t('autoSaveFailedQuota', { size: sizeMB }) : 
            `❌ 存储空间不足，无法保存 ${sizeMB}MB 数据`;
          editor.updateStatus(message, 'error');
        }
        throw quotaError;
      }
      
      // 获取当前时间
      const now = new Date();
      const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      if (fullSave) {
        console.log(`💾 状态已完整保存 (${sizeMB}MB，包含 URDF)`);
        // 显示到顶部状态栏
        if (editor.updateStatus) {
          const message = editor.i18n ? editor.i18n.t('autoSavedFull', { time: timeStr }) : `✅ 已自动保存！(${timeStr})`;
          editor.updateStatus(message, 'success');
        }
      } else {
        console.log(`💾 状态已增量保存 (${sizeMB}MB)`);
        // 显示到顶部状态栏
        if (editor.updateStatus) {
          const message = editor.i18n ? editor.i18n.t('autoSavedIncremental', { time: timeStr }) : `✅ 已自动保存（增量）！(${timeStr})`;
          editor.updateStatus(message, 'success');
        }
      }
      
      return true;
    } catch (e) {
      console.error('❌ 保存状态失败:', e);
      // 如果是配额错误，尝试清除旧数据
      if (e.name === 'QuotaExceededError') {
        console.warn('⚠️ 存储配额超出，尝试清除旧数据...');
        this.clearState();
      }
      return false;
    }
  }

  /**
   * 计算简单哈希值
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
  }

  /**
   * 恢复应用状态
   */
  async restoreState(editor) {
    console.log('🔄 restoreState: 开始执行...');
    
    if (!this.isAutoSaveEnabled()) {
      console.log('🔄 restoreState: 自动保存未启用');
      return false;
    }

    try {
      const stateStr = localStorage.getItem(this.COOKIE_NAME);
      if (!stateStr) {
        console.log('💭 没有找到已保存的状态');
        return false;
      }
      
      console.log('💭 找到保存的状态，大小:', (stateStr.length / 1024).toFixed(2), 'KB');

      const state = JSON.parse(stateStr);
      
      // 检查版本兼容性
      if (!state.version || parseFloat(state.version) < 2.0) {
        console.warn('⚠️ 旧版本的状态数据，跳过恢复');
        return false;
      }
      
      // 保存 URDF 哈希值
      if (state.urdfHash) {
        this.lastSavedUrdfHash = state.urdfHash;
      }

      console.log('🔄 开始恢复状态...');
      console.log('  保存时间:', new Date(state.timestamp).toLocaleString());
      console.log('  state.urdfFileMap 长度:', state.urdfFileMap ? state.urdfFileMap.length : 0);
      console.log('  state.urdfLargeFiles 长度:', state.urdfLargeFiles ? state.urdfLargeFiles.length : 0);
      console.log('  state.urdfHash:', state.urdfHash);

      // 恢复 URDF（如果有保存）
      if ((state.urdfFileMap && state.urdfFileMap.length > 0) || (state.urdfLargeFiles && state.urdfLargeFiles.length > 0)) {
        console.log('  🤖 开始恢复 URDF 文件映射...');
        
        // 转换保存的文件数据回 Map 格式
        const fileMap = new Map();
        
        // 恢复小文件（从 localStorage）
        if (state.urdfFileMap && state.urdfFileMap.length > 0) {
          console.log(`  📦 从 localStorage 恢复 ${state.urdfFileMap.length} 个小文件...`);
          for (const [path, fileData] of state.urdfFileMap) {
            if (typeof fileData === 'string') {
              // 旧格式：直接是字符串
              fileMap.set(path, fileData);
              console.log(`    - ${path} (字符串)`);
            } else if (fileData && fileData.type) {
              // 新格式：对象 { type, content, mimeType }
              if (fileData.type === 'text') {
                fileMap.set(path, fileData.content);
                console.log(`    - ${path} (文本)`);
              } else if (fileData.type === 'binary') {
                // 从 base64 恢复为 Blob
                const arrayBuffer = this.base64ToArrayBuffer(fileData.content);
                const blob = new Blob([arrayBuffer], { type: fileData.mimeType });
                fileMap.set(path, blob);
                console.log(`    - ${path} (二进制)`);
              }
            }
          }
        }
        
        // 恢复大文件（从 IndexedDB）
        if (state.urdfLargeFiles && state.urdfLargeFiles.length > 0) {
          console.log(`  💾 从 IndexedDB 恢复 ${state.urdfLargeFiles.length} 个大文件...`);
          for (const path of state.urdfLargeFiles) {
            const file = await this.indexedDBManager.getFile(path);
            if (file) {
              fileMap.set(path, file);
              console.log(`    - ${path} (${(file.size / 1024).toFixed(2)}KB)`);
            } else {
              console.warn(`⚠️ IndexedDB 中未找到文件: ${path}`);
            }
          }
        }
        
        console.log(`  📂 共准备恢复 ${fileMap.size} 个文件`);
        
        if (fileMap.size === 0) {
          console.warn('⚠️ 没有文件需要恢复，跳过 URDF 加载');
        } else {
          // 异步加载 URDF
          await new Promise((resolve, reject) => {
            console.log('  🔧 开始加载 URDF...');
console.log('  🔧 开始加载 URDF...');
            editor.urdfLoader.loadFromMap(fileMap, (robot) => {
              console.log('  🤖 右侧机器人已创建');
              editor.robotRight = robot;
              editor.robot = robot;
              editor.viewportManager?.applyEditedRenderOrder(editor.robotRight);
              
              // 创建左侧机器人副本
              editor.urdfLoader.loadFromMap(new Map(fileMap), async (leftRobot) => {
                console.log('  🤖 左侧机器人已创建');
                editor.robotLeft = leftRobot;
                editor.viewportManager?.applyGhostMaterialWhenReady(editor.robotLeft);
                editor.viewportManager?.attachRobots();
                
                // 初始化控制器
                const joints = editor.urdfLoader.getJoints();
                console.log('  🎮 初始化控制器，关节数:', joints.length);
                const { JointController } = await import('./jointController.js');
                const { BaseController } = await import('./baseController.js');
                editor.jointController = new JointController(joints, editor);
                editor.baseController = new BaseController(editor);
                editor.notifyUrdfReady?.();
                
                resolve();
              });
            });
          });
          
          console.log('  ✅ URDF 已恢复');
        }
      } else {
        console.log('  ⏭️ 没有 URDF 数据，跳过恢复');
      }

      // 恢复轨迹数据
      if (state.trajectory) {
        console.log('  恢复轨迹数据...');
        editor.trajectoryManager.baseTrajectory = state.trajectory.baseTrajectory;
        editor.trajectoryManager.fps = state.trajectory.fps || 50;
        editor.trajectoryManager.originalFileName = state.trajectory.originalFileName;
        
        // 恢复关键帧
        if (state.keyframes) {
          editor.trajectoryManager.keyframes.clear();
          state.keyframes.forEach(kf => {
            editor.trajectoryManager.keyframes.set(kf.frame, {
              residual: kf.residual,
              baseResidual: kf.baseResidual
            });
          });
          
          // 更新时间轴标记
          const keyframeList = Array.from(editor.trajectoryManager.keyframes.keys());
          editor.timelineController.updateKeyframeMarkers(keyframeList);
        }
        
        // 更新时间轴
        const frameCount = editor.trajectoryManager.getFrameCount();
        const duration = editor.trajectoryManager.getDuration();
        editor.timelineController.updateTimeline(frameCount, duration);
        editor.timelineController.setFPS(state.fps || 50);
        
        // 恢复插值模式
        if (state.interpolationMode) {
          editor.trajectoryManager.interpolationMode = state.interpolationMode;
          if (editor.curveEditor) {
            editor.curveEditor.updateInterpolationButton();
          }
        }
        
        console.log('  ✅ 轨迹已恢复');
      }

      // 恢复当前帧
      if (typeof state.currentFrame === 'number' && editor.timelineController) {
        editor.timelineController.setCurrentFrame(state.currentFrame);
        // 只有当机器人和轨迹都存在时才更新状态
        if ((editor.robotLeft || editor.robotRight) && editor.trajectoryManager && editor.trajectoryManager.hasTrajectory()) {
          editor.updateRobotState(state.currentFrame);
        }
      }

      // 恢复相机状态
      if (state.cameraPosition && editor.cameraRight) {
        editor.cameraRight.position.set(
          state.cameraPosition.x,
          state.cameraPosition.y,
          state.cameraPosition.z
        );
        editor.cameraLeft.position.copy(editor.cameraRight.position);
      }
      
      if (typeof state.cameraZoom === 'number' && editor.cameraRight) {
        editor.cameraRight.zoom = state.cameraZoom;
        editor.cameraLeft.zoom = state.cameraZoom;
        editor.cameraRight.updateProjectionMatrix();
        editor.cameraLeft.updateProjectionMatrix();
      }
      
      if (state.cameraTarget && editor.controls) {
        editor.controls.target.set(
          state.cameraTarget.x,
          state.cameraTarget.y,
          state.cameraTarget.z
        );
        editor.controls.update();
      }

      // 恢复 UI 状态
      if (typeof state.cameraMode === 'string' && state.cameraMode !== editor.cameraMode) {
        editor.toggleCameraMode();
      }
      
      if (typeof state.followRobot === 'boolean' && state.followRobot !== editor.followRobot) {
        editor.toggleFollowRobot();
      }
      
      if (typeof state.showCOM === 'boolean' && state.showCOM !== editor.showCOM) {
        editor.toggleCOM();
      }
      
      if (typeof state.autoRefreshFootprint === 'boolean' && state.autoRefreshFootprint !== editor.autoRefreshFootprint) {
        editor.toggleAutoRefreshFootprint();
      }
      
      if (typeof state.footprintHeightThresholdCm === 'number') {
        editor.footprintHeightThresholdCm = state.footprintHeightThresholdCm;
        const input = document.getElementById('footprint-height-threshold');
        if (input) {
          input.value = state.footprintHeightThresholdCm;
        }
      }

      // 恢复曲线编辑器状态
      if (editor.curveEditor) {
        if (typeof state.curveEditorExpanded === 'boolean' && state.curveEditorExpanded !== editor.curveEditor.isExpanded) {
          editor.curveEditor.toggleExpand();
        }
        
        if (state.visibleCurves && Array.isArray(state.visibleCurves)) {
          // 先隐藏所有曲线
          editor.curveEditor.curves.forEach((curve) => {
            curve.visible = false;
          });
          
          // 显示保存的可见曲线
          state.visibleCurves.forEach(key => {
            const curve = editor.curveEditor.curves.get(key);
            if (curve) {
              curve.visible = true;
            }
          });
          
          // 更新控制器中的曲线背景
          if (editor.jointController && editor.jointController.updateCurveBackgrounds) {
            editor.jointController.updateCurveBackgrounds();
          }
          if (editor.baseController && editor.baseController.updateCurveBackgrounds) {
            editor.baseController.updateCurveBackgrounds();
          }
          
          editor.curveEditor.draw();
        }
      }

      // 恢复文件名显示
      if (state.originalFileName) {
        editor.updateCurrentFileName(state.originalFileName, 'csv');
      }

      console.log('✅ 状态恢复完成');
      return true;
    } catch (e) {
      console.error('❌ 恢复状态失败:', e);
      return false;
    }
  }

  /**
   * 清除保存的状态
   */
  async clearState() {
    try {
      localStorage.removeItem(this.COOKIE_NAME);
      this.lastSavedUrdfHash = null;
      
      // 同时清除 IndexedDB
      await this.indexedDBManager.clearAll();
      
      console.log('🗑️ 已清除保存的状态（包括 IndexedDB）');
      return true;
    } catch (e) {
      console.error('清除状态失败:', e);
      return false;
    }
  }

  /**
   * 获取保存的状态信息（不恢复）
   */
  async getStateInfo() {
    try {
      const stateStr = localStorage.getItem(this.COOKIE_NAME);
      if (!stateStr) {
        return null;
      }

      const state = JSON.parse(stateStr);
      const indexedDBInfo = await this.indexedDBManager.getStorageInfo();
      
      return {
        version: state.version,
        timestamp: state.timestamp,
        hasTrajectory: !!state.trajectory,
        hasURDF: !!state.urdfFileMap || !!(state.urdfLargeFiles && state.urdfLargeFiles.length > 0),
        hasKeyframes: !!(state.keyframes && state.keyframes.length > 0),
        localStorageSize: stateStr.length,
        localStorageSizeMB: (stateStr.length / (1024 * 1024)).toFixed(2),
        indexedDBFileCount: indexedDBInfo.fileCount,
        indexedDBSize: indexedDBInfo.totalSize,
        indexedDBSizeMB: indexedDBInfo.totalSizeMB
      };
    } catch (e) {
      console.error('获取状态信息失败:', e);
      return null;
    }
  }
}
