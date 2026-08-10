import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const robotPath = fileURLToPath(
  new URL('./assets/g1_plate/g1_29dof_rev_1_0.urdf', import.meta.url)
);
const scenePath = fileURLToPath(
  new URL('./assets/g1_plate_scene/g1_plate_scene.urdf', import.meta.url)
);

const robotXml = readFileSync(robotPath, 'utf8');
const sceneXml = readFileSync(scenePath, 'utf8');

function stripComments(xml) {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

function getAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? match[1] : null;
}

function getElementAttribute(body, elementName, attributeName) {
  const match = body.match(new RegExp(`<${elementName}\\b([^>]*)\\/>`));
  return getAttribute(match ? match[1] : '', attributeName);
}

function getJoints(xml) {
  const uncommented = stripComments(xml);

  return [...uncommented.matchAll(/<joint\b([^>]*)>([\s\S]*?)<\/joint>/g)].map(
    ([, attributes, body]) => ({
      name: getAttribute(attributes, 'name'),
      type: getAttribute(attributes, 'type'),
      parent: getElementAttribute(body, 'parent', 'link'),
      child: getElementAttribute(body, 'child', 'link'),
      axis: getElementAttribute(body, 'axis', 'xyz'),
    })
  );
}

let passed = 0;

function runTest(name, testFunction) {
  try {
    testFunction();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    process.exitCode = 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

runTest('robot URDF contains only the 29 physical movable joints', () => {
  const joints = getJoints(robotXml);
  const movableJoints = joints.filter(({ type }) => type !== 'fixed');

  assert.equal(movableJoints.length, 29);
  assert.equal(joints.filter(({ type }) => type === 'prismatic').length, 0);
  assert.equal(robotXml.includes('_virtual_bell'), false);
});

runTest('scene URDF exposes the three virtual plate DOFs in XYZ order', () => {
  const joints = getJoints(sceneXml);

  assert.deepEqual(
    joints.map(({ name }) => name),
    ['_virtual_bell_x', '_virtual_bell_y', '_virtual_bell_z']
  );
  assert.deepEqual(joints.map(({ type }) => type), [
    'prismatic',
    'prismatic',
    'prismatic',
  ]);
  assert.deepEqual(joints.map(({ axis }) => axis), ['1 0 0', '0 1 0', '0 0 1']);
});

runTest('scene virtual joints form an independent root-to-plate chain', () => {
  const joints = getJoints(sceneXml);

  assert.deepEqual(
    joints.map(({ parent, child }) => [parent, child]),
    [
      ['_virtual_bell_root_link', '_virtual_bell_x_link'],
      ['_virtual_bell_x_link', '_virtual_bell_y_link'],
      ['_virtual_bell_y_link', '_virtual_bell_z_link'],
    ]
  );
  assert.match(sceneXml, /<link name="_virtual_bell_root_link"\s*\/>/);
  assert.doesNotMatch(sceneXml, /<parent link="pelvis"\s*\/>/);
});

runTest('scene keeps the original primitive plate geometry and has no mesh dependency', () => {
  assert.match(sceneXml, /<cylinder radius="0\.4" length="0\.04"\s*\/>/);
  assert.match(sceneXml, /<origin xyz="0 0 0" rpy="0 1\.57 0"\s*\/>/);
  assert.doesNotMatch(sceneXml, /<mesh\b/);
});

if (!process.exitCode) {
  console.log(`1..${passed}`);
}
