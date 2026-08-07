#!/usr/bin/env node

import assert from 'node:assert/strict';

const appUrl = process.argv[2] || 'http://127.0.0.1:3000/';
const debuggingUrl = process.argv[3] || 'http://127.0.0.1:9222';

const targets = await fetch(`${debuggingUrl}/json`).then(response => response.json());
const target = targets.find(candidate => candidate.type === 'page' && candidate.url === appUrl);
if (!target?.webSocketDebuggerUrl) {
  throw new Error(`No Chrome page target found for ${appUrl}`);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const runtimeExceptions = [];
const consoleErrors = [];
let messageId = 0;

socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }

  if (message.method === 'Runtime.exceptionThrown') {
    runtimeExceptions.push(message.params.exceptionDetails.text);
  } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(
      message.params.args.map(argument => argument.value ?? argument.description ?? '').join(' ')
    );
  }
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

function command(method, params = {}) {
  const id = ++messageId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const response = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text);
  }
  return response.result.value;
}

async function waitFor(expression, description, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await evaluate(expression);
    if (lastValue) return lastValue;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}; last value: ${lastValue}`);
}

await command('Runtime.enable');
await waitFor(
  `document.readyState === 'complete' && !!document.getElementById('add-robot-button')`,
  'the editor UI'
);
console.log('smoke: editor UI ready');

const initial = await evaluate(`(() => {
  const optimize = document.getElementById('optimize-mesh-on-upload');
  const localSettings = document.getElementById('local-processing-settings');
  const localSection = document.getElementById('local-processing-settings-section');
  const autoSave = document.getElementById('auto-save-toggle');
  const clearCookies = document.getElementById('clear-cookies');
  return {
    optimizeChecked: optimize.checked,
    optimizeInLocalSettings: localSettings.contains(optimize),
    optimizeAfterCookieSettings: Boolean(
      autoSave.compareDocumentPosition(optimize) & Node.DOCUMENT_POSITION_FOLLOWING
    ) && Boolean(
      clearCookies.compareDocumentPosition(optimize) & Node.DOCUMENT_POSITION_FOLLOWING
    ),
    hasSettingsDivider: getComputedStyle(localSection).borderTopWidth !== '0px',
    hasSceneCsv: !!document.getElementById('scene-csv-file'),
    hasCreateTarget: !!document.getElementById('create-trajectory-target'),
    loadCsvText: document.querySelector('label[for="csv-file"]').textContent.trim()
  };
})()`);
assert.deepEqual(initial, {
  optimizeChecked: true,
  optimizeInLocalSettings: true,
  optimizeAfterCookieSettings: true,
  hasSettingsDivider: true,
  hasSceneCsv: false,
  hasCreateTarget: false,
  loadCsvText: '加载 CSV 轨迹'
});

const menuState = await evaluate(`(() => {
  document.getElementById('add-robot-button').click();
  document.getElementById('unitree-robots-toggle').click();
  return {
    rootOpen: document.getElementById('add-robot-menu').classList.contains('show'),
    submenuOpen: document.getElementById('unitree-robots-toggle').getAttribute('aria-expanded'),
    items: Array.from(document.querySelectorAll('[data-robot-preset]')).map(item => item.textContent.trim())
  };
})()`);
assert.deepEqual(menuState, {
  rootOpen: true,
  submenuOpen: 'true',
  items: ['G1', 'H2']
});

const closedMenuState = await evaluate(`(() => {
  document.getElementById('add-robot-button').click();
  return {
    rootOpen: document.getElementById('add-robot-menu').classList.contains('show'),
    rootExpanded: document.getElementById('add-robot-button').getAttribute('aria-expanded'),
    submenuOpen: document.querySelector('#unitree-robots-toggle').closest('.dropdown-submenu').classList.contains('open'),
    submenuExpanded: document.getElementById('unitree-robots-toggle').getAttribute('aria-expanded')
  };
})()`);
assert.deepEqual(closedMenuState, {
  rootOpen: false,
  rootExpanded: 'false',
  submenuOpen: false,
  submenuExpanded: 'false'
});
console.log('smoke: import menu and settings verified');

await evaluate(`document.getElementById('load-builtin-g1').click()`);
await waitFor(
  `document.getElementById('status-text').textContent.includes('内置 G1 加载成功')`,
  'built-in G1 to load'
);
assert.equal(
  await evaluate(`document.querySelectorAll('#joint-controls .joint-control').length`),
  29
);
console.log('smoke: built-in G1 loaded');

await evaluate(`(async () => {
  const sceneUrdf = [
    '<?xml version="1.0"?><robot name="smoke_scene">',
    '<link name="root"/>',
    '<joint name="scene_x" type="prismatic"><parent link="root"/><child link="x_link"/>',
    '<axis xyz="1 0 0"/><limit lower="-1" upper="1" effort="1" velocity="1"/></joint>',
    '<link name="x_link"/>',
    '<joint name="scene_y" type="prismatic"><parent link="x_link"/><child link="y_link"/>',
    '<axis xyz="0 1 0"/><limit lower="-1" upper="1" effort="1" velocity="1"/></joint>',
    '<link name="y_link"/>',
    '<joint name="scene_z" type="prismatic"><parent link="y_link"/><child link="plate"/>',
    '<axis xyz="0 0 1"/><limit lower="-1" upper="1" effort="1" velocity="1"/></joint>',
    '<link name="plate"><visual><geometry><box size="0.2 0.2 0.02"/></geometry></visual></link>',
    '</robot>'
  ].join('');
  const file = new File([sceneUrdf], 'smoke_scene.urdf', { type: 'application/xml' });
  Object.defineProperty(file, 'webkitRelativePath', { value: 'g1_plate_scene/g1_plate_scene.urdf' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.getElementById('scene-urdf-folder');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await waitFor(
  `document.querySelectorAll('#scene-joint-controls .joint-control').length === 3`,
  'the independent scene URDF to load'
);
assert.equal(
  await evaluate(`document.querySelectorAll('#scene-joint-controls .joint-fix-option input[type="checkbox"]').length`),
  3
);
console.log('smoke: independent scene loaded');

await evaluate(`(() => {
  document.getElementById('create-frame-count').value = '12';
  document.getElementById('create-fps').value = '30';
  document.getElementById('create-zero-trajectory').click();
  return true;
})()`);
await waitFor(
  `document.getElementById('timeline-slider').max === '11' &&
   document.getElementById('status-text').textContent.includes('12 帧') &&
   document.getElementById('status-text').textContent.includes('30 FPS')`,
  'the shared zero trajectory'
);

const createViewportState = await evaluate(`({
  baseLabel: getComputedStyle(document.getElementById('base-viewport-label')).display,
  divider: getComputedStyle(document.getElementById('viewport-divider')).display,
  editedLabel: getComputedStyle(document.getElementById('edited-viewport-label')).display
})`);
assert.equal(createViewportState.baseLabel, 'none');
assert.equal(createViewportState.divider, 'none');
assert.notEqual(createViewportState.editedLabel, 'none');
console.log('smoke: shared zero trajectory and create viewport verified');

await evaluate(`(() => {
  document.getElementById('create-frame-count').value = '15';
  document.getElementById('create-fps').value = '24';
  document.getElementById('apply-trajectory-length').click();
  return true;
})()`);
await waitFor(
  `document.getElementById('timeline-slider').max === '14' &&
   document.getElementById('status-text').textContent.includes('15 帧') &&
   document.getElementById('status-text').textContent.includes('24 FPS')`,
  'both tracks to resize on the shared clock'
);
console.log('smoke: shared clock resized');

await evaluate(`document.getElementById('load-builtin-h2').click()`);
await waitFor(
  `document.getElementById('status-text').textContent.includes('内置 H2 加载成功')`,
  'built-in H2 to replace G1 while retaining the shared clock'
);
assert.equal(
  await evaluate(`document.querySelectorAll('#joint-controls .joint-control').length`),
  31
);
assert.equal(await evaluate(`document.getElementById('timeline-slider').max`), '14');
assert.equal(await evaluate(`document.getElementById('create-fps').value`), '24');
assert.equal(await evaluate(`document.querySelectorAll('#scene-joint-controls .joint-control').length`), 3);
console.log('smoke: built-in H2 replaced G1');

await evaluate(`document.getElementById('compare-mode-button').click()`);
assert.notEqual(
  await evaluate(`getComputedStyle(document.getElementById('base-viewport-label')).display`),
  'none'
);

// Exercise the real upload optimizer with a connected binary STL above the
// default 30k-face threshold. This also verifies that the optimized geometry
// can be reused by both viewports without changing the shared clock.
await evaluate(`(async () => {
  const cells = 128;
  const triangleCount = cells * cells * 2;
  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangleCount, true);
  let offset = 84;
  const writeTriangle = points => {
    view.setFloat32(offset, 0, true);
    view.setFloat32(offset + 4, 0, true);
    view.setFloat32(offset + 8, 1, true);
    offset += 12;
    for (const point of points) {
      view.setFloat32(offset, point[0], true);
      view.setFloat32(offset + 4, point[1], true);
      view.setFloat32(offset + 8, 0, true);
      offset += 12;
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  };
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      const x0 = x / cells;
      const x1 = (x + 1) / cells;
      const y0 = y / cells;
      const y1 = (y + 1) / cells;
      writeTriangle([[x0, y0], [x1, y0], [x1, y1]]);
      writeTriangle([[x0, y0], [x1, y1], [x0, y1]]);
    }
  }

  const urdf = [
    '<?xml version="1.0"?><robot name="dense_scene">',
    '<link name="root"/>',
    '<joint name="dense_x" type="prismatic"><parent link="root"/><child link="dense_link"/>',
    '<axis xyz="1 0 0"/><limit lower="-1" upper="1" effort="1" velocity="1"/></joint>',
    '<link name="dense_link"><visual><geometry><mesh filename="meshes/grid.STL"/></geometry></visual></link>',
    '</robot>'
  ].join('');
  const urdfFile = new File([urdf], 'dense_scene.urdf', { type: 'application/xml' });
  const meshFile = new File([buffer], 'grid.STL', { type: 'model/stl' });
  Object.defineProperty(urdfFile, 'webkitRelativePath', { value: 'dense_scene/dense_scene.urdf' });
  Object.defineProperty(meshFile, 'webkitRelativePath', { value: 'dense_scene/meshes/grid.STL' });
  const transfer = new DataTransfer();
  transfer.items.add(urdfFile);
  transfer.items.add(meshFile);
  const input = document.getElementById('scene-urdf-folder');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return triangleCount;
})()`);
await waitFor(
  `document.getElementById('status-text').textContent.includes('场景 URDF 加载成功') &&
   document.getElementById('status-text').textContent.includes('Mesh')`,
  'a high-poly scene upload to be optimized'
);
const optimizedUpload = await evaluate(`(() => {
  const status = document.getElementById('status-text').textContent;
  const match = status.match(/Mesh\\s+([\\d,]+)\\s+→\\s+([\\d,]+)/);
  return {
    status,
    before: match ? Number(match[1].replaceAll(',', '')) : null,
    after: match ? Number(match[2].replaceAll(',', '')) : null,
    sceneJointCount: document.querySelectorAll('#scene-joint-controls .joint-control').length,
    timelineMax: document.getElementById('timeline-slider').max,
    fps: document.getElementById('create-fps').value
  };
})()`);
assert.equal(optimizedUpload.sceneJointCount, 1);
assert.equal(optimizedUpload.timelineMax, '14');
assert.equal(optimizedUpload.fps, '24');
assert.ok(optimizedUpload.before > optimizedUpload.after, optimizedUpload.status);
console.log(`smoke: local mesh optimization ${optimizedUpload.before} -> ${optimizedUpload.after}`);

assert.deepEqual(runtimeExceptions, []);
assert.deepEqual(consoleErrors, []);

// A bad replacement upload must fail without replacing the committed H2.
const errorsBeforeBadUpload = consoleErrors.length;
await evaluate(`(() => {
  window.alert = () => {};
  const badUrdf = [
    '<?xml version="1.0"?><robot name="bad_robot">',
    '<link name="root"><visual><geometry><mesh filename="meshes/missing.STL"/></geometry></visual></link>',
    '</robot>'
  ].join('');
  const file = new File([badUrdf], 'bad_robot.urdf', { type: 'application/xml' });
  Object.defineProperty(file, 'webkitRelativePath', { value: 'bad_robot/bad_robot.urdf' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.getElementById('urdf-folder');
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await waitFor(
  `document.getElementById('status-text').textContent.includes('URDF 加载失败')`,
  'a missing-mesh upload to be rejected'
);
assert.equal(
  await evaluate(`document.querySelectorAll('#joint-controls .joint-control').length`),
  31
);
assert.equal(await evaluate(`document.getElementById('timeline-slider').max`), '14');
assert.deepEqual(runtimeExceptions, []);
assert.ok(consoleErrors.length > errorsBeforeBadUpload);
assert.deepEqual(
  consoleErrors.slice(errorsBeforeBadUpload).filter(message =>
    !/missing\.STL|资源缺失|加载失败|机器人 URDF/.test(message)
  ),
  []
);

// Slow built-in prefetches must not resurrect a robot after Reset. Gate every
// built-in asset fetch, reset while they are pending, then release the network.
const errorsBeforeCancellation = consoleErrors.length;
await evaluate(`(() => {
  const originalFetch = window.fetch.bind(window);
  window.__smokeOriginalFetch = originalFetch;
  window.__smokeDelayedFetches = [];
  window.__smokeDelayedRemaining = 0;
  window.__smokeDelayedDone = false;
  window.fetch = (input, init) => {
    const url = String(input?.url || input);
    if (!/\\.(?:STL|urdf)(?:$|\\?)/i.test(url)) return originalFetch(input, init);
    window.__smokeDelayedRemaining += 1;
    return new Promise((resolve, reject) => {
      window.__smokeDelayedFetches.push(() => {
        originalFetch(input, init).then(resolve, reject).finally(() => {
          window.__smokeDelayedRemaining -= 1;
          if (window.__smokeDelayedRemaining === 0) window.__smokeDelayedDone = true;
        });
      });
    });
  };
  document.getElementById('load-builtin-g1').click();
  return true;
})()`);
await waitFor(
  `window.__smokeDelayedFetches?.length > 0`,
  'the built-in G1 prefetch to be held'
);
await evaluate(`(() => {
  window.confirm = () => true;
  document.getElementById('reset-button').click();
  return true;
})()`);
await waitFor(
  `document.querySelectorAll('#joint-controls .joint-control').length === 0 &&
   document.getElementById('status-text').textContent === '就绪'`,
  'Reset to clear H2 while the G1 prefetch is pending'
);
await evaluate(`(() => {
  const releases = window.__smokeDelayedFetches.splice(0);
  window.fetch = window.__smokeOriginalFetch;
  releases.forEach(release => release());
  return releases.length;
})()`);
await waitFor(`window.__smokeDelayedDone === true`, 'the delayed built-in files to finish');
await new Promise(resolve => setTimeout(resolve, 500));
assert.equal(
  await evaluate(`document.querySelectorAll('#joint-controls .joint-control').length`),
  0
);
assert.equal(await evaluate(`document.getElementById('status-text').textContent`), '就绪');
assert.equal(await evaluate(`document.getElementById('add-robot-button').hasAttribute('aria-busy')`), false);
assert.deepEqual(runtimeExceptions, []);
assert.deepEqual(consoleErrors.slice(errorsBeforeCancellation), []);

console.log('browser smoke passed: G1 -> shared clock -> H2 -> local mesh optimization -> atomic failure -> reset cancellation');
socket.close();
