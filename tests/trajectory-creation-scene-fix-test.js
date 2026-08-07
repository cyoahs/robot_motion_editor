#!/usr/bin/env node

import assertModule from 'assert';

const assert = assertModule.strict;

function parseNumbers(line) {
  return line.split(',').map(value => Number(value));
}

function cloneJSON(value) {
  return JSON.parse(JSON.stringify(value));
}

async function run() {
  // trajectoryManager imports i18n, whose initialization expects browser globals.
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  };
  globalThis.window = { location: { search: '' } };
  Object.defineProperty(globalThis, 'navigator', {
    value: { languages: ['en'], language: 'en' },
    configurable: true
  });

  const {
    TrajectoryManager,
    assertSharedTimelineInvariant
  } = await import('../src/trajectoryManager.js');

  // Zero-trajectory creation uses an identity quaternion and independent frames.
  const manager = new TrajectoryManager();
  assert.equal(manager.isJointFixed(0), false);
  assert.equal(manager.getFixedJointValue(0), null);
  assert.equal(manager.clearFixedJoint(0), false);
  assert.equal(manager.createZeroTrajectory(4, 3, 25, 'scene_created.csv'), 4);
  assert.equal(manager.getFrameCount(), 4);
  assert.equal(manager.jointCount, 3);
  assert.equal(manager.fps, 25);
  assert.equal(manager.originalFileName, 'scene_created.csv');
  manager.baseTrajectory.forEach(state => {
    assert.deepEqual(state.base.position, { x: 0, y: 0, z: 0 });
    assert.deepEqual(state.base.quaternion, { x: 0, y: 0, z: 0, w: 1 });
    assert.deepEqual(state.joints, [0, 0, 0]);
  });
  assert.notEqual(manager.baseTrajectory[0], manager.baseTrajectory[1]);
  assert.notEqual(manager.baseTrajectory[0].base, manager.baseTrajectory[1].base);
  assert.notEqual(manager.baseTrajectory[0].joints, manager.baseTrajectory[1].joints);

  assert.throws(() => manager.createZeroTrajectory(0, 3), RangeError);
  assert.throws(() => manager.createZeroTrajectory(1.5, 3), RangeError);
  assert.throws(() => manager.createZeroTrajectory(1, -1), RangeError);
  assert.throws(() => manager.createZeroTrajectory(1, 3, 0), RangeError);
  assert.throws(() => manager.createZeroTrajectory(1, 3, 50, null), TypeError);

  // Fixed joints override both keyframe residuals and interpolated base motion.
  manager.createZeroTrajectory(4, 3, 25, 'scene_created.csv');
  manager.baseTrajectory.forEach((state, frame) => {
    state.joints = [frame, frame * 2, -frame];
  });
  manager.addKeyframe(0, [10, 20, 30]);
  manager.addKeyframe(3, [13, 26, 27]);
  manager.setFixedJoint(1, 1.25);

  assert.equal(manager.isJointFixed(1), true);
  assert.equal(manager.getFixedJointValue(1), 1.25);
  assert.equal(manager.isJointFixed(0), false);
  assert.equal(manager.getFixedJointValue(0), null);
  for (let frame = 0; frame < manager.getFrameCount(); frame++) {
    assert.equal(manager.getCombinedState(frame).joints[1], 1.25);
  }
  assert.equal(manager.getCombinedStateAtFrame(1.5).joints[1], 1.25);

  const exported = manager.exportCombinedTrajectory('unitree', 25)
    .split('\n')
    .map(parseNumbers);
  assert.equal(exported.length, 4);
  exported.forEach(row => assert.equal(row[8], 1.25));
  const exportedBase = manager.exportBaseTrajectory('unitree', 25)
    .split('\n')
    .map(parseNumbers);
  assert.deepEqual(exportedBase.map(row => row[8]), [0, 2, 4, 6]);

  assert.equal(manager.clearFixedJoint(1), true);
  assert.equal(manager.clearFixedJoint(1), false);
  assert.equal(manager.isJointFixed(1), false);
  assert.notEqual(manager.getCombinedState(2).joints[1], 1.25);
  assert.throws(() => manager.setFixedJoint(-1, 0), RangeError);
  assert.throws(() => manager.setFixedJoint(3, 0), RangeError);
  assert.throws(() => manager.setFixedJoint(1.5, 0), TypeError);
  assert.throws(() => manager.setFixedJoint(1, Number.NaN), TypeError);

  // Project JSON round-trip preserves fixed constraints.
  manager.setFixedJoint(0, -0.5);
  manager.setFixedJoint(2, 0.75);
  const projectData = JSON.parse(JSON.stringify(manager.getProjectData()));
  assert.equal(projectData.version, '2.3');
  assert.deepEqual(projectData.fixedJointValues, { 0: -0.5, 2: 0.75 });

  const restored = new TrajectoryManager();
  restored.loadProjectData(projectData);
  assert.equal(restored.isJointFixed(0), true);
  assert.equal(restored.getFixedJointValue(0), -0.5);
  assert.equal(restored.getFixedJointValue(2), 0.75);
  assert.equal(restored.getCombinedState(1).joints[0], -0.5);
  assert.equal(restored.getCombinedState(1).joints[2], 0.75);

  const legacyProject = { ...projectData };
  delete legacyProject.fixedJointValues;
  const legacyRestored = new TrajectoryManager();
  legacyRestored.loadProjectData(legacyProject);
  assert.equal(legacyRestored.isJointFixed(0), false);

  // Growing clones the last state deeply; shrinking removes out-of-range keyframes.
  const resized = new TrajectoryManager();
  resized.createZeroTrajectory(2, 2, 50);
  resized.baseTrajectory[1].base.position.x = 4;
  resized.baseTrajectory[1].joints = [2, 3];
  resized.addKeyframe(1, [5, 6]);
  resized.setFixedJoint(0, 9);
  assert.equal(resized.resizeTrajectory(4), 4);
  assert.deepEqual(resized.getBaseState(2), resized.getBaseState(1));
  assert.deepEqual(resized.getBaseState(3), resized.getBaseState(1));
  assert.notEqual(resized.getBaseState(2), resized.getBaseState(1));
  assert.notEqual(resized.getBaseState(2).base, resized.getBaseState(1).base);
  assert.notEqual(resized.getBaseState(2).joints, resized.getBaseState(1).joints);
  resized.getBaseState(2).joints[0] = 100;
  assert.equal(resized.getBaseState(1).joints[0], 2);
  resized.addKeyframe(3, [7, 8]);
  assert.equal(resized.resizeTrajectory(2), 2);
  assert.equal(resized.keyframes.has(1), true);
  assert.equal(resized.keyframes.has(3), false);
  assert.equal(resized.getFixedJointValue(0), 9);
  assert.throws(() => resized.resizeTrajectory(0), RangeError);
  assert.throws(() => new TrajectoryManager().resizeTrajectory(2), Error);

  // Robot and scene keep independent values but are governed by one exact
  // frame-count/FPS invariant.
  const robotClock = new TrajectoryManager();
  const sceneClock = new TrajectoryManager();
  robotClock.createZeroTrajectory(5, 2, 50, 'robot.csv');
  sceneClock.createZeroTrajectory(5, 3, 50, 'scene.csv');
  sceneClock.setFixedJoint(1, 2.5);
  assert.deepEqual(
    assertSharedTimelineInvariant([robotClock, sceneClock]),
    { frameCount: 5, fps: 50 }
  );
  assert.deepEqual(
    assertSharedTimelineInvariant([robotClock, sceneClock], { frameCount: 5, fps: 50 }),
    { frameCount: 5, fps: 50 }
  );

  sceneClock.setFPS(25);
  assert.throws(
    () => assertSharedTimelineInvariant([robotClock, sceneClock]),
    /帧数\/FPS必须一致/
  );
  sceneClock.setFPS(50);
  sceneClock.resizeTrajectory(4);
  assert.throws(
    () => assertSharedTimelineInvariant([robotClock, sceneClock]),
    /帧数\/FPS必须一致/
  );

  robotClock.setFPS(60);
  robotClock.resizeTrajectory(7);
  sceneClock.setFPS(60);
  sceneClock.resizeTrajectory(7);
  assert.deepEqual(
    assertSharedTimelineInvariant([robotClock, sceneClock]),
    { frameCount: 7, fps: 60 }
  );
  assert.equal(sceneClock.getFixedJointValue(1), 2.5);
  const robotRows = robotClock.exportCombinedTrajectory('unitree', 60).split('\n');
  const sceneRows = sceneClock.exportCombinedTrajectory('unitree', 60).split('\n');
  assert.equal(robotRows.length, 7);
  assert.equal(sceneRows.length, robotRows.length);
  sceneRows.forEach(row => assert.equal(parseNumbers(row)[8], 2.5));
  assert.throws(
    () => assertSharedTimelineInvariant([robotClock], { frameCount: 0, fps: 60 }),
    /frameCount/
  );

  // CSV validation rejects empty, ragged, or shifted non-finite joint data.
  const parsed = new TrajectoryManager();
  parsed.parseCSV(`0,0,0,0,0,0,1,1,2\n0,0,0,0,0,0,1,3,4`, 'valid.csv');
  parsed.addKeyframe(0, [1, 2]);
  parsed.setFixedJoint(0, 5);
  parsed.parseCSV(`0,0,0,0,0,0,1,8,9`, 'replacement.csv');
  assert.equal(parsed.keyframes.size, 0);
  assert.deepEqual(parsed.fixedJointValues, {});
  assert.throws(() => parsed.parseCSV(''), Error);
  const assertAtomicCSVRejection = (csv, fileName, expectedError) => {
    const snapshot = JSON.stringify(parsed.getProjectData());
    const baseTrajectoryReference = parsed.baseTrajectory;
    const keyframesReference = parsed.keyframes;
    const fixedJointValuesReference = parsed.fixedJointValues;

    assert.throws(() => parsed.parseCSV(csv, fileName), expectedError);
    assert.equal(JSON.stringify(parsed.getProjectData()), snapshot);
    assert.equal(parsed.baseTrajectory, baseTrajectoryReference);
    assert.equal(parsed.keyframes, keyframesReference);
    assert.equal(parsed.fixedJointValues, fixedJointValuesReference);
  };
  const unitreeFirst = '0,0,0,0,0,0,1,1,2';
  const unitreeLast = '0,0,0,0,0,0,1,5,6';
  assertAtomicCSVRejection(
    `${unitreeFirst}\n0,0,0,0,0,0,1,3\n${unitreeLast}`,
    'unitree-short-middle.csv',
    /列数不一致/
  );
  assertAtomicCSVRejection(
    `${unitreeFirst}\n0,0,0,0,0,0,1,3,4,99\n${unitreeLast}`,
    'unitree-long-middle.csv',
    /列数不一致/
  );

  const seedHeader = [
    'Frame',
    'root_translateX',
    'root_translateY',
    'root_translateZ',
    'root_rotateX',
    'root_rotateY',
    'root_rotateZ',
    'joint_1_dof',
    'joint_2_dof'
  ].join(',');
  const seedFirst = '0,0,0,0,0,0,0,10,20';
  const seedLast = '2,0,0,0,0,0,0,50,60';
  assertAtomicCSVRejection(
    `${seedHeader}\n${seedFirst}\n1,0,0,0,0,0,0,30\n${seedLast}`,
    'seed-short-middle.csv',
    /列数不一致/
  );
  assertAtomicCSVRejection(
    `${seedHeader}\n${seedFirst}\n1,0,0,0,0,0,0,30,40,99\n${seedLast}`,
    'seed-long-middle.csv',
    /列数不一致/
  );
  assert.throws(
    // Even with an extra value keeping the post-filter column count unchanged,
    // an invalid middle DOF must not shift subsequent joints to the left.
    () => parsed.parseCSV(`0,0,0,0,0,0,1,1,2,3,4\n0,0,0,0,0,0,1,4,NaN,6,7`),
    /无效数值/
  );
  assert.throws(() => parsed.addKeyframe(0, [1]), TypeError);
  assert.throws(() => parsed.addKeyframe(1, [1, 2]), RangeError);
  assert.throws(() => parsed.addKeyframe(0, [1, Number.POSITIVE_INFINITY]), TypeError);

  // Project loading validates a complete candidate before mutating live state.
  const atomic = new TrajectoryManager();
  atomic.createZeroTrajectory(3, 2, 30, 'preserved.csv');
  atomic.baseTrajectory[0].joints = [0.1, 0.2];
  atomic.addKeyframe(1, [1, 2], {
    position: { x: 1, y: 2, z: 3 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 }
  });
  atomic.setFixedJoint(1, 4.5);
  atomic.setInterpolationMode('bezier');

  const validProject = cloneJSON(atomic.getProjectData());
  const assertAtomicProjectRejection = (mutateCandidate, expectedError) => {
    const candidate = cloneJSON(validProject);
    mutateCandidate(candidate);

    const snapshot = JSON.stringify(atomic.getProjectData());
    const baseTrajectoryReference = atomic.baseTrajectory;
    const keyframesReference = atomic.keyframes;
    const fixedJointValuesReference = atomic.fixedJointValues;

    assert.throws(() => atomic.loadProjectData(candidate), expectedError);
    assert.equal(JSON.stringify(atomic.getProjectData()), snapshot);
    assert.equal(atomic.baseTrajectory, baseTrajectoryReference);
    assert.equal(atomic.keyframes, keyframesReference);
    assert.equal(atomic.fixedJointValues, fixedJointValuesReference);
  };

  [0, -1, Number.NaN, Number.POSITIVE_INFINITY].forEach(invalidFPS => {
    assertAtomicProjectRejection(candidate => {
      candidate.fps = invalidFPS;
    }, /FPS/);
  });
  assertAtomicProjectRejection(candidate => {
    candidate.interpolationMode = 'cubic';
  }, /插值模式/);
  assertAtomicProjectRejection(candidate => {
    candidate.keyframes = {};
  }, /keyframes 必须是数组/);
  assertAtomicProjectRejection(candidate => {
    candidate.keyframes = null;
  }, /keyframes 必须是数组/);
  assertAtomicProjectRejection(candidate => {
    candidate.keyframes[0].frameIndex = 1.5;
  }, /关键帧索引超出范围/);
  assertAtomicProjectRejection(candidate => {
    candidate.keyframes[0].frameIndex = candidate.baseTrajectory.length;
  }, /关键帧索引超出范围/);
  assertAtomicProjectRejection(candidate => {
    candidate.keyframes.push(cloneJSON(candidate.keyframes[0]));
  }, /重复关键帧索引/);
  assertAtomicProjectRejection(candidate => {
    candidate.keyframes[0].residual.pop();
  }, /residual 必须是长度/);
  assertAtomicProjectRejection(candidate => {
    candidate.keyframes[0].residual.push(0);
  }, /residual 必须是长度/);
  assertAtomicProjectRejection(candidate => {
    candidate.keyframes[0].residual[0] = Number.NaN;
  }, /residual 必须全部是有限数值/);
  assertAtomicProjectRejection(candidate => {
    delete candidate.keyframes[0].baseResidual.quaternion;
  }, /baseResidual/);
  assertAtomicProjectRejection(candidate => {
    candidate.keyframes[0].baseResidual.position.x = Number.NEGATIVE_INFINITY;
  }, /baseResidual/);

  // A successful import commits cloned data rather than retaining project aliases.
  const isolatedProject = cloneJSON(validProject);
  const isolated = new TrajectoryManager();
  isolated.loadProjectData(isolatedProject);
  isolatedProject.baseTrajectory[0].joints[0] = 999;
  isolatedProject.keyframes[0].residual[0] = 999;
  isolatedProject.keyframes[0].baseResidual.position.x = 999;
  isolatedProject.fixedJointValues[1] = 999;
  assert.equal(isolated.baseTrajectory[0].joints[0], 0.1);
  assert.notEqual(isolated.keyframes.get(1).residual[0], 999);
  assert.notEqual(isolated.keyframes.get(1).baseResidual.position.x, 999);
  assert.equal(isolated.getFixedJointValue(1), 4.5);

  // Guard the editor wiring that cannot be imported in this DOM-free unit
  // test: there is one CSV input path and one shared creation clock.
  const { readFileSync } = await import('node:fs');
  const mainSource = readFileSync('src/main.js', 'utf8');
  const videoSource = readFileSync('src/videoExporter.js', 'utf8');
  assert.equal(mainSource.includes("getElementById('scene-csv-file')"), false);
  assert.equal(mainSource.includes("getElementById('create-trajectory-target')"), false);
  assert.equal(mainSource.includes('const timeSeconds = frameIndex /'), false);
  assert.match(mainSource, /version:\s*'3\.1'/);
  assert.match(mainSource, /exportCombinedTrajectory\(exportOptions\.format, timeline\.fps\)/);
  assert.match(videoSource, /timeline\.frameCount\s*\/\s*timeline\.fps/);

  console.log('trajectory creation and scene fixed-joint tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
