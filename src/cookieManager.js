/**
 * Cookie 管理器 - 处理应用状态的自动保存和恢复
 */
import { IndexedDBManager } from './indexedDBManager.js';
import { JointController } from './jointController.js';
import { BaseController } from './baseController.js';
import { TrajectoryManager, assertSharedTimelineInvariant } from './trajectoryManager.js';

export class CookieManager {
  constructor() {
    this.COOKIE_NAME = 'robot_editor_state';
    this.COOKIE_ENABLED_KEY = 'robot_editor_autosave';
    this.MAX_COOKIE_SIZE = 5 * 1024 * 1024; // 5MB (localStorage 实际限制)
    this.MAX_SMALL_FILE_SIZE = 50 * 1024; // 50KB - 小文件存 localStorage
    this.MAX_LARGE_FILE_SIZE = 50 * 1024 * 1024; // 50MB - 大文件上限
    this.saveDebounceTimer = null;
    this.saveDebounceDelay = 2000; // 2秒防抖
    // 防抖窗口内只要出现过一次完整保存请求，最终执行就必须保持完整保存。
    this.pendingFullSave = false;
    // 清除状态时递增；异步保存只有 generation 未变化才允许最终提交。
    this.saveGeneration = 0;
    this.lastSavedUrdfHash = null; // 用于跟踪 URDF 是否变化
    this.lastSavedSceneUrdfHash = null;
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

  async serializeFileMap(fileMap, storagePrefix = '') {
    const smallFiles = [];
    const largeFiles = [];

    for (const [path, file] of fileMap.entries()) {
      const storagePath = `${storagePrefix}${path}`;
      if (typeof file === 'string') {
        if (file.length > this.MAX_LARGE_FILE_SIZE) continue;
        if (file.length <= this.MAX_SMALL_FILE_SIZE) {
          smallFiles.push([path, file]);
        } else {
          await this.indexedDBManager.saveFile(
            storagePath,
            new Blob([file], { type: 'text/plain' }),
            { isText: true }
          );
          largeFiles.push([path, storagePath]);
        }
        continue;
      }

      if (!file || file.size > this.MAX_LARGE_FILE_SIZE) continue;
      const lowerPath = path.toLowerCase();
      const textExtensions = ['.urdf', '.xml', '.dae', '.obj', '.mtl', '.sdf'];
      const isTextFile = textExtensions.some(extension => lowerPath.endsWith(extension));

      if (file.size <= this.MAX_SMALL_FILE_SIZE) {
        if (isTextFile) {
          smallFiles.push([path, { type: 'text', content: await file.text() }]);
        } else {
          smallFiles.push([path, {
            type: 'binary',
            content: this.arrayBufferToBase64(await file.arrayBuffer()),
            mimeType: file.type || 'application/octet-stream'
          }]);
        }
      } else {
        await this.indexedDBManager.saveFile(storagePath, file, { isText: isTextFile });
        largeFiles.push([path, storagePath]);
      }
    }

    return { smallFiles, largeFiles };
  }

  async deserializeFileMap(smallFiles = [], largeFiles = [], storagePrefix = '') {
    const fileMap = new Map();

    for (const [path, fileData] of smallFiles || []) {
      if (typeof fileData === 'string') {
        fileMap.set(path, fileData);
      } else if (fileData?.type === 'text') {
        fileMap.set(path, fileData.content);
      } else if (fileData?.type === 'binary') {
        fileMap.set(path, new Blob(
          [this.base64ToArrayBuffer(fileData.content)],
          { type: fileData.mimeType || 'application/octet-stream' }
        ));
      }
    }

    for (const entry of largeFiles || []) {
      const path = Array.isArray(entry) ? entry[0] : entry;
      const storagePath = Array.isArray(entry) ? entry[1] : `${storagePrefix}${path}`;
      const file = await this.indexedDBManager.getFile(storagePath);
      if (file) fileMap.set(path, file);
    }

    return fileMap;
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

    this.pendingFullSave = this.pendingFullSave || Boolean(fullSave);

    // 清除之前的定时器
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    // 设置新的定时器
    this.saveDebounceTimer = setTimeout(async () => {
      const shouldPerformFullSave = this.pendingFullSave;
      this.pendingFullSave = false;
      this.saveDebounceTimer = null;
      await this.saveState(editor, shouldPerformFullSave);
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

    const saveGeneration = this.saveGeneration;

    try {
      const timeline = editor.getSharedTimelineSpec
        ? editor.getSharedTimelineSpec()
        : assertSharedTimelineInvariant([
          editor.robotTrajectoryManager,
          editor.sceneTrajectoryManager
        ]);
      const state = {
        version: '3.1',
        timestamp: Date.now(),
        timeline,

        robotProjectData: editor.robotTrajectoryManager?.hasTrajectory()
          ? editor.robotTrajectoryManager.getProjectData()
          : null,
        sceneProjectData: editor.sceneTrajectoryManager?.hasTrajectory()
          ? editor.sceneTrajectoryManager.getProjectData()
          : null,
        activeTrack: editor.activeTrack || 'robot',
        workspaceMode: editor.workspaceMode || 'compare',
        optimizeMeshesOnLoad: editor.shouldOptimizeUploadedMeshes
          ? editor.shouldOptimizeUploadedMeshes()
          : true,
        
        // URDF 文件映射（保存文件名和内容）
        urdfFileMap: null,
        urdfHash: null, // URDF 的哈希值，用于检测变化
        sceneUrdfFileMap: null,
        sceneUrdfLargeFiles: null,
        sceneUrdfHash: null,
        
        // 当前状态
        currentFrame: editor.timelineController ? editor.timelineController.getCurrentFrame() : 0,
        
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
          .map(([key, _]) => key) : []
      };

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

      if (fullSave && editor.sceneURDFLoader?.fileMap?.size > 0) {
        const serializedScene = await this.serializeFileMap(
          editor.sceneURDFLoader.fileMap,
          'scene:'
        );
        state.sceneUrdfFileMap = serializedScene.smallFiles;
        state.sceneUrdfLargeFiles = serializedScene.largeFiles;
        const sceneKeys = Array.from(editor.sceneURDFLoader.fileMap.keys()).sort().join('|');
        state.sceneUrdfHash = this.simpleHash(sceneKeys);
      } else {
        try {
          const previousState = JSON.parse(localStorage.getItem(this.COOKIE_NAME) || 'null');
          if (previousState) {
            state.sceneUrdfFileMap = previousState.sceneUrdfFileMap || null;
            state.sceneUrdfLargeFiles = previousState.sceneUrdfLargeFiles || null;
            state.sceneUrdfHash = previousState.sceneUrdfHash || this.lastSavedSceneUrdfHash;
          }
        } catch (error) {
          console.warn('⚠️ 无法保留场景 URDF 自动保存数据:', error);
        }
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

      // reset/clearState 可能在 File/IndexedDB await 期间发生；旧快照必须放弃。
      if (saveGeneration !== this.saveGeneration) {
        console.log('⏭️ 自动保存已因状态清除而取消');
        return false;
      }
      
      try {
        localStorage.setItem(this.COOKIE_NAME, stateStr);
        if (state.urdfHash) this.lastSavedUrdfHash = state.urdfHash;
        if (state.sceneUrdfHash) this.lastSavedSceneUrdfHash = state.sceneUrdfHash;
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
      if (state.sceneUrdfHash) {
        this.lastSavedSceneUrdfHash = state.sceneUrdfHash;
      }

      console.log('🔄 开始恢复状态...');
      console.log('  保存时间:', new Date(state.timestamp).toLocaleString());
      console.log('  state.urdfFileMap 长度:', state.urdfFileMap ? state.urdfFileMap.length : 0);
      console.log('  state.urdfLargeFiles 长度:', state.urdfLargeFiles ? state.urdfLargeFiles.length : 0);
      console.log('  state.urdfHash:', state.urdfHash);

      // 上传优化修改的是内存中的 BufferGeometry，自动保存仍保留原始
      // URDF 文件。恢复时重用同一偏好，避免刷新后又回到高面数模型。
      const optimizeMeshesOnLoad = state.optimizeMeshesOnLoad !== false;
      editor.setMeshOptimizationPreference?.(optimizeMeshesOnLoad);

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
          editor.urdfLoader.fileMap = new Map(fileMap);
          console.log('  🔧 开始加载 URDF...');
          editor.robotRight = await editor.urdfLoader.loadFromMap(fileMap);
          if (optimizeMeshesOnLoad && editor.optimizeLoadedModelMeshes) {
            await editor.optimizeLoadedModelMeshes(
              editor.robotRight,
              editor.i18n?.t?.('robot') || 'Robot'
            );
          }
          editor.sceneRight.add(editor.robotRight);
          editor.robot = editor.robotRight;

          editor.robotLeft = await editor.urdfLoader.loadFromMap(new Map(fileMap));
          if (optimizeMeshesOnLoad && editor.optimizeLoadedModelMeshes) {
            await editor.optimizeLoadedModelMeshes(
              editor.robotLeft,
              editor.i18n?.t?.('robot') || 'Robot'
            );
          }
          editor.sceneLeft.add(editor.robotLeft);

          const joints = editor.urdfLoader.getJoints();
          console.log('  🎮 初始化控制器，关节数:', joints.length);
          editor.jointController = new JointController(joints, editor, {
            track: 'robot',
            containerId: 'joint-controls',
            idPrefix: 'robot'
          });
          editor.baseController = new BaseController(editor);
          
          console.log('  ✅ URDF 已恢复');
        }
      } else {
        console.log('  ⏭️ 没有 URDF 数据，跳过恢复');
      }

      if ((state.sceneUrdfFileMap && state.sceneUrdfFileMap.length > 0) ||
          (state.sceneUrdfLargeFiles && state.sceneUrdfLargeFiles.length > 0)) {
        const sceneFileMap = await this.deserializeFileMap(
          state.sceneUrdfFileMap,
          state.sceneUrdfLargeFiles,
          'scene:'
        );
        if (sceneFileMap.size > 0) {
          editor.sceneURDFLoader.fileMap = new Map(sceneFileMap);
          editor.sceneModelRight = await editor.sceneURDFLoader.loadFromMap(sceneFileMap);
          if (optimizeMeshesOnLoad && editor.optimizeLoadedModelMeshes) {
            await editor.optimizeLoadedModelMeshes(
              editor.sceneModelRight,
              editor.i18n?.t?.('scene') || 'Scene'
            );
          }
          editor.sceneRight.add(editor.sceneModelRight);
          editor.sceneModelLeft = await editor.sceneURDFLoader.loadFromMap(new Map(sceneFileMap));
          if (optimizeMeshesOnLoad && editor.optimizeLoadedModelMeshes) {
            await editor.optimizeLoadedModelMeshes(
              editor.sceneModelLeft,
              editor.i18n?.t?.('scene') || 'Scene'
            );
          }
          editor.sceneLeft.add(editor.sceneModelLeft);

          editor.sceneJointController = new JointController(
            editor.sceneURDFLoader.getJoints(),
            editor,
            {
              track: 'scene',
              containerId: 'scene-joint-controls',
              idPrefix: 'scene',
              allowFix: true
            }
          );
        }
      }

      // 恢复轨迹数据。现代编辑器先在临时 manager 中完整校验共享
      // 时间轴，避免坏的自动保存状态只覆盖其中一条轨迹。
      if (editor.robotTrajectoryManager && editor.sceneTrajectoryManager) {
        const nextRobotManager = new TrajectoryManager();
        const nextSceneManager = new TrajectoryManager();

        if (state.robotProjectData) {
          nextRobotManager.loadProjectData(state.robotProjectData);
        } else if (state.trajectory) {
          const legacyBaseTrajectory = state.trajectory.baseTrajectory || [];
          nextRobotManager.loadProjectData({
            version: '2.3',
            baseTrajectory: legacyBaseTrajectory,
            keyframes: (state.keyframes || []).map(keyframe => ({
              frameIndex: keyframe.frameIndex ?? keyframe.frame,
              residual: keyframe.residual,
              baseResidual: keyframe.baseResidual ?? null
            })),
            fixedJointValues: {},
            jointCount: legacyBaseTrajectory[0]?.joints?.length || 0,
            originalFileName: state.trajectory.originalFileName || '',
            fps: state.trajectory.fps || state.fps || 50,
            interpolationMode: state.interpolationMode || 'linear',
            sourceFormat: state.trajectory.sourceFormat
          });
        }
        if (state.sceneProjectData) {
          nextSceneManager.loadProjectData(state.sceneProjectData);
        }

        if (String(state.version) === '3.1' &&
            (nextRobotManager.hasTrajectory() || nextSceneManager.hasTrajectory()) &&
            (!Object.prototype.hasOwnProperty.call(state, 'timeline') ||
             state.timeline === null)) {
          throw new Error('v3.1 自动保存状态缺少共享时间轴');
        }

        let timeline = assertSharedTimelineInvariant(
          [nextRobotManager, nextSceneManager],
          state.timeline ?? null
        );

        if (nextRobotManager.hasTrajectory() && editor.jointController &&
            nextRobotManager.jointCount !== editor.jointController.joints.length) {
          throw new Error('自动保存中的机器人轨迹与机器人模型关节数不一致');
        }
        if (nextSceneManager.hasTrajectory() && editor.sceneJointController &&
            nextSceneManager.jointCount !== editor.sceneJointController.joints.length) {
          throw new Error('自动保存中的场景轨迹与场景模型关节数不一致');
        }

        if (timeline && !nextRobotManager.hasTrajectory() && editor.jointController) {
          nextRobotManager.createZeroTrajectory(
            timeline.frameCount,
            editor.jointController.joints.length,
            timeline.fps,
            'robot_zero.csv'
          );
        }
        if (timeline && !nextSceneManager.hasTrajectory() && editor.sceneJointController) {
          nextSceneManager.createZeroTrajectory(
            timeline.frameCount,
            editor.sceneJointController.joints.length,
            timeline.fps,
            'scene_zero.csv'
          );
        }
        timeline = assertSharedTimelineInvariant(
          [nextRobotManager, nextSceneManager],
          timeline
        );

        editor.robotTrajectoryManager = nextRobotManager;
        editor.sceneTrajectoryManager = nextSceneManager;
        editor.trajectoryManager = editor.robotTrajectoryManager;
        if (timeline) console.log('  ✅ 共享轨迹时间轴已恢复');
      } else if (state.trajectory) {
        // Minimal compatibility path for legacy integrations that expose only
        // the historical trajectoryManager alias.
        editor.trajectoryManager.baseTrajectory = state.trajectory.baseTrajectory;
        editor.trajectoryManager.jointCount = state.trajectory.baseTrajectory?.[0]?.joints?.length || 0;
        editor.trajectoryManager.fps = state.trajectory.fps || 50;
        editor.trajectoryManager.originalFileName = state.trajectory.originalFileName;
        editor.trajectoryManager.keyframes.clear();
        (state.keyframes || []).forEach(keyframe => {
          editor.trajectoryManager.keyframes.set(keyframe.frame, {
            residual: keyframe.residual,
            baseResidual: keyframe.baseResidual
          });
        });
        editor.trajectoryManager.interpolationMode = state.interpolationMode || 'linear';
        editor.timelineController.updateKeyframeMarkers(
          Array.from(editor.trajectoryManager.keyframes.keys())
        );
        const legacyFPS = state.timeline?.fps || editor.trajectoryManager.fps;
        editor.timelineController.setFPS(legacyFPS);
        editor.timelineController.updateTimeline(
          editor.trajectoryManager.getFrameCount(),
          editor.trajectoryManager.getFrameCount() / legacyFPS
        );
      }

      if (editor.setWorkspaceMode) {
        editor.setWorkspaceMode(state.workspaceMode === 'create' ? 'create' : 'compare');
      }
      if (editor.setActiveTrack) {
        const requestedTrack = state.activeTrack === 'scene' ? 'scene' : 'robot';
        const fallbackTrack = requestedTrack === 'scene' ? 'robot' : 'scene';
        const requestedHasTrajectory = editor.getTrajectoryManager?.(requestedTrack)?.hasTrajectory();
        const fallbackHasTrajectory = editor.getTrajectoryManager?.(fallbackTrack)?.hasTrajectory();
        const restoredTrack = requestedHasTrajectory
          ? requestedTrack
          : (fallbackHasTrajectory ? fallbackTrack : requestedTrack);
        editor.setActiveTrack(restoredTrack, { resetTimeline: false });
        editor.refreshTimelineForActiveTrack?.(state.currentFrame || 0);
      }

      // 恢复当前帧
      if (typeof state.currentFrame === 'number' && editor.timelineController) {
        editor.timelineController.setCurrentFrame(state.currentFrame);
        // 只有当机器人和轨迹都存在时才更新状态
        if (editor.getActiveTrajectoryManager?.()?.hasTrajectory()) {
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
      this.saveGeneration += 1;
      if (this.saveDebounceTimer) {
        clearTimeout(this.saveDebounceTimer);
        this.saveDebounceTimer = null;
      }
      this.pendingFullSave = false;
      localStorage.removeItem(this.COOKIE_NAME);
      this.lastSavedUrdfHash = null;
      this.lastSavedSceneUrdfHash = null;
      
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
        hasTrajectory: !!state.trajectory || !!state.robotProjectData || !!state.sceneProjectData,
        hasURDF: !!state.urdfFileMap || !!(state.urdfLargeFiles && state.urdfLargeFiles.length > 0),
        hasSceneURDF: !!state.sceneUrdfFileMap ||
          !!(state.sceneUrdfLargeFiles && state.sceneUrdfLargeFiles.length > 0),
        hasKeyframes: !!(state.keyframes && state.keyframes.length > 0) ||
          !!state.robotProjectData?.keyframes?.length ||
          !!state.sceneProjectData?.keyframes?.length,
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
