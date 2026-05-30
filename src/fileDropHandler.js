/**
 * 从拖放 DataTransfer 递归收集文件（含文件夹），并补全 webkitRelativePath
 */
export async function collectFilesFromDataTransfer(dataTransfer) {
  const files = [];

  if (dataTransfer?.items?.length) {
    const entries = [];
    for (let i = 0; i < dataTransfer.items.length; i++) {
      const item = dataTransfer.items[i];
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    if (entries.length) {
      await Promise.all(entries.map((entry) => traverseEntry(entry, '', files)));
    }
  }

  if (files.length === 0 && dataTransfer?.files?.length) {
    for (const file of dataTransfer.files) {
      files.push(file);
    }
  }

  return files;
}

function setRelativePath(file, relativePath) {
  try {
    Object.defineProperty(file, 'webkitRelativePath', {
      value: relativePath,
      configurable: true
    });
  } catch {
    /* 部分环境不可写 */
  }
  return file;
}

async function traverseEntry(entry, parentPath, files) {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    setRelativePath(file, parentPath + entry.name);
    files.push(file);
  } else if (entry.isDirectory) {
    const dirPath = parentPath + entry.name + '/';
    const reader = entry.createReader();
    let batch;
    do {
      batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      for (const child of batch) {
        await traverseEntry(child, dirPath, files);
      }
    } while (batch.length > 0);
  }
}

export function hasFileTransfer(dataTransfer) {
  if (!dataTransfer?.types) return false;
  return Array.from(dataTransfer.types).includes('Files');
}

export function classifyDroppedFiles(files) {
  const urdfFiles = files.filter((f) => f.name.toLowerCase().endsWith('.urdf'));
  const csvFiles = files.filter((f) => f.name.toLowerCase().endsWith('.csv'));
  return { urdfFiles, csvFiles };
}
