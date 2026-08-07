#!/usr/bin/env node

import { strict as assert } from 'node:assert';
import {
  URDFLoader,
  normalizeAssetPath,
  resolveMappedAsset
} from '../src/urdfLoader.js';

function makeFile(relativePath, contents = '') {
  const name = relativePath.split('/').pop();
  const file = new File([contents], name, {
    type: name.toLowerCase().endsWith('.urdf') ? 'application/xml' : 'model/stl'
  });
  Object.defineProperty(file, 'webkitRelativePath', {
    value: relativePath,
    configurable: false,
    writable: false
  });
  return file;
}

function makeRobot(name = 'candidate') {
  const joint = {
    children: [],
    isURDFJoint: true,
    jointType: 'revolute',
    limit: { lower: -1, upper: 1 },
    name: `${name}_joint`
  };
  return { children: [joint], name };
}

function finishManagedResource(manager, url, shouldFail) {
  if (shouldFail) manager.itemError(url);
  manager.itemEnd(url);
}

function createFakeLoaderFactory(scenario) {
  return manager => ({
    manager,
    workingPath: '',
    load(url, onLoad, _onProgress, onError) {
      const activeManager = this.manager;
      activeManager.itemStart(url);
      let mappedUrl;
      try {
        mappedUrl = activeManager.resolveURL(`${this.workingPath}${scenario.requestPath}`);
        activeManager.itemStart(mappedUrl);
      } catch (error) {
        onError(error);
        activeManager.itemError(url);
        activeManager.itemEnd(url);
        return;
      }

      onLoad(scenario.robot);
      activeManager.itemEnd(url);
      const finish = () => finishManagedResource(
        activeManager,
        mappedUrl,
        scenario.resourceFailure
      );
      if (scenario.deferResource) scenario.finishResource = finish;
      else queueMicrotask(finish);
    },
    parse() {
      const activeManager = this.manager;
      const mappedUrl = activeManager.resolveURL(
        `${this.workingPath}${scenario.requestPath}`
      );
      activeManager.itemStart(mappedUrl);
      queueMicrotask(() => finishManagedResource(
        activeManager,
        mappedUrl,
        scenario.resourceFailure
      ));
      return scenario.robot;
    }
  });
}

async function withObjectUrlTracker(callback) {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const created = [];
  const revoked = [];
  URL.createObjectURL = value => {
    assert.ok(value instanceof Blob);
    const url = `blob:test-${created.length + 1}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = url => revoked.push(url);
  try {
    return await callback({ created, revoked });
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
}

async function assertFolderFailurePreservesState(files, scenario, expectedError) {
  const loader = new URDFLoader({ loaderFactory: createFakeLoaderFactory(scenario) });
  const committedLoader = loader.loader;
  const committedRobot = makeRobot('committed');
  const committedJoints = [{ name: 'committed_joint' }];
  const committedMap = new Map([['old/old.urdf', 'old project']]);
  loader.robot = committedRobot;
  loader.joints = committedJoints;
  loader.fileMap = committedMap;

  await assert.rejects(loader.loadFromFolder(files), expectedError);
  assert.equal(loader.loader, committedLoader);
  assert.equal(loader.robot, committedRobot);
  assert.equal(loader.joints, committedJoints);
  assert.equal(loader.fileMap, committedMap);
}

let passed = 0;
async function test(name, callback) {
  try {
    await callback();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    process.exitCode = 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

await test('path normalization rejects traversal and ambiguous suffixes', () => {
  assert.equal(normalizeAssetPath('robot/urdf/../meshes/a.STL?cache=1'), 'robot/meshes/a.STL');
  assert.throws(() => normalizeAssetPath('../../outside.STL'), /路径越界/);

  const ambiguous = new Map([
    ['robot/a/shared.STL', new Blob()],
    ['robot/b/shared.STL', new Blob()]
  ]);
  assert.throws(
    () => resolveMappedAsset(ambiguous, 'robot/shared.STL', 'robot/'),
    /资源路径不唯一.*robot\/a\/shared\.STL.*robot\/b\/shared\.STL/
  );

  const normalizedCollision = new Map([
    ['robot/a/../shared.STL', new Blob()],
    ['robot/shared.STL', new Blob()]
  ]);
  assert.throws(
    () => resolveMappedAsset(normalizedCollision, 'robot/shared.STL', 'robot/'),
    /文件映射路径不唯一/
  );
});

await test('a missing mesh rejects without replacing committed loader state', async () => {
  await withObjectUrlTracker(async ({ created, revoked }) => {
    const scenario = { requestPath: 'meshes/missing.STL', robot: makeRobot() };
    await assertFolderFailurePreservesState(
      [makeFile('robot/model.urdf', '<robot/>')],
      scenario,
      /URDF 资源缺失: robot\/meshes\/missing\.STL/
    );
    assert.deepEqual(revoked, created);
    assert.equal(new Set(revoked).size, revoked.length);
  });
});

await test('an ambiguous mesh request rejects without replacing committed loader state', async () => {
  await withObjectUrlTracker(async ({ created, revoked }) => {
    const scenario = { requestPath: 'shared.STL', robot: makeRobot() };
    await assertFolderFailurePreservesState(
      [
        makeFile('robot/model.urdf', '<robot/>'),
        makeFile('robot/a/shared.STL'),
        makeFile('robot/b/shared.STL')
      ],
      scenario,
      /URDF 资源路径不唯一/
    );
    assert.deepEqual(revoked, created);
  });
});

await test('LoadingManager resource errors reject and release every owned Blob URL', async () => {
  await withObjectUrlTracker(async ({ created, revoked }) => {
    const scenario = {
      requestPath: 'meshes/broken.STL',
      resourceFailure: true,
      robot: makeRobot()
    };
    await assertFolderFailurePreservesState(
      [
        makeFile('robot/model.urdf', '<robot/>'),
        makeFile('robot/meshes/broken.STL')
      ],
      scenario,
      /URDF 资源加载失败 \(1\)/
    );
    assert.equal(created.length, 2);
    assert.deepEqual(new Set(revoked), new Set(created));
    assert.equal(revoked.length, created.length);
  });
});

await test('folder load waits for manager closure before committing or revoking URLs', async () => {
  await withObjectUrlTracker(async ({ created, revoked }) => {
    const candidateRobot = makeRobot('ready');
    const scenario = {
      requestPath: 'meshes/ready.STL',
      deferResource: true,
      robot: candidateRobot
    };
    const loader = new URDFLoader({ loaderFactory: createFakeLoaderFactory(scenario) });
    const committedRobot = makeRobot('old');
    const committedMap = new Map([['old/model.urdf', 'old']]);
    loader.robot = committedRobot;
    loader.fileMap = committedMap;

    let completed = false;
    const loading = loader.loadFromFolder([
      makeFile('robot/model.urdf', '<robot/>'),
      makeFile('robot/meshes/ready.STL')
    ]).then(result => {
      completed = true;
      return result;
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(completed, false);
    assert.equal(loader.robot, committedRobot);
    assert.equal(loader.fileMap, committedMap);
    assert.equal(created.length, 2);
    assert.deepEqual(revoked, []);

    scenario.finishResource();
    assert.equal(await loading, candidateRobot);
    assert.equal(loader.robot, candidateRobot);
    assert.equal(loader.fileMap.size, 2);
    assert.equal(loader.joints[0].name, 'ready_joint');
    assert.deepEqual(new Set(revoked), new Set(created));
    assert.equal(revoked.length, created.length);
  });
});

await test('loadFromMap resource failure preserves joints and releases mapped URLs', async () => {
  await withObjectUrlTracker(async ({ created, revoked }) => {
    const scenario = {
      requestPath: 'meshes/broken.STL',
      resourceFailure: true,
      robot: makeRobot('map')
    };
    const loader = new URDFLoader({ loaderFactory: createFakeLoaderFactory(scenario) });
    const committedJoints = [{ name: 'old_joint' }];
    loader.joints = committedJoints;
    await assert.rejects(
      loader.loadFromMap(new Map([
        ['robot/model.urdf', '<robot/>'],
        ['robot/meshes/broken.STL', new Blob()]
      ])),
      /URDF 资源加载失败 \(1\)/
    );
    assert.equal(loader.joints, committedJoints);
    assert.equal(created.length, 1);
    assert.deepEqual(revoked, created);
  });
});

if (!process.exitCode) console.log(`1..${passed}`);
