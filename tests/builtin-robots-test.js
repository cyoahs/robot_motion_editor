import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  buildBuiltinRobotAssetEntries,
  createBuiltinRobotFiles
} from '../src/builtinRobotFiles.js';

class FakeFile {
  constructor(parts, name, options) {
    this.parts = parts;
    this.name = name;
    this.type = options.type;
    this.lastModified = options.lastModified;
  }
}

function response(body, overrides = {}) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    blob: async () => body,
    ...overrides
  };
}

let passed = 0;

async function runTest(name, testFunction) {
  try {
    await testFunction();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    process.exitCode = 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

await runTest('manifest entries preserve folders and assign useful MIME types', () => {
  const entries = buildBuiltinRobotAssetEntries('g1', {
    '../assets/g1/meshes/shared.STL': '/built/shared-a.stl',
    '../assets/g1/g1.urdf': '/built/g1.urdf',
    '../assets/g1/collision/shared.STL': '/built/shared-b.stl'
  });

  assert.deepEqual(
    entries.map(entry => entry.relativePath),
    [
      'g1/collision/shared.STL',
      'g1/g1.urdf',
      'g1/meshes/shared.STL'
    ]
  );
  assert.deepEqual(
    entries.map(entry => entry.name),
    ['shared.STL', 'g1.urdf', 'shared.STL']
  );
  assert.deepEqual(
    entries.map(entry => entry.mimeType),
    ['model/stl', 'application/xml', 'model/stl']
  );
});

await runTest('manifest validation rejects unknown robots and malformed roots', () => {
  assert.throws(
    () => buildBuiltinRobotAssetEntries('h1', {}),
    /Unknown built-in robot "h1".*g1, h2/
  );
  assert.throws(
    () => buildBuiltinRobotAssetEntries('g1', {
      '../assets/h2/h2.urdf': '/built/h2.urdf'
    }),
    /outside its asset root/
  );
  assert.throws(
    () => buildBuiltinRobotAssetEntries('g1', {
      '../assets/g1/meshes/only.STL': '/built/only.stl'
    }),
    /exactly one URDF; found 0/
  );
});

await runTest('files match a webkitdirectory upload without basename deduplication', async () => {
  const requestedUrls = [];
  const assetUrls = {
    '../assets/h2/h2.urdf': '/built/h2.urdf',
    '../assets/h2/visual/shared.STL': '/built/shared-visual.stl',
    '../assets/h2/collision/shared.STL': '/built/shared-collision.stl'
  };
  const files = await createBuiltinRobotFiles('h2', assetUrls, {
    fetchImpl: async url => {
      requestedUrls.push(url);
      return response({ url });
    },
    FileCtor: FakeFile
  });

  assert.equal(files.length, 3);
  assert.deepEqual(
    files.map(file => file.webkitRelativePath),
    [
      'h2/collision/shared.STL',
      'h2/h2.urdf',
      'h2/visual/shared.STL'
    ]
  );
  assert.deepEqual(files.map(file => file.name), ['shared.STL', 'h2.urdf', 'shared.STL']);
  assert.deepEqual(requestedUrls, [
    '/built/shared-collision.stl',
    '/built/h2.urdf',
    '/built/shared-visual.stl'
  ]);
  assert.equal(files[0].webkitRelativePath, 'h2/collision/shared.STL');
  assert.equal(Object.getOwnPropertyDescriptor(files[0], 'webkitRelativePath').writable, false);
});

await runTest('HTTP and network failures identify the exact built-in asset', async () => {
  const manifest = {
    '../assets/g1/g1.urdf': '/built/g1.urdf'
  };

  await assert.rejects(
    createBuiltinRobotFiles('g1', manifest, {
      fetchImpl: async () => response(null, {
        ok: false,
        status: 404,
        statusText: 'Not Found'
      }),
      FileCtor: FakeFile
    }),
    /Failed to fetch built-in g1 asset g1\/g1\.urdf: HTTP 404 Not Found/
  );

  await assert.rejects(
    createBuiltinRobotFiles('g1', manifest, {
      fetchImpl: async () => {
        throw new Error('connection lost');
      },
      FileCtor: FakeFile
    }),
    /Failed to fetch built-in g1 asset g1\/g1\.urdf: connection lost/
  );
});

await runTest('production globs exclude every URDF-unreferenced alternate mesh', () => {
  const source = readFileSync('src/builtinRobots.js', 'utf8');
  const unusedMeshes = [
    'g1/meshes/left_hand_palm_link.STL',
    'g1/meshes/left_wrist_roll_rubber_hand.STL',
    'g1/meshes/right_hand_palm_link.STL',
    'g1/meshes/right_wrist_roll_rubber_hand.STL',
    'g1/meshes/waist_roll_link.STL',
    'g1/meshes/waist_yaw_link.STL',
    'h2/meshes_0722/left_small_roll_Link.STL',
    'h2/meshes_0722/right_small_arm_roll_Link.STL',
    'h2/meshes_0722/simple_torso_link.STL'
  ];

  unusedMeshes.forEach(relativePath => {
    assert.match(source, new RegExp(`!\\.\\./assets/${relativePath.replaceAll('.', '\\.')}`));
  });
});

if (!process.exitCode) {
  console.log(`1..${passed}`);
}
