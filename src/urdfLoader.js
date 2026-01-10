import * as THREE from 'three';
import URDFLoaderLib from 'urdf-loader';

export class URDFLoader {
  constructor() {
    this.loader = new URDFLoaderLib();
    this.robot = null;
    this.joints = [];
    this.fileMap = new Map();
  }

  async loadFromFolder(files) {
    console.log(`📂 开始加载文件夹，共 ${files.length} 个文件`);
    
    // 构建文件映射
    this.fileMap.clear();
    console.log('🗂️ 构建文件映射...');
    for (const file of files) {
      const path = file.webkitRelativePath || file.name;
      this.fileMap.set(path, file);
      console.log(`  - ${path}`);
    }
    console.log(`✅ 文件映射构建完成，共 ${this.fileMap.size} 个文件`);

    // 找到 URDF 文件（自动选择第一个）
    console.log('🔍 查找 URDF 文件...');
    const urdfFile = Array.from(files).find(f => 
      f.name.toLowerCase().endsWith('.urdf')
    );

    if (!urdfFile) {
      const fileList = Array.from(files).map(f => f.name).join(', ');
      console.error('❌ 文件列表:', fileList);
      throw new Error('未找到 URDF 文件（.urdf）');
    }

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
    
    // 添加加载管理器事件
    let loadComplete = false;
    manager.onStart = (url, loaded, total) => {
      console.log(`🚀 开始加载: ${url}`);
    };
    
    manager.onLoad = () => {
      console.log('✅ LoadingManager: 所有资源加载完成');
      loadComplete = true;
      console.log('⏳ 等待 urdf-loader 触发回调...');
    };
    
    manager.onProgress = (url, loaded, total) => {
      console.log(`📦 加载进度: ${url} (${loaded}/${total})`);
    };
    
    manager.onError = (url) => {
      console.error(`❌ 加载失败: ${url}`);
    };
    
    manager.setURLModifier((url) => {
      console.log(`🔗 请求加载 URL: ${url}`);
      
      // 处理相对路径
      let relativePath = url;
      
      // 移除 package:// 协议
      if (relativePath.startsWith('package://')) {
        const parts = relativePath.split('/');
        relativePath = parts.slice(2).join('/');
        console.log(`  → 处理 package:// 协议: ${relativePath}`);
      }
      
      // 处理 file:// 协议
      if (relativePath.startsWith('file://')) {
        relativePath = relativePath.substring(7);
        console.log(`  → 处理 file:// 协议: ${relativePath}`);
      }
      
      // 移除前导的 ./
      if (relativePath.startsWith('./')) {
        relativePath = relativePath.substring(2);
        console.log(`  → 移除 ./: ${relativePath}`);
      }
      
      // 移除前导的 /
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.substring(1);
        console.log(`  → 移除前导 /: ${relativePath}`);
      }
      
      // 1. 尝试完整路径匹配
      const fullPath = basePath + relativePath;
      console.log(`  → 完整路径: ${fullPath}`);
      
      let file = this.fileMap.get(fullPath);
      if (file) {
        const objectUrl = URL.createObjectURL(file);
        console.log(`  ✅ 直接匹配成功`);
        return objectUrl;
      }
      
      // 2. 尝试只用相对路径匹配
      file = this.fileMap.get(relativePath);
      if (file) {
        const objectUrl = URL.createObjectURL(file);
        console.log(`  ✅ 相对路径匹配成功`);
        return objectUrl;
      }
      
      // 3. 尝试后缀匹配
      console.log(`  ⚠️ 直接匹配失败，尝试后缀匹配...`);
      for (const [path, file] of this.fileMap.entries()) {
        if (path.endsWith(relativePath)) {
          const objectUrl = URL.createObjectURL(file);
          console.log(`  ✅ 后缀匹配成功: ${path}`);
          return objectUrl;
        }
      }
      
      // 4. 尝试文件名匹配
      const fileName = relativePath.split('/').pop();
      console.log(`  ⚠️ 尝试文件名匹配: ${fileName}`);
      for (const [path, file] of this.fileMap.entries()) {
        if (path.endsWith('/' + fileName) || path === fileName) {
          const objectUrl = URL.createObjectURL(file);
          console.log(`  ✅ 文件名匹配成功: ${path}`);
          return objectUrl;
        }
      }
      
      console.error(`  ❌ 未找到文件: ${relativePath}`);
      console.error(`  文件名: ${fileName}`);
      console.error(`  可用文件列表 (共${this.fileMap.size}个):`);
      Array.from(this.fileMap.keys()).forEach(k => console.error(`    - ${k}`));
      return url;
    });

    // 加载 URDF
    console.log('🔧 开始解析 URDF 文件...');
    console.log('-----------------------------------');
    return new Promise((resolve, reject) => {
      this.loader.manager = manager;
      
      // 添加超时检测
      const timeout = setTimeout(() => {
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
        reject(new Error('URDF 解析超时 - ' + (loadComplete ? '回调未触发' : '资源加载未完成')));
      }, 30000);
      
      try {
        // 检查 urdf-loader 的 load 方法是否存在
        console.log('🔍 检查 loader 方法:');
        console.log('  - parse:', typeof this.loader.parse);
        console.log('  - load:', typeof this.loader.load);
        
        // urdf-loader 可能需要使用 load 方法而不是 parse
        if (typeof this.loader.load === 'function') {
          console.log('💡 使用 loader.load() 方法');
          
          // 创建一个临时的 Blob URL
          const blob = new Blob([urdfText], { type: 'text/xml' });
          const blobUrl = URL.createObjectURL(blob);
          
          this.loader.load(
            blobUrl,
            (robot) => {
              clearTimeout(timeout);
              URL.revokeObjectURL(blobUrl);
              console.log('🎉 load 成功回调被触发！');
              console.log('✅ URDF 解析完成！');
              console.log('🤖 机器人对象:', robot);
              
              this.robot = robot;
              this.extractJoints(robot);
              
              console.log('✅ URDF 加载成功！');
              console.log(`📊 机器人信息: ${this.joints.length} 个可动关节`);
              if (this.joints.length > 0) {
                console.log('🔧 关节列表:', this.joints.map(j => j.name).join(', '));
              }
              console.log('-----------------------------------');
              resolve(robot);
            },
            (xhr) => {
              if (xhr && xhr.loaded && xhr.total) {
                console.log(`📊 加载进度: ${(xhr.loaded / xhr.total * 100).toFixed(2)}%`);
              } else {
                console.log('📊 加载中...');
              }
            },
            (error) => {
              clearTimeout(timeout);
              URL.revokeObjectURL(blobUrl);
              console.error('❌ load 错误回调被触发:', error);
              reject(error);
            }
          );
        } else {
          console.log('💡 使用 loader.parse() 方法');
          
          const result = this.loader.parse(urdfText, (robot) => {
            clearTimeout(timeout);
            console.log('🎉 parse 成功回调被触发！');
            console.log('✅ URDF 解析完成！');
            console.log('🤖 机器人对象:', robot);
            console.log('机器人类型:', robot.constructor.name);
            console.log('机器人子对象数量:', robot.children ? robot.children.length : 0);
            
            this.robot = robot;
            
            console.log('🔍 提取关节信息...');
            this.extractJoints(robot);
            
            console.log('✅ URDF 加载成功！');
            console.log(`📊 机器人信息: ${this.joints.length} 个可动关节`);
            if (this.joints.length > 0) {
              console.log('🔧 关节列表:', this.joints.map(j => j.name).join(', '));
            }
            console.log('-----------------------------------');
            resolve(robot);
          }, (error) => {
            clearTimeout(timeout);
            console.log('❌ parse 错误回调被触发！');
            console.error('-----------------------------------');
            console.error('❌ URDF 解析错误:', error);
            console.error('错误类型:', error.constructor.name);
            console.error('错误信息:', error.message);
            console.error('错误堆栈:', error.stack);
            console.error('-----------------------------------');
            reject(error);
          });
          
          console.log('📥 parse() 调用完成，返回值:', result);
        }
        
        console.log('⏳ 等待回调触发...');
        
      } catch (syncError) {
        clearTimeout(timeout);
        console.error('💥 调用时发生同步错误:');
        console.error('错误:', syncError);
        console.error('错误堆栈:', syncError.stack);
        reject(syncError);
      }
    });
  }

  extractJoints(robot) {
    this.joints = [];
    
    const traverse = (object) => {
      if (object.isURDFJoint && object.jointType !== 'fixed') {
        this.joints.push({
          name: object.name,
          joint: object,
          limits: {
            lower: object.limit?.lower || -Math.PI,
            upper: object.limit?.upper || Math.PI
          }
        });
      }
      
      for (const child of object.children) {
        traverse(child);
      }
    };
    
    traverse(robot);
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
      
      const urdfText = await urdfFile.text();
      const basePath = urdfPath.substring(0, urdfPath.lastIndexOf('/') + 1);
      
      // 设置加载管理器
      const manager = new THREE.LoadingManager();
      
      manager.setURLModifier((url) => {
        console.log(`🔗 请求URL: ${url}`);
        
        let cleanUrl = url.replace(/^package:\/\//, '').replace(/^file:\/\//, '');
        if (cleanUrl.startsWith('./')) cleanUrl = cleanUrl.substring(2);
        if (cleanUrl.startsWith('/')) cleanUrl = cleanUrl.substring(1);
        
        const fullPath = basePath + cleanUrl;
        let file = fileMap.get(fullPath);
        
        if (!file) {
          const relativePath = cleanUrl;
          file = fileMap.get(relativePath);
        }
        
        if (!file) {
          for (const [path, f] of fileMap.entries()) {
            if (path.endsWith(cleanUrl)) {
              file = f;
              break;
            }
          }
        }
        
        if (!file) {
          const filename = cleanUrl.split('/').pop();
          for (const [path, f] of fileMap.entries()) {
            if (path.endsWith(filename)) {
              file = f;
              break;
            }
          }
        }
        
        if (file) {
          const blobUrl = URL.createObjectURL(file);
          console.log(`✅ 映射成功: ${url} -> ${blobUrl}`);
          return blobUrl;
        }
        
        console.warn(`⚠️ 未找到文件: ${url}`);
        return url;
      });
      
      const loader = new URDFLoaderLib(manager);
      // 不设置自定义 loadMeshCb，让 urdf-loader 使用默认的 mesh 加载器
      // urdf-loader 会根据文件扩展名自动选择正确的加载器（STLLoader, ColladaLoader等）
      
      const newRobot = loader.parse(urdfText);
      console.log('✅ 新机器人实例创建成功');
      
      if (onComplete) {
        onComplete(newRobot);
      }
      
      return newRobot;
    } catch (error) {
      console.error('❌ 从文件映射创建机器人失败:', error);
      throw error;
    }
  }
}
