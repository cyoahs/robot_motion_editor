#!/usr/bin/env node

import assertModule from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const assert = assertModule.strict;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEGENERATE_EPSILON = 1e-14;
const profile = JSON.parse(fs.readFileSync(
  path.join(repositoryRoot, 'scripts', 'mesh_optimization_profile.json'),
  'utf8'
));

assert.equal(profile.name, 'visualization');
assert.equal(profile.defaultFaceCap, 6000);
assert.equal(profile.genericFaceCap, 20000);

function collectMeshReferences(urdf, elementName = null) {
  const source = elementName
    ? Array.from(urdf.matchAll(new RegExp(`<${elementName}\\b[\\s\\S]*?<\\/${elementName}>`, 'gi')))
      .map(match => match[0])
      .join('\n')
    : urdf;
  return Array.from(source.matchAll(/<mesh\s+[^>]*filename="([^"]+)"/gi), match => match[1]);
}

function analyzeBinarySTL(filePath) {
  const contents = fs.readFileSync(filePath);
  assert.ok(contents.length >= 84, `${filePath} is too short to be a binary STL`);
  const faceCount = contents.readUInt32LE(80);
  assert.equal(contents.length, 84 + faceCount * 50, `${filePath} has an invalid binary STL size`);

  let degenerateFaces = 0;
  let offset = 84;
  for (let face = 0; face < faceCount; face += 1, offset += 50) {
    const vertices = [];
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const vertexOffset = offset + 12 + vertex * 12;
      const value = [
        contents.readFloatLE(vertexOffset),
        contents.readFloatLE(vertexOffset + 4),
        contents.readFloatLE(vertexOffset + 8)
      ];
      assert.ok(value.every(Number.isFinite), `${filePath} contains a non-finite vertex`);
      vertices.push(value);
    }
    const ab = vertices[1].map((value, axis) => value - vertices[0][axis]);
    const ac = vertices[2].map((value, axis) => value - vertices[0][axis]);
    const cross = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0]
    ];
    const doubledArea = Math.hypot(...cross);
    if (doubledArea <= DEGENERATE_EPSILON) degenerateFaces += 1;
  }
  return { bytes: contents.length, faces: faceCount, degenerateFaces };
}

function auditRobot(robotId, relativeDirectory, urdfName, expectedMovableJoints, totalFaceCeiling) {
  const robotDirectory = path.join(repositoryRoot, relativeDirectory);
  const urdfPath = path.join(robotDirectory, urdfName);
  const urdf = fs.readFileSync(urdfPath, 'utf8');
  const allReferences = [...new Set(collectMeshReferences(urdf))];
  const visualReferences = [...new Set(collectMeshReferences(urdf, 'visual'))];
  const visualFilenames = new Set(visualReferences.map(reference => path.basename(reference).toLowerCase()));

  assert.ok(visualReferences.length > 0, `${urdfPath} must contain visual meshes`);
  Object.keys(profile.robots[robotId]).forEach(fileName => {
    assert.ok(visualFilenames.has(fileName), `${robotId} profile references unused mesh: ${fileName}`);
  });
  allReferences.forEach(reference => {
    assert.ok(fs.existsSync(path.join(robotDirectory, reference)), `Missing URDF mesh: ${reference}`);
  });
  const movableJoints = (urdf.match(/<joint\s+[^>]*type="(?:revolute|continuous|prismatic)"/gi) || []).length;
  assert.equal(movableJoints, expectedMovableJoints);

  const summary = visualReferences.reduce((result, reference) => {
    const mesh = analyzeBinarySTL(path.join(robotDirectory, reference));
    const fileName = path.basename(reference).toLowerCase();
    const faceCap = profile.robots[robotId][fileName] ?? profile.defaultFaceCap;
    assert.ok(mesh.faces <= faceCap, `${reference} exceeds ${faceCap} faces: ${mesh.faces}`);
    assert.equal(mesh.degenerateFaces, 0, `${reference} contains degenerate faces`);
    result.faces += mesh.faces;
    result.bytes += mesh.bytes;
    return result;
  }, { faces: 0, bytes: 0 });
  assert.ok(
    summary.faces <= totalFaceCeiling,
    `${relativeDirectory} visual triangle budget exceeded: ${summary.faces}`
  );
  return { ...summary, meshes: visualReferences.length };
}

const g1 = auditRobot('g1', 'assets/g1', 'g1_29dof_rev_1_0.urdf', 29, 235000);
const h2 = auditRobot('h2', 'assets/h2', 'h2.urdf', 31, 287000);
assert.equal(g1.faces, 234121);
assert.equal(h2.faces, 286451);
console.log('built-in robot asset tests passed', { g1, h2 });
