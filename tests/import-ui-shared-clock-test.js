#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const indexPath = fileURLToPath(new URL('../index.html', import.meta.url));
const html = readFileSync(indexPath, 'utf8');
const mainPath = fileURLToPath(new URL('../src/main.js', import.meta.url));
const mainSource = readFileSync(mainPath, 'utf8');

function parseStartTags(source) {
  return [...source.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)].map(match => ({
    tagName: match[1].toLowerCase(),
    source: match[0],
    offset: match.index
  }));
}

function getAttribute(tagSource, attributeName) {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tagSource.match(new RegExp(
    `\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i'
  ));
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

function hasBooleanAttribute(tagSource, attributeName) {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escapedName}(?=\\s|=|/?>)`, 'i').test(tagSource);
}

const tags = parseStartTags(html);
const elementsById = new Map();

for (const tag of tags) {
  const id = getAttribute(tag.source, 'id');
  if (!id) continue;
  const matches = elementsById.get(id) || [];
  matches.push(tag);
  elementsById.set(id, matches);
}

function elementById(id) {
  const matches = elementsById.get(id) || [];
  assert.equal(matches.length, 1, `expected exactly one element with id="${id}"`);
  return matches[0];
}

function elementText(tag) {
  const contentStart = tag.offset + tag.source.length;
  const closingTag = `</${tag.tagName}>`;
  const contentEnd = html.indexOf(closingTag, contentStart);
  assert.notEqual(contentEnd, -1, `missing closing tag for #${getAttribute(tag.source, 'id')}`);
  return html
    .slice(contentStart, contentEnd)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

await runTest('robot import menu exposes upload plus Unitree G1 and H2', () => {
  const addRobotButton = elementById('add-robot-button');
  const addRobotMenu = elementById('add-robot-menu');
  const uploadButton = elementById('upload-robot-urdf');
  const unitreeButton = elementById('unitree-robots-toggle');
  const g1Button = elementById('load-builtin-g1');
  const h2Button = elementById('load-builtin-h2');

  assert.equal(addRobotButton.tagName, 'button');
  assert.equal(getAttribute(addRobotButton.source, 'data-i18n'), 'addRobot');
  assert.equal(getAttribute(addRobotButton.source, 'aria-controls'), 'add-robot-menu');
  assert.equal(elementText(addRobotButton), '添加机器人');
  assert.equal(addRobotMenu.tagName, 'div');

  assert.equal(getAttribute(uploadButton.source, 'data-i18n'), 'uploadURDF');
  assert.equal(elementText(uploadButton), '上传 URDF');
  assert.equal(getAttribute(unitreeButton.source, 'data-i18n'), 'unitreeRobots');
  assert.equal(getAttribute(unitreeButton.source, 'aria-controls'), 'unitree-robots-menu');
  assert.equal(elementText(unitreeButton), 'Unitree');

  assert.equal(getAttribute(g1Button.source, 'data-robot-preset'), 'g1');
  assert.equal(getAttribute(g1Button.source, 'data-i18n'), 'builtinG1');
  assert.equal(elementText(g1Button), 'G1');
  assert.equal(getAttribute(h2Button.source, 'data-robot-preset'), 'h2');
  assert.equal(getAttribute(h2Button.source, 'data-i18n'), 'builtinH2');
  assert.equal(elementText(h2Button), 'H2');

  assert.ok(uploadButton.offset < unitreeButton.offset, 'Upload URDF must be the first menu action');
  assert.ok(unitreeButton.offset < g1Button.offset && g1Button.offset < h2Button.offset);
});

await runTest('scene upload and legacy robot trajectory label remain visible', () => {
  const sceneInput = elementById('scene-urdf-folder');
  const robotCsvInput = elementById('csv-file');
  const labels = tags.filter(tag => tag.tagName === 'label');
  const sceneLabel = labels.find(tag => getAttribute(tag.source, 'for') === 'scene-urdf-folder');
  const csvLabel = labels.find(tag => getAttribute(tag.source, 'for') === 'csv-file');

  assert.ok(sceneLabel, 'missing label for the scene URDF input');
  assert.equal(getAttribute(sceneLabel.source, 'data-i18n'), 'uploadScene');
  assert.equal(elementText(sceneLabel), '上传场景');
  assert.equal(getAttribute(sceneInput.source, 'type'), 'file');
  assert.ok(hasBooleanAttribute(sceneInput.source, 'webkitdirectory'));

  assert.ok(csvLabel, 'missing label for the robot CSV input');
  assert.equal(getAttribute(csvLabel.source, 'data-i18n'), 'loadCSV');
  assert.equal(elementText(csvLabel), '加载 CSV 轨迹');
  assert.equal(getAttribute(robotCsvInput.source, 'accept'), '.csv');
});

await runTest('mesh optimization is a single default-on upload option', () => {
  const checkbox = elementById('optimize-mesh-on-upload');
  const localSettings = elementById('local-processing-settings');
  const localSettingsSection = elementById('local-processing-settings-section');
  const clearCookies = elementById('clear-cookies');
  const securityModal = elementById('build-info-modal');
  const labels = tags.filter(tag => tag.tagName === 'label');
  const label = labels.find(tag => getAttribute(tag.source, 'for') === 'optimize-mesh-on-upload');

  assert.equal(checkbox.tagName, 'input');
  assert.equal(getAttribute(checkbox.source, 'type'), 'checkbox');
  assert.ok(hasBooleanAttribute(checkbox.source, 'checked'), 'mesh optimization must default to checked');
  assert.ok(label, 'missing mesh optimization label');
  assert.equal(getAttribute(label.source, 'data-i18n-title'), 'optimizeMeshOnUploadTitle');
  assert.match(elementText(label), /优化上传 Mesh/);
  assert.ok(securityModal.offset < localSettings.offset, 'setting must live in the local-processing/data-security modal');
  assert.ok(clearCookies.offset < localSettingsSection.offset, 'local processing must be its own section below Cookie cleanup');
  assert.ok(localSettings.offset < checkbox.offset, 'checkbox must be contained by local-processing settings');
  assert.equal((elementsById.get('optimize-mesh-on-upload') || []).length, 1);
});

await runTest('one trajectory creation control governs the shared clock', () => {
  assert.equal(elementsById.has('scene-csv-file'), false);
  assert.equal(elementsById.has('create-trajectory-target'), false);
  assert.equal((elementsById.get('create-zero-trajectory') || []).length, 1);
  assert.equal((elementsById.get('create-frame-count') || []).length, 1);
  assert.equal((elementsById.get('create-fps') || []).length, 1);
  assert.equal((elementsById.get('apply-trajectory-length') || []).length, 1);
});

await runTest('initial restore and slow built-in fetches cannot race user writes', () => {
  const builtinStart = mainSource.indexOf('async loadBuiltinRobot(robotId)');
  const builtinEnd = mainSource.indexOf('async loadURDFFolder(', builtinStart);
  const builtinMethod = mainSource.slice(builtinStart, builtinEnd);
  assert.ok(builtinStart >= 0 && builtinEnd > builtinStart);
  assert.ok(
    builtinMethod.indexOf('++this.robotLoadGeneration') <
      builtinMethod.indexOf('await getBuiltinRobotFiles'),
    'built-in intent generation must be captured before network fetches'
  );
  assert.match(builtinMethod, /requestGeneration\s*\n?\s*}\);/);

  for (const methodName of [
    'loadBuiltinRobot',
    'loadURDFFolder',
    'loadSceneURDFFolder',
    'loadCSV',
    'loadProject',
    'resetApplication'
  ]) {
    const methodStart = mainSource.indexOf(`async ${methodName}(`);
    assert.ok(methodStart >= 0, `missing ${methodName}`);
    const methodPrefix = mainSource.slice(methodStart, methodStart + 500);
    assert.match(
      methodPrefix,
      /await this\.waitForInitialRestore\(\)/,
      `${methodName} must wait for initial restore`
    );
  }
});

await runTest('the document contains no duplicate DOM ids', () => {
  const duplicateIds = [...elementsById]
    .filter(([, matches]) => matches.length > 1)
    .map(([id]) => id)
    .sort();
  assert.deepEqual(duplicateIds, []);
});

await runTest('Chinese and English dictionaries have complete import and clock keys', async () => {
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

  const { i18n } = await import('../src/i18n.js');
  i18n.setLanguage('zh');
  const zh = i18n.tAll();
  i18n.setLanguage('en');
  const en = i18n.tAll();

  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());

  const expected = {
    addRobot: ['添加机器人', 'Add Robot'],
    uploadURDF: ['上传 URDF', 'Upload URDF'],
    unitreeRobots: ['Unitree', 'Unitree'],
    builtinG1: ['G1', 'G1'],
    builtinH2: ['H2', 'H2'],
    uploadScene: ['上传场景', 'Upload Scene'],
    optimizeMeshOnUpload: ['优化上传 Mesh', 'Optimize uploaded meshes'],
    optimizeMeshOnUploadTitle: [
      '上传机器人或场景 URDF 时自动减少 Mesh 面数',
      'Automatically reduce mesh face counts when uploading a robot or scene URDF'
    ],
    loadCSV: ['加载 CSV 轨迹', 'Load CSV Trajectory'],
    createModeSettings: ['创建轨迹', 'Create Trajectory'],
    frameCount: ['帧数', 'Frames'],
    fps: ['FPS', 'FPS'],
    createZeroTrajectory: ['创建零轨迹', 'Create Zero Trajectory'],
    applyTrajectoryLength: ['应用长度', 'Apply Length']
  };

  for (const [key, [expectedZh, expectedEn]] of Object.entries(expected)) {
    assert.equal(zh[key], expectedZh, `unexpected zh translation for ${key}`);
    assert.equal(en[key], expectedEn, `unexpected en translation for ${key}`);
  }
});

await runTest('zero trajectories can share one exact frame-count and FPS invariant', async () => {
  const {
    TrajectoryManager,
    assertSharedTimelineInvariant
  } = await import('../src/trajectoryManager.js');

  const robot = new TrajectoryManager();
  const scene = new TrajectoryManager();
  robot.createZeroTrajectory(12, 29, 60, 'robot_created.csv');
  scene.createZeroTrajectory(12, 3, 60, 'scene_created.csv');

  assert.deepEqual(
    assertSharedTimelineInvariant([robot, scene]),
    { frameCount: 12, fps: 60 }
  );
  assert.equal(robot.getFrameCount(), scene.getFrameCount());
  assert.equal(robot.fps, scene.fps);
  assert.notEqual(robot.baseTrajectory, scene.baseTrajectory);

  scene.resizeTrajectory(11);
  assert.throws(
    () => assertSharedTimelineInvariant([robot, scene]),
    /帧数\/FPS必须一致/
  );
});

if (!process.exitCode) {
  console.log(`1..${passed}`);
}
