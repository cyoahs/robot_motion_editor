#!/usr/bin/env node

import assertModule from 'assert';

const assert = assertModule.strict;

function createLocalStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    }
  };
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function run() {
  globalThis.localStorage = createLocalStorage();
  globalThis.window = { location: { search: '' } };
  globalThis.document = { getElementById: () => null };

  const [{ CookieManager }, { TrajectoryManager }] = await Promise.all([
    import('../src/cookieManager.js'),
    import('../src/trajectoryManager.js')
  ]);
  localStorage.setItem('robot_editor_autosave', 'true');

  // A full-save request cannot be downgraded by a later incremental request
  // within the same debounce window.
  const debouncedManager = new CookieManager();
  debouncedManager.saveDebounceDelay = 5;
  const debounceCalls = [];
  debouncedManager.saveState = async (editor, fullSave) => {
    debounceCalls.push({ editor, fullSave });
    return true;
  };

  const firstEditor = { id: 'first' };
  const latestEditor = { id: 'latest' };
  debouncedManager.saveStateDebounced(firstEditor, true);
  debouncedManager.saveStateDebounced(latestEditor, false);
  await wait(25);
  assert.equal(debounceCalls.length, 1);
  assert.equal(debounceCalls[0].editor, latestEditor);
  assert.equal(debounceCalls[0].fullSave, true);
  assert.equal(debouncedManager.pendingFullSave, false);
  assert.equal(debouncedManager.saveDebounceTimer, null);

  debouncedManager.saveStateDebounced(firstEditor, false);
  debouncedManager.saveStateDebounced(latestEditor, true);
  await wait(25);
  assert.equal(debounceCalls.length, 2);
  assert.equal(debounceCalls[1].fullSave, true);

  // V3 stores each trajectory only in its canonical project-data field.
  const manager = new CookieManager();
  const robotProjectData = {
    version: '2.3',
    baseTrajectory: [{ base: { position: {}, quaternion: {} }, joints: [1] }],
    keyframes: [{ frameIndex: 0, residual: [2], baseResidual: null }]
  };
  const sceneProjectData = {
    version: '2.3',
    baseTrajectory: [{ base: { position: {}, quaternion: {} }, joints: [3] }],
    keyframes: [{ frameIndex: 0, residual: [4], baseResidual: null }]
  };
  const trajectoryStub = projectData => ({
    hasTrajectory: () => true,
    getProjectData: () => projectData
  });
  const editor = {
    robotTrajectoryManager: trajectoryStub(robotProjectData),
    sceneTrajectoryManager: trajectoryStub(sceneProjectData),
    getSharedTimelineSpec: () => ({ frameCount: 1, fps: 50 }),
    // If legacy serialization were still active this alias would add a third
    // copy of robot baseTrajectory/keyframes.
    trajectoryManager: {
      hasTrajectory: () => true,
      baseTrajectory: robotProjectData.baseTrajectory,
      keyframes: new Map([[0, { residual: [2], baseResidual: null }]]),
      fps: 50,
      interpolationMode: 'linear',
      originalFileName: 'legacy.csv'
    },
    activeTrack: 'scene',
    workspaceMode: 'create',
    timelineController: { getCurrentFrame: () => 3 },
    urdfLoader: { fileMap: new Map() },
    sceneURDFLoader: { fileMap: new Map() },
    cameraRight: null,
    controls: null,
    curveEditor: null,
    updateStatus: null
  };

  assert.equal(await manager.saveState(editor, false), true);
  const saved = JSON.parse(localStorage.getItem(manager.COOKIE_NAME));
  assert.equal(saved.version, '3.1');
  assert.deepEqual(saved.timeline, { frameCount: 1, fps: 50 });
  assert.deepEqual(saved.robotProjectData, robotProjectData);
  assert.deepEqual(saved.sceneProjectData, sceneProjectData);
  assert.equal(saved.optimizeMeshesOnLoad, true);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'trajectory'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'keyframes'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'baseTrajectory'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'fps'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'interpolationMode'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'originalFileName'), false);

  // A reset that happens while a full save awaits file IO invalidates that
  // snapshot, so it cannot write the cleared state back afterwards.
  const raceManager = new CookieManager();
  raceManager.indexedDBManager = { clearAll: async () => true };
  const delayedURDF = {
    size: 16,
    type: 'text/plain',
    text: async () => {
      await wait(20);
      return '<robot name="delayed"/>';
    }
  };
  const raceEditor = {
    ...editor,
    urdfLoader: { fileMap: new Map([['delayed.urdf', delayedURDF]]) }
  };
  const inFlightSave = raceManager.saveState(raceEditor, true);
  await wait(5);
  await raceManager.clearState();
  assert.equal(await inFlightSave, false);
  assert.equal(localStorage.getItem(raceManager.COOKIE_NAME), null);

  // Scene-only snapshots use the declared shared clock and select the scene;
  // they must not inherit the empty robot manager's default 50 FPS.
  const sceneOnlySaved = new TrajectoryManager();
  sceneOnlySaved.createZeroTrajectory(6, 2, 30, 'scene-only.csv');
  localStorage.setItem(manager.COOKIE_NAME, JSON.stringify({
    version: '3.1',
    timestamp: Date.now(),
    timeline: { frameCount: 6, fps: 30 },
    robotProjectData: null,
    sceneProjectData: sceneOnlySaved.getProjectData(),
    activeTrack: 'scene',
    optimizeMeshesOnLoad: false,
    currentFrame: 2
  }));
  const sceneOnlyRefreshes = [];
  let restoredMeshPreference = null;
  const sceneOnlyEditor = {
    robotTrajectoryManager: new TrajectoryManager(),
    sceneTrajectoryManager: new TrajectoryManager(),
    jointController: null,
    sceneJointController: null,
    activeTrack: 'robot',
    getTrajectoryManager(track) {
      return track === 'scene' ? this.sceneTrajectoryManager : this.robotTrajectoryManager;
    },
    getActiveTrajectoryManager() {
      return this.getTrajectoryManager(this.activeTrack);
    },
    setWorkspaceMode: () => {},
    setMeshOptimizationPreference(value) {
      restoredMeshPreference = value;
    },
    setActiveTrack(track) {
      this.activeTrack = track;
    },
    refreshTimelineForActiveTrack(frame) {
      sceneOnlyRefreshes.push({
        frame,
        frameCount: this.getActiveTrajectoryManager().getFrameCount(),
        fps: this.getActiveTrajectoryManager().fps
      });
    },
    timelineController: { setCurrentFrame: () => {} },
    updateRobotState: () => {},
    cameraRight: null,
    controls: null,
    curveEditor: null
  };
  sceneOnlyEditor.trajectoryManager = sceneOnlyEditor.robotTrajectoryManager;
  assert.equal(await manager.restoreState(sceneOnlyEditor), true);
  assert.equal(sceneOnlyEditor.activeTrack, 'scene');
  assert.equal(sceneOnlyEditor.robotTrajectoryManager.hasTrajectory(), false);
  assert.equal(sceneOnlyEditor.sceneTrajectoryManager.getFrameCount(), 6);
  assert.equal(sceneOnlyEditor.sceneTrajectoryManager.fps, 30);
  assert.equal(restoredMeshPreference, false);
  assert.deepEqual(sceneOnlyRefreshes, [{ frame: 2, frameCount: 6, fps: 30 }]);

  // A v3.1 snapshot with mismatched robot/scene clocks is rejected before
  // either live manager is replaced.
  const liveRobot = new TrajectoryManager();
  const liveScene = new TrajectoryManager();
  liveRobot.createZeroTrajectory(3, 1, 50, 'live-robot.csv');
  liveScene.createZeroTrajectory(3, 1, 50, 'live-scene.csv');
  const mismatchedRobot = new TrajectoryManager();
  const mismatchedScene = new TrajectoryManager();
  mismatchedRobot.createZeroTrajectory(4, 1, 50, 'bad-robot.csv');
  mismatchedScene.createZeroTrajectory(5, 1, 50, 'bad-scene.csv');
  localStorage.setItem(manager.COOKIE_NAME, JSON.stringify({
    version: '3.1',
    timestamp: Date.now(),
    timeline: { frameCount: 4, fps: 50 },
    robotProjectData: mismatchedRobot.getProjectData(),
    sceneProjectData: mismatchedScene.getProjectData()
  }));
  const mismatchEditor = {
    robotTrajectoryManager: liveRobot,
    sceneTrajectoryManager: liveScene,
    trajectoryManager: liveRobot,
    jointController: null,
    sceneJointController: null
  };
  const originalConsoleError = console.error;
  let mismatchRestoreResult;
  try {
    console.error = () => {};
    mismatchRestoreResult = await manager.restoreState(mismatchEditor);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(mismatchRestoreResult, false);
  assert.equal(mismatchEditor.robotTrajectoryManager, liveRobot);
  assert.equal(mismatchEditor.sceneTrajectoryManager, liveScene);
  assert.equal(liveRobot.getFrameCount(), 3);
  assert.equal(liveScene.getFrameCount(), 3);

  // Restore still accepts the v2 legacy trajectory/keyframes layout.
  const legacyState = {
    version: '2.1',
    timestamp: Date.now(),
    trajectory: {
      baseTrajectory: [{
        base: {
          position: { x: 0, y: 0, z: 0 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 }
        },
        joints: [0.5]
      }],
      fps: 60,
      originalFileName: 'legacy.csv'
    },
    keyframes: [{ frame: 0, residual: [0.25], baseResidual: null }],
    fps: 60,
    interpolationMode: 'bezier',
    currentFrame: 0
  };
  localStorage.setItem(manager.COOKIE_NAME, JSON.stringify(legacyState));

  const timelineCalls = [];
  const legacyTrajectoryManager = {
    baseTrajectory: [],
    keyframes: new Map(),
    jointCount: 0,
    fps: 50,
    originalFileName: '',
    interpolationMode: 'linear',
    getFrameCount() {
      return this.baseTrajectory.length;
    },
    getDuration() {
      return this.baseTrajectory.length / this.fps;
    },
    hasTrajectory() {
      return this.baseTrajectory.length > 0;
    }
  };
  const legacyEditor = {
    trajectoryManager: legacyTrajectoryManager,
    timelineController: {
      updateKeyframeMarkers: frames => timelineCalls.push(['markers', frames]),
      updateTimeline: (frames, duration) => timelineCalls.push(['timeline', frames, duration]),
      setFPS: fps => timelineCalls.push(['fps', fps]),
      setCurrentFrame: frame => timelineCalls.push(['frame', frame])
    },
    curveEditor: null,
    cameraRight: null,
    controls: null
  };

  assert.equal(await manager.restoreState(legacyEditor), true);
  assert.equal(legacyTrajectoryManager.jointCount, 1);
  assert.equal(legacyTrajectoryManager.fps, 60);
  assert.equal(legacyTrajectoryManager.originalFileName, 'legacy.csv');
  assert.equal(legacyTrajectoryManager.interpolationMode, 'bezier');
  assert.deepEqual(legacyTrajectoryManager.keyframes.get(0), {
    residual: [0.25],
    baseResidual: null
  });
  assert.ok(timelineCalls.some(call => call[0] === 'timeline' && call[1] === 1));

  console.log('cookie manager v3 tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
