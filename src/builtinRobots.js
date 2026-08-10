import { createBuiltinRobotFiles } from './builtinRobotFiles.js';

// These globs must stay static so Vite can discover and emit every URDF mesh.
const G1_ASSET_URLS = import.meta.glob(
  [
    '../assets/g1/**/*.{urdf,stl,STL}',
    '!../assets/g1/meshes/left_hand_palm_link.STL',
    '!../assets/g1/meshes/left_wrist_roll_rubber_hand.STL',
    '!../assets/g1/meshes/right_hand_palm_link.STL',
    '!../assets/g1/meshes/right_wrist_roll_rubber_hand.STL',
    '!../assets/g1/meshes/waist_roll_link.STL',
    '!../assets/g1/meshes/waist_yaw_link.STL'
  ],
  { eager: true, query: '?url', import: 'default' }
);
const H2_ASSET_URLS = import.meta.glob(
  [
    '../assets/h2/**/*.{urdf,stl,STL}',
    '!../assets/h2/meshes_0722/left_small_roll_Link.STL',
    '!../assets/h2/meshes_0722/right_small_arm_roll_Link.STL',
    '!../assets/h2/meshes_0722/simple_torso_link.STL'
  ],
  { eager: true, query: '?url', import: 'default' }
);

const BUILTIN_ROBOT_ASSETS = Object.freeze({
  g1: G1_ASSET_URLS,
  h2: H2_ASSET_URLS
});

/**
 * Materialize one bundled Unitree robot as a directory-upload-compatible File[].
 */
export async function getBuiltinRobotFiles(robotId) {
  const assetUrls = BUILTIN_ROBOT_ASSETS[robotId];
  // createBuiltinRobotFiles performs the public ID validation and gives a more
  // useful error than silently treating an unknown ID as an empty manifest.
  return createBuiltinRobotFiles(robotId, assetUrls);
}
