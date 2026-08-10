import * as THREE from 'three';
import URDFLoaderLib from 'urdf-loader';

export function normalizeAssetPath(value) {
  let path = String(value || '').replaceAll('\\', '/').split(/[?#]/, 1)[0];
  path = path.replace(/^file:\/\//i, '').replace(/^\/+/, '');
  const segments = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) throw new Error(`资源路径越界: ${value}`);
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join('/');
}

export function resolveMappedAsset(fileMap, requestUrl, basePath) {
  if (requestUrl.startsWith('blob:') || requestUrl.startsWith('data:')) {
    return { passthrough: requestUrl };
  }
  if (/^https?:\/\//i.test(requestUrl)) {
    throw new Error(`上传 URDF 不允许请求远程资源: ${requestUrl}`);
  }

  const requestedPath = normalizeAssetPath(
    requestUrl.replace(/^package:\/\//i, '')
  );
  const normalizedBase = normalizeAssetPath(basePath);
  const entries = Array.from(fileMap.entries()).map(([path, file]) => ({
    path,
    normalizedPath: normalizeAssetPath(path),
    file
  }));
  const normalizedPathOwners = new Map();
  entries.forEach(entry => {
    const owners = normalizedPathOwners.get(entry.normalizedPath) || [];
    owners.push(entry.path);
    normalizedPathOwners.set(entry.normalizedPath, owners);
  });
  const pathCollision = Array.from(normalizedPathOwners.entries())
    .find(([, owners]) => owners.length > 1);
  if (pathCollision) {
    throw new Error(
      `URDF 文件映射路径不唯一: ${pathCollision[0]} -> ${pathCollision[1].join(', ')}`
    );
  }
  const exactPaths = new Set([requestedPath]);
  if (normalizedBase && !requestedPath.startsWith(`${normalizedBase}/`)) {
    exactPaths.add(normalizeAssetPath(`${normalizedBase}/${requestedPath}`));
  }

  let matches = entries.filter(entry => exactPaths.has(entry.normalizedPath));
  if (matches.length === 0) {
    const segments = requestedPath.split('/');
    const suffixes = [];
    for (let index = 0; index < segments.length; index += 1) {
      suffixes.push(segments.slice(index).join('/'));
    }
    matches = entries.filter(entry => suffixes.some(suffix =>
      entry.normalizedPath === suffix || entry.normalizedPath.endsWith(`/${suffix}`)
    ));
  }

  const uniqueMatches = Array.from(
    new Map(matches.map(entry => [entry.normalizedPath, entry])).values()
  );
  if (uniqueMatches.length === 0) {
    throw new Error(`URDF 资源缺失: ${requestUrl}`);
  }
  if (uniqueMatches.length > 1) {
    throw new Error(
      `URDF 资源路径不唯一: ${requestUrl} -> ` +
      uniqueMatches.map(entry => entry.path).join(', ')
    );
  }
  return uniqueMatches[0];
}

export class URDFLoader {
  constructor({ loaderFactory } = {}) {
    this.loaderFactory = loaderFactory || (manager => new URDFLoaderLib(manager));
    this.loader = this.createLoader();

    this.robot = null;
    this.joints = [];
    this.fileMap = new Map();
  }

  createLoader(manager = undefined) {
    const loader = this.loaderFactory(manager);
    if (!loader || typeof loader !== 'object') {
      throw new TypeError('URDF loader factory 必须返回 loader 对象');
    }
    loader.parseCollision = false;
    loader.parseVisual = true;
    if (Object.prototype.hasOwnProperty.call(loader, 'parseInertial')) {
      loader.parseInertial = true;
    }
    return loader;
  }

  collectJoints(robot) {
    const joints = [];
    const traverse = object => {
      if (object.isURDFJoint && object.jointType !== 'fixed') {
        joints.push({
          name: object.name,
          joint: object,
          limits: {
            lower: object.limit?.lower || -Math.PI,
            upper: object.limit?.upper || Math.PI
          }
        });
      }
      for (const child of object.children) traverse(child);
    };
    traverse(robot);
    return joints;
  }

  async loadFromFolder(files) {
    const inputFiles = Array.from(files || []);
    console.log(`📂 开始加载文件夹，共 ${inputFiles.length} 个文件`);

    // 新上传必须先在独立 candidate 中完整加载。失败时保留当前已提交的
    // robot / joints / fileMap，避免自动保存把旧模型和新文件夹拼在一起。
    const candidateFileMap = new Map();
    console.log('🗂️ 构建文件映射...');
    for (const file of inputFiles) {
      const path = file.webkitRelativePath || file.name;
      if (candidateFileMap.has(path)) {
        throw new Error(`URDF 文件路径重复: ${path}`);
      }
      candidateFileMap.set(path, file);
      console.log(`  - ${path}`);
    }
    console.log(`✅ 文件映射构建完成，共 ${candidateFileMap.size} 个文件`);

    // 一个目录只允许一个入口 URDF，避免文件顺序决定加载结果。
    console.log('🔍 查找 URDF 文件...');
    const urdfFiles = inputFiles.filter(file => file.name.toLowerCase().endsWith('.urdf'));
    if (urdfFiles.length === 0) {
      const fileList = inputFiles.map(file => file.name).join(', ');
      console.error('❌ 文件列表:', fileList);
      throw new Error('未找到 URDF 文件（.urdf）');
    }
    if (urdfFiles.length > 1) {
      throw new Error(`目录中存在多个 URDF 文件: ${urdfFiles.map(file => file.name).join(', ')}`);
    }
    const urdfFile = urdfFiles[0];

    console.log(`✅ 找到 URDF 文件: ${urdfFile.name}`);
    
    // 读取 URDF 内容
    console.log('📝 读取 URDF 文件内容...');
    const urdfText = await urdfFile.text();
    console.log(`✅ URDF 文件内容读取完成，大小: ${urdfText.length} 字符`);
    const urdfPath = urdfFile.webkitRelativePath || urdfFile.name;
    const basePath = urdfPath.substring(0, urdfPath.lastIndexOf('/') + 1);
    console.log(`📍 基础路径: ${basePath}`);

    // 设置自定义加载管理器
    console.log('⚙️ 配置加载管理器...');
    const manager = new THREE.LoadingManager();
    const candidateLoader = this.createLoader(manager);
    const mappedObjectUrls = new Set();
    const createMappedObjectUrl = file => {
      const objectUrl = URL.createObjectURL(file);
      mappedObjectUrls.add(objectUrl);
      return objectUrl;
    };
    const releaseMappedObjectUrls = () => {
      mappedObjectUrls.forEach(objectUrl => URL.revokeObjectURL(objectUrl));
      mappedObjectUrls.clear();
    };
    
    // 添加加载管理器事件
    let loadComplete = false;
    let resolveResourcesReady;
    const resourceErrors = [];
    const resourcesReady = new Promise(resolve => {
      resolveResourcesReady = resolve;
    });
    manager.onStart = (url, loaded, total) => {
      console.log(`🚀 开始加载: ${url}`);
    };
    
    manager.onLoad = () => {
      console.log('✅ LoadingManager: 所有资源加载完成');
      loadComplete = true;
      resolveResourcesReady();
      console.log('⏳ 等待 urdf-loader 触发回调...');
    };
    
    manager.onProgress = (url, loaded, total) => {
      console.log(`📦 加载进度: ${url} (${loaded}/${total})`);
    };
    
    manager.onError = (url) => {
      resourceErrors.push(url);
      console.error(`❌ 加载失败: ${url}`);
    };
    
    manager.setURLModifier((url) => {
      console.log(`🔗 请求加载 URL: ${url}`);
      const resolved = resolveMappedAsset(candidateFileMap, url, basePath);
      if (resolved.passthrough) return resolved.passthrough;
      console.log(`  ✅ 映射成功: ${resolved.path}`);
      return createMappedObjectUrl(resolved.file);
    });

    // 加载 URDF
    console.log('🔧 开始解析 URDF 文件...');
    console.log('-----------------------------------');
    return new Promise((resolve, reject) => {
      // 避免 urdf-loader 从 URDF 的临时 blob URL 推导出
      // `blob:.../meshes/foo.STL` 这种伪路径，直接使用上传目录基路径。
      candidateLoader.manager = manager;
      candidateLoader.workingPath = basePath;
      let urdfObjectUrl = null;
      let settled = false;

      const cleanup = () => {
        if (urdfObjectUrl) {
          URL.revokeObjectURL(urdfObjectUrl);
          urdfObjectUrl = null;
        }
        releaseMappedObjectUrls();
      };
      let timeout;
      const fail = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      const succeed = robot => {
        if (settled) return;
        try {
          const candidateJoints = this.collectJoints(robot);
          // No operation below this point can fail: commit the complete candidate
          // as one state transition.
          this.loader = candidateLoader;
          this.fileMap = candidateFileMap;
          this.robot = robot;
          this.joints = candidateJoints;
          settled = true;
          clearTimeout(timeout);
          cleanup();
          resolve(robot);
        } catch (error) {
          fail(error);
        }
      };

      // 添加超时检测
      timeout = setTimeout(() => {
        console.error('⏰ URDF 解析超时（30秒无响应）');
        console.error('LoadingManager 状态:');
        console.error('  - loadComplete:', loadComplete);
        console.error('可能的原因:');
        if (loadComplete) {
          console.error('  1. ✅ 资源已加载完成，但 urdf-loader 回调未触发');
          console.error('  2. 可能是 urdf-loader 版本兼容性问题');
          console.error('  3. 尝试检查 URDF 文件格式');
        } else {
          console.error('  1. ❌ 资源加载未完成');
          console.error('  2. 某些 mesh 文件可能丢失');
          console.error('  3. 检查文件路径是否正确');
        }
        fail(new Error('URDF 解析超时 - ' + (loadComplete ? '回调未触发' : '资源加载未完成')));
      }, 30000);
      
      try {
        // 检查 urdf-loader 的 load 方法是否存在
        console.log('🔍 检查 loader 方法:');
        console.log('  - parse:', typeof candidateLoader.parse);
        console.log('  - load:', typeof candidateLoader.load);
        
        // urdf-loader 可能需要使用 load 方法而不是 parse
        if (typeof candidateLoader.load === 'function') {
          console.log('💡 使用 loader.load() 方法');
          
          // 创建一个临时的 Blob URL
          const blob = new Blob([urdfText], { type: 'text/xml' });
          urdfObjectUrl = URL.createObjectURL(blob);
          
          candidateLoader.load(
            urdfObjectUrl,
            (robot) => {
              if (settled) return;
              console.log('🎉 load 成功回调被触发！');
              console.log('✅ URDF 解析完成！');
              console.log('🤖 机器人对象:', robot);
              
              // urdf-loader 的模型回调早于 STL/DAE 资源完成。等到
              // LoadingManager 收口后再返回，确保后续 Mesh 优化能遍历到完整几何。
              resourcesReady.then(() => {
                if (settled) return;
                if (resourceErrors.length > 0) {
                  fail(new Error(
                    `URDF 资源加载失败 (${resourceErrors.length}): ` +
                    resourceErrors.slice(0, 3).join(', ')
                  ));
                  return;
                }
                console.log('✅ URDF 加载成功！');
                console.log('-----------------------------------');
                succeed(robot);
              });
            },
            (xhr) => {
              if (xhr && xhr.loaded && xhr.total) {
                console.log(`📊 加载进度: ${(xhr.loaded / xhr.total * 100).toFixed(2)}%`);
              } else {
                console.log('📊 加载中...');
              }
            },
            (error) => {
              console.error('❌ load 错误回调被触发:', error);
              fail(error);
            }
          );
        } else {
          throw new Error('当前 urdf-loader 缺少必需的 load() API');
        }
        
        console.log('⏳ 等待回调触发...');
        
      } catch (syncError) {
        console.error('💥 调用时发生同步错误:');
        console.error('错误:', syncError);
        console.error('错误堆栈:', syncError.stack);
        fail(syncError);
      }
    });
  }

  extractJoints(robot) {
    this.joints = this.collectJoints(robot);
  }

  getRobotModel() {
    return this.robot;
  }

  getJoints() {
    return this.joints;
  }

  // 从已有的文件映射创建新的机器人实例
  async loadFromMap(fileMap, onComplete) {
    try {
      console.log('🔄 从文件映射创建新机器人实例...');
      
      // 找到URDF文件
      let urdfFile = null;
      let urdfPath = '';
      for (const [path, file] of fileMap.entries()) {
        if (path.toLowerCase().endsWith('.urdf')) {
          urdfFile = file;
          urdfPath = path;
          break;
        }
      }
      
      if (!urdfFile) {
        throw new Error('文件映射中未找到URDF文件');
      }
      
      // 处理字符串或 File 对象
      let urdfText;
      if (typeof urdfFile === 'string') {
        // 已经是字符串（从 Cookie 恢复）
        urdfText = urdfFile;
        console.log('📝 使用字符串格式的 URDF 内容');
      } else if (urdfFile.text && typeof urdfFile.text === 'function') {
        // 是 File/Blob 对象
        urdfText = await urdfFile.text();
        console.log('📝 从 File 对象读取 URDF 内容');
      } else {
        throw new Error('无效的 URDF 文件格式');
      }
      
      const basePath = urdfPath.substring(0, urdfPath.lastIndexOf('/') + 1);
      
      // 设置加载管理器
      const manager = new THREE.LoadingManager();
      const loader = this.createLoader(manager);
      const mappedObjectUrls = new Set();
      const createMappedObjectUrl = value => {
        const objectUrl = URL.createObjectURL(value);
        mappedObjectUrls.add(objectUrl);
        return objectUrl;
      };
      const releaseMappedObjectUrls = () => {
        mappedObjectUrls.forEach(objectUrl => URL.revokeObjectURL(objectUrl));
        mappedObjectUrls.clear();
      };
      let resourceStarted = false;
      let resolveResourcesReady;
      const resourceErrors = [];
      const resourcesReady = new Promise(resolve => {
        resolveResourcesReady = resolve;
      });

      manager.onStart = () => {
        resourceStarted = true;
      };
      manager.onLoad = () => {
        resolveResourcesReady();
      };
      manager.onError = url => {
        resourceErrors.push(url);
        console.error(`❌ 加载失败: ${url}`);
      };
      
      manager.setURLModifier((url) => {
        console.log(`🔗 请求URL: ${url}`);
        const resolved = resolveMappedAsset(fileMap, url, basePath);
        if (resolved.passthrough) return resolved.passthrough;
        const file = resolved.file;
        let blobUrl;
        if (typeof file === 'string') {
          blobUrl = file.startsWith('blob:')
            ? file
            : createMappedObjectUrl(new Blob([file], { type: 'text/plain' }));
        } else if (file instanceof Blob || file instanceof File) {
          blobUrl = createMappedObjectUrl(file);
        } else {
          throw new TypeError(`无效的 URDF 资源类型: ${resolved.path}`);
        }
        console.log(`✅ 映射成功: ${resolved.path}`);
        return blobUrl;
      });
      
      loader.workingPath = basePath;
      // 不设置自定义 loadMeshCb，让 urdf-loader 使用默认的 mesh 加载器
      // urdf-loader 会根据文件扩展名自动选择正确的加载器（STLLoader, ColladaLoader等）
      
      let newRobot;
      try {
        newRobot = loader.parse(urdfText);
        if (resourceStarted) {
          await new Promise((resolve, reject) => {
            const resourceTimeout = setTimeout(
              () => reject(new Error('URDF Mesh 资源加载超时')),
              30000
            );
            resourcesReady.then(() => {
              clearTimeout(resourceTimeout);
              resolve();
            });
          });
        }
      } finally {
        releaseMappedObjectUrls();
      }
      if (resourceErrors.length > 0) {
        throw new Error(
          `URDF 资源加载失败 (${resourceErrors.length}): ` +
          resourceErrors.slice(0, 3).join(', ')
        );
      }
      console.log('✅ 新机器人实例创建成功');

      // 回调也属于 candidate 验证阶段；它抛错时不能污染已提交 joints。
      const candidateJoints = this.joints.length === 0
        ? this.collectJoints(newRobot)
        : null;
      if (onComplete) {
        onComplete(newRobot);
      }
      if (candidateJoints) {
        this.joints = candidateJoints;
        console.log(`✅ 提取到 ${this.joints.length} 个关节`);
      }

      return newRobot;
    } catch (error) {
      console.error('❌ 从文件映射创建机器人失败:', error);
      throw error;
    }
  }
}
