import * as THREE from 'three';

export const TRAJECTORY_FORMATS = Object.freeze({
  UNITREE: 'unitree',
  SEED: 'seed'
});

export const DEFAULT_FPS_BY_FORMAT = Object.freeze({
  [TRAJECTORY_FORMATS.UNITREE]: 50,
  [TRAJECTORY_FORMATS.SEED]: 120
});

export const SEED_EULER_ORDER = 'XYZ';

const SEED_BASE_COLUMNS = [
  'Frame',
  'root_translateX',
  'root_translateY',
  'root_translateZ',
  'root_rotateX',
  'root_rotateY',
  'root_rotateZ'
];

const CM_PER_METER = 100;

export function normalizeTrajectoryFormat(format) {
  if (format === TRAJECTORY_FORMATS.SEED) {
    return TRAJECTORY_FORMATS.SEED;
  }
  return TRAJECTORY_FORMATS.UNITREE;
}

export function detectTrajectoryFormat(csvText) {
  const firstDataLine = getContentLines(csvText)[0] || '';
  const columns = splitCSVLine(firstDataLine);
  const normalizedColumns = columns.map(column => column.trim().toLowerCase());

  if (
    normalizedColumns[0] === 'frame' &&
    normalizedColumns.slice(1, SEED_BASE_COLUMNS.length).join(',') ===
      SEED_BASE_COLUMNS.slice(1).map(column => column.toLowerCase()).join(',')
  ) {
    return TRAJECTORY_FORMATS.SEED;
  }

  return TRAJECTORY_FORMATS.UNITREE;
}

export function parseTrajectoryCSV(csvText, fileName = '') {
  const format = detectTrajectoryFormat(csvText);

  if (format === TRAJECTORY_FORMATS.SEED) {
    return parseSeedCSV(csvText, fileName);
  }

  return parseUnitreeCSV(csvText, fileName);
}

export function exportTrajectoryCSV(states, options = {}) {
  const format = normalizeTrajectoryFormat(options.format);

  if (format === TRAJECTORY_FORMATS.SEED) {
    return exportSeedCSV(states, options);
  }

  return exportUnitreeCSV(states);
}

export function convertTrajectoryCSV(csvText, targetFormat, fileName = '') {
  const parsed = parseTrajectoryCSV(csvText, fileName);
  const csv = exportTrajectoryCSV(parsed.baseTrajectory, {
    format: targetFormat,
    seedJointColumns: parsed.metadata.seedJointColumns
  });

  return {
    csv,
    sourceFormat: parsed.format,
    targetFormat: normalizeTrajectoryFormat(targetFormat),
    frameCount: parsed.baseTrajectory.length,
    jointCount: parsed.jointCount
  };
}

function parseUnitreeCSV(csvText, fileName) {
  const baseTrajectory = [];
  let jointCount = 0;

  for (const line of getContentLines(csvText)) {
    const values = parseNumericRow(line);

    if (values.length < 7) {
      console.warn('CSV row has fewer than 7 columns:', line);
      continue;
    }

    if (!values.slice(0, 7).every(Number.isFinite)) {
      console.warn('CSV row has invalid base values:', line);
      continue;
    }

    const base = {
      position: { x: values[0], y: values[1], z: values[2] },
      quaternion: normalizeQuaternion({ x: values[3], y: values[4], z: values[5], w: values[6] })
    };

    const joints = values.slice(7).filter(Number.isFinite);

    if (jointCount === 0) {
      jointCount = joints.length;
    }

    baseTrajectory.push({ base, joints });
  }

  return {
    format: TRAJECTORY_FORMATS.UNITREE,
    baseTrajectory,
    jointCount,
    fps: DEFAULT_FPS_BY_FORMAT[TRAJECTORY_FORMATS.UNITREE],
    metadata: {
      fileName,
      seedHeader: null,
      seedJointColumns: []
    }
  };
}

function parseSeedCSV(csvText, fileName) {
  const lines = getContentLines(csvText);
  const header = splitCSVLine(lines[0] || '');
  validateSeedHeader(header);

  const seedJointColumns = header.slice(SEED_BASE_COLUMNS.length);
  const baseTrajectory = [];
  let jointCount = 0;

  for (const line of lines.slice(1)) {
    const values = parseNumericRow(line);

    if (values.length < SEED_BASE_COLUMNS.length) {
      console.warn('Seed CSV row has too few columns:', line);
      continue;
    }

    if (!values.slice(1, SEED_BASE_COLUMNS.length).every(Number.isFinite)) {
      console.warn('Seed CSV row has invalid base values:', line);
      continue;
    }

    const quaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(values[4]),
        THREE.MathUtils.degToRad(values[5]),
        THREE.MathUtils.degToRad(values[6]),
        SEED_EULER_ORDER
      )
    );

    const base = {
      position: {
        x: values[1] / CM_PER_METER,
        y: values[2] / CM_PER_METER,
        z: values[3] / CM_PER_METER
      },
      quaternion: normalizeQuaternion(quaternion)
    };

    const joints = values
      .slice(SEED_BASE_COLUMNS.length)
      .filter(Number.isFinite)
      .map(value => THREE.MathUtils.degToRad(value));

    if (jointCount === 0) {
      jointCount = joints.length;
    }

    baseTrajectory.push({ base, joints });
  }

  return {
    format: TRAJECTORY_FORMATS.SEED,
    baseTrajectory,
    jointCount,
    fps: DEFAULT_FPS_BY_FORMAT[TRAJECTORY_FORMATS.SEED],
    metadata: {
      fileName,
      seedHeader: header,
      seedJointColumns
    }
  };
}

function exportUnitreeCSV(states) {
  return states
    .map(state => [
      state.base.position.x,
      state.base.position.y,
      state.base.position.z,
      state.base.quaternion.x,
      state.base.quaternion.y,
      state.base.quaternion.z,
      state.base.quaternion.w,
      ...state.joints
    ].join(','))
    .join('\n');
}

function exportSeedCSV(states, options) {
  const jointCount = states[0]?.joints.length || 0;
  const seedJointColumns = buildSeedJointColumns(jointCount, options.seedJointColumns);
  const header = [...SEED_BASE_COLUMNS, ...seedJointColumns].join(',');
  const lines = [header];

  states.forEach((state, frameIndex) => {
    const quaternion = normalizeQuaternion(state.base.quaternion);
    const euler = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w),
      SEED_EULER_ORDER
    );

    lines.push([
      frameIndex,
      state.base.position.x * CM_PER_METER,
      state.base.position.y * CM_PER_METER,
      state.base.position.z * CM_PER_METER,
      THREE.MathUtils.radToDeg(euler.x),
      THREE.MathUtils.radToDeg(euler.y),
      THREE.MathUtils.radToDeg(euler.z),
      ...state.joints.map(value => THREE.MathUtils.radToDeg(value))
    ].join(','));
  });

  return lines.join('\n');
}

function buildSeedJointColumns(jointCount, seedJointColumns = []) {
  return Array.from({ length: jointCount }, (_, index) => {
    return seedJointColumns[index] || `joint_${index + 1}_dof`;
  });
}

function validateSeedHeader(header) {
  const normalizedHeader = header.map(column => column.trim().toLowerCase());

  SEED_BASE_COLUMNS.forEach((expectedColumn, index) => {
    if (normalizedHeader[index] !== expectedColumn.toLowerCase()) {
      throw new Error(`Seed CSV header column ${index + 1} should be ${expectedColumn}`);
    }
  });
}

function getContentLines(csvText) {
  return csvText
    .trim()
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

function splitCSVLine(line) {
  return line.split(',').map(value => value.trim());
}

function parseNumericRow(line) {
  return splitCSVLine(line).map(value => parseFloat(value));
}

function normalizeQuaternion(quaternionLike) {
  const quaternion = new THREE.Quaternion(
    quaternionLike.x,
    quaternionLike.y,
    quaternionLike.z,
    quaternionLike.w
  );

  const length = Math.sqrt(
    quaternion.x ** 2 +
    quaternion.y ** 2 +
    quaternion.z ** 2 +
    quaternion.w ** 2
  );

  if (!Number.isFinite(length) || length < 0.000001) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }

  quaternion.normalize();
  return {
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
    w: quaternion.w
  };
}
