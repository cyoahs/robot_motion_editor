#!/usr/bin/env node

import assertModule from 'assert';

const assert = assertModule.strict;

function makeBaseState() {
  return {
    base: {
      position: { x: 5, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 }
    },
    joints: [10, 20]
  };
}

async function run() {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  };
  globalThis.window = {
    location: { search: '' },
    devicePixelRatio: 1
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { languages: ['en'], language: 'en' },
    configurable: true
  });

  const [{ CurveEditor }, { TimelineController }] = await Promise.all([
    import('../src/curveEditor.js'),
    import('../src/timelineController.js')
  ]);

  const storedKeyframe = {
    residual: [3, -2],
    baseResidual: {
      position: { x: 2, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 }
    }
  };
  const manager = {
    jointCount: 2,
    keyframes: new Map([[1, storedKeyframe]]),
    hasTrajectory: () => true,
    getFrameCount: () => 3,
    getBaseState: frame => frame === 1 ? makeBaseState() : null,
    getCombinedState: frame => {
      if (frame !== 1) return null;
      const base = makeBaseState();
      return {
        base: base.base,
        joints: base.joints.map((value, index) => value + storedKeyframe.residual[index])
      };
    },
    getInterpolatedBaseResidual: frame => frame === 1 ? storedKeyframe.baseResidual : null,
    getKeyframes: () => Array.from(manager.keyframes.entries()).map(([frame, keyframe]) => ({
      frame,
      residual: keyframe.residual,
      baseResidual: keyframe.baseResidual
    })),
    isJointFixed: () => false,
    removeKeyframe: frame => manager.keyframes.delete(frame)
  };

  let autoSaveCount = 0;
  let frameRefreshCount = 0;
  const editor = {
    getActiveTrajectoryManager: () => manager,
    timelineController: {
      getCurrentFrame: () => 0,
      setCurrentFrame: () => { frameRefreshCount += 1; }
    },
    triggerAutoSave: () => { autoSaveCount += 1; }
  };

  const curveEditor = Object.create(CurveEditor.prototype);
  curveEditor.editor = editor;
  curveEditor.canvas = { width: 400, height: 200 };
  curveEditor.padding = { left: 0, right: 0, top: 20, bottom: 30 };
  curveEditor.viewTransform = { scaleX: 1, offsetX: 0 };
  curveEditor.curves = new Map([
    ['joint_0', { type: 'joint', index: 0, visible: true }],
    ['base_pos_x', { type: 'base_position', axis: 'x', visible: false }]
  ]);
  curveEditor.calculateValueRange = () => ({ minValue: 0, maxValue: 20 });

  const keyframeSnapshot = manager.getKeyframes()[0];
  const jointCurve = curveEditor.curves.get('joint_0');
  const baseCurve = curveEditor.curves.get('base_pos_x');

  // Keyframe points use the same combined absolute values as the drawn curve.
  assert.equal(curveEditor.getKeyframeValue(keyframeSnapshot, jointCurve), 13);
  assert.equal(curveEditor.getKeyframeValue(keyframeSnapshot, baseCurve), 7);
  const hit = curveEditor.findPointAt(200, 72.5);
  assert.equal(hit.frameIndex, 1);
  assert.equal(hit.curveKey, 'joint_0');

  // Dragging an absolute target back-computes residual = target - base.
  assert.equal(curveEditor.updatePointValue({
    curveKey: 'joint_0',
    frameIndex: 1,
    minValue: 0,
    maxValue: 20
  }, 57.5), true);
  assert.equal(storedKeyframe.residual[0], 5);

  assert.equal(curveEditor.updatePointValue({
    curveKey: 'base_pos_x',
    frameIndex: 1,
    minValue: 0,
    maxValue: 20
  }, 102.5), true);
  assert.equal(storedKeyframe.baseResidual.position.x, 4);
  assert.equal(autoSaveCount, 2);
  assert.equal(frameRefreshCount, 2);

  // A stale point is ignored without creating data or scheduling a save.
  assert.equal(curveEditor.updatePointValue({
    curveKey: 'joint_0',
    frameIndex: 2,
    minValue: 0,
    maxValue: 20
  }, 50), false);
  assert.equal(autoSaveCount, 2);

  let smoothVisibilityUpdates = 0;
  let markerFrames = null;
  let timelineFrameRefresh = null;
  let curveRefreshCount = 0;
  let timelineSaveCount = 0;
  const timeline = Object.create(TimelineController.prototype);
  timeline.editor = {
    getActiveTrajectoryManager: () => manager,
    curveEditor: { updateCurves: () => { curveRefreshCount += 1; } },
    triggerAutoSave: () => { timelineSaveCount += 1; }
  };
  timeline.currentFrame = 0;
  timeline.selectedKeyframes = new Set([1, 9]);
  timeline.updateSmoothButtonVisibility = () => { smoothVisibilityUpdates += 1; };
  timeline.updateKeyframeMarkers = frames => { markerFrames = frames; };
  timeline.setCurrentFrame = frame => { timelineFrameRefresh = frame; };

  // Reads prune stale selection left by resizing, switching, or other deletes.
  assert.deepEqual(timeline.getSelectedKeyframes(), [1]);
  assert.equal(timeline.selectedKeyframes.has(9), false);
  assert.equal(smoothVisibilityUpdates, 1);

  timeline.selectedKeyframes.add(7);
  timeline.clearSelectedKeyframes({ refreshMarkers: false });
  assert.equal(timeline.selectedKeyframes.size, 0);

  timeline.selectedKeyframes.add(1);
  assert.equal(timeline.deleteKeyframe(1), true);
  assert.equal(manager.keyframes.has(1), false);
  assert.equal(timeline.selectedKeyframes.size, 0);
  assert.deepEqual(markerFrames, []);
  assert.equal(timelineFrameRefresh, 0);
  assert.equal(curveRefreshCount, 1);
  assert.equal(timelineSaveCount, 1);
  assert.equal(timeline.deleteKeyframe(1), false);

  console.log('curve and timeline interaction tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
