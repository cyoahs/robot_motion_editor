const BUILTIN_ROBOT_ROOTS = Object.freeze({
  g1: 'g1',
  h2: 'h2'
});

const MIME_TYPES = Object.freeze({
  urdf: 'application/xml',
  stl: 'model/stl'
});

function describeError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

function getRobotRoot(robotId) {
  if (!Object.prototype.hasOwnProperty.call(BUILTIN_ROBOT_ROOTS, robotId)) {
    const supportedIds = Object.keys(BUILTIN_ROBOT_ROOTS).join(', ');
    throw new Error(
      `Unknown built-in robot "${robotId}". Expected one of: ${supportedIds}.`
    );
  }

  return BUILTIN_ROBOT_ROOTS[robotId];
}

function getMimeType(filename) {
  const extension = filename.split('.').pop()?.toLowerCase();
  return MIME_TYPES[extension] || 'application/octet-stream';
}

function getRelativePath(robotRoot, sourcePath) {
  const normalizedSourcePath = sourcePath.replaceAll('\\', '/');
  const rootMarker = `/assets/${robotRoot}/`;
  const markerIndex = normalizedSourcePath.lastIndexOf(rootMarker);

  if (markerIndex < 0) {
    throw new Error(
      `Built-in ${robotRoot.toUpperCase()} asset is outside its asset root: ${sourcePath}`
    );
  }

  const assetPath = normalizedSourcePath.slice(markerIndex + rootMarker.length);
  const pathSegments = assetPath.split('/');
  if (
    !assetPath ||
    pathSegments.some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid built-in asset path: ${sourcePath}`);
  }

  return `${robotRoot}/${assetPath}`;
}

/**
 * Convert a Vite URL manifest into deterministic file descriptors.
 *
 * The relative path, rather than the basename, is the descriptor identity. This
 * mirrors a browser directory upload and preserves files with equal basenames in
 * separate mesh directories.
 */
export function buildBuiltinRobotAssetEntries(robotId, assetUrls) {
  const robotRoot = getRobotRoot(robotId);

  if (!assetUrls || typeof assetUrls !== 'object' || Array.isArray(assetUrls)) {
    throw new TypeError(`Built-in ${robotId} asset manifest must be an object.`);
  }

  const seenRelativePaths = new Set();
  const entries = Object.entries(assetUrls).map(([sourcePath, url]) => {
    if (typeof sourcePath !== 'string' || typeof url !== 'string' || !url) {
      throw new TypeError(
        `Built-in ${robotId} asset manifest contains an invalid path or URL.`
      );
    }

    const relativePath = getRelativePath(robotRoot, sourcePath);
    if (seenRelativePaths.has(relativePath)) {
      throw new Error(`Duplicate built-in asset path: ${relativePath}`);
    }
    seenRelativePaths.add(relativePath);

    const name = relativePath.slice(relativePath.lastIndexOf('/') + 1);
    return {
      sourcePath,
      url,
      relativePath,
      name,
      mimeType: getMimeType(name)
    };
  });

  entries.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, 'en')
  );

  const urdfEntries = entries.filter(entry =>
    entry.name.toLowerCase().endsWith('.urdf')
  );
  if (urdfEntries.length !== 1) {
    throw new Error(
      `Built-in ${robotId} must contain exactly one URDF; found ${urdfEntries.length}.`
    );
  }

  return entries;
}

async function fetchAsset(entry, robotId, fetchImpl, FileCtor) {
  let response;
  try {
    response = await fetchImpl(entry.url);
  } catch (error) {
    throw new Error(
      `Failed to fetch built-in ${robotId} asset ${entry.relativePath}: ${describeError(error)}`,
      { cause: error }
    );
  }

  if (!response || !response.ok) {
    const status = response?.status ?? 'unknown';
    const statusText = response?.statusText ? ` ${response.statusText}` : '';
    throw new Error(
      `Failed to fetch built-in ${robotId} asset ${entry.relativePath}: HTTP ${status}${statusText}.`
    );
  }

  let blob;
  try {
    blob = await response.blob();
  } catch (error) {
    throw new Error(
      `Failed to read built-in ${robotId} asset ${entry.relativePath}: ${describeError(error)}`,
      { cause: error }
    );
  }

  const file = new FileCtor([blob], entry.name, {
    type: entry.mimeType,
    lastModified: 0
  });

  try {
    Object.defineProperty(file, 'webkitRelativePath', {
      configurable: false,
      enumerable: true,
      writable: false,
      value: entry.relativePath
    });
  } catch (error) {
    throw new Error(
      `Failed to preserve built-in asset path ${entry.relativePath}: ${describeError(error)}`,
      { cause: error }
    );
  }

  return file;
}

/**
 * Fetch all manifest URLs and expose them in the same shape as an
 * <input type="file" webkitdirectory> selection.
 */
export async function createBuiltinRobotFiles(
  robotId,
  assetUrls,
  {
    fetchImpl = globalThis.fetch,
    FileCtor = globalThis.File
  } = {}
) {
  const entries = buildBuiltinRobotAssetEntries(robotId, assetUrls);

  if (typeof fetchImpl !== 'function') {
    throw new Error('This environment does not provide fetch().');
  }
  if (typeof FileCtor !== 'function') {
    throw new Error('This environment does not provide the File constructor.');
  }

  return Promise.all(
    entries.map(entry => fetchAsset(entry, robotId, fetchImpl, FileCtor))
  );
}

