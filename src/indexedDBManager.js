/**
 * IndexedDB 管理器 - 处理大型 mesh 文件的存储
 */
export class IndexedDBManager {
  constructor() {
    this.dbName = 'robot_editor_meshes';
    this.dbVersion = 1;
    this.storeName = 'mesh_files';
    this.db = null;
  }

  /**
   * 初始化数据库
   */
  async initDB() {
    if (this.db) {
      return this.db;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('❌ IndexedDB 打开失败:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('✅ IndexedDB 已打开');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // 创建 mesh 文件存储
        if (!db.objectStoreNames.contains(this.storeName)) {
          const objectStore = db.createObjectStore(this.storeName, { keyPath: 'path' });
          objectStore.createIndex('timestamp', 'timestamp', { unique: false });
          console.log('✅ IndexedDB 对象存储已创建');
        }
      };
    });
  }

  /**
   * 保存文件到 IndexedDB
   * @param {string} path - 文件路径
   * @param {Blob|File} file - 文件对象
   * @param {Object} metadata - 元数据
   */
  async saveFile(path, file, metadata = {}) {
    try {
      await this.initDB();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const objectStore = transaction.objectStore(this.storeName);

        const fileData = {
          path,
          data: file,
          size: file.size,
          type: file.type || 'application/octet-stream',
          timestamp: Date.now(),
          ...metadata
        };

        const request = objectStore.put(fileData);

        request.onsuccess = () => {
          console.log(`💾 文件已保存到 IndexedDB: ${path} (${(file.size / 1024).toFixed(2)}KB)`);
          resolve();
        };

        request.onerror = () => {
          console.error(`❌ 保存文件失败: ${path}`, request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('保存文件到 IndexedDB 失败:', error);
      throw error;
    }
  }

  /**
   * 从 IndexedDB 读取文件
   * @param {string} path - 文件路径
   */
  async getFile(path) {
    try {
      await this.initDB();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], 'readonly');
        const objectStore = transaction.objectStore(this.storeName);
        const request = objectStore.get(path);

        request.onsuccess = () => {
          if (request.result) {
            console.log(`📂 从 IndexedDB 读取文件: ${path}`);
            resolve(request.result.data);
          } else {
            resolve(null);
          }
        };

        request.onerror = () => {
          console.error(`❌ 读取文件失败: ${path}`, request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('从 IndexedDB 读取文件失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有已保存的文件路径
   */
  async getAllPaths() {
    try {
      await this.initDB();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], 'readonly');
        const objectStore = transaction.objectStore(this.storeName);
        const request = objectStore.getAllKeys();

        request.onsuccess = () => {
          resolve(request.result);
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('获取文件列表失败:', error);
      return [];
    }
  }

  /**
   * 删除指定文件
   * @param {string} path - 文件路径
   */
  async deleteFile(path) {
    try {
      await this.initDB();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const objectStore = transaction.objectStore(this.storeName);
        const request = objectStore.delete(path);

        request.onsuccess = () => {
          console.log(`🗑️ 已删除文件: ${path}`);
          resolve();
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('删除文件失败:', error);
      throw error;
    }
  }

  /**
   * 清空所有文件
   */
  async clearAll() {
    try {
      await this.initDB();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const objectStore = transaction.objectStore(this.storeName);
        const request = objectStore.clear();

        request.onsuccess = () => {
          console.log('🗑️ IndexedDB 已清空');
          resolve();
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('清空 IndexedDB 失败:', error);
      throw error;
    }
  }

  /**
   * 获取存储使用情况
   */
  async getStorageInfo() {
    try {
      await this.initDB();

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([this.storeName], 'readonly');
        const objectStore = transaction.objectStore(this.storeName);
        const request = objectStore.getAll();

        request.onsuccess = () => {
          const files = request.result;
          const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0);
          const fileCount = files.length;

          resolve({
            fileCount,
            totalSize,
            totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2)
          });
        };

        request.onerror = () => {
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('获取存储信息失败:', error);
      return { fileCount: 0, totalSize: 0, totalSizeMB: '0.00' };
    }
  }

  /**
   * 关闭数据库连接
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('IndexedDB 连接已关闭');
    }
  }
}
