/** G1 及通用人形末端 Link 预设（模糊匹配 URDF 实际名称） */
export const G1_END_EFFECTOR_PRESETS = [
  { id: 'left_hand', labelKey: 'ikPresetLeftHand', patterns: [/left.*wrist/i, /left.*hand/i, /left.*palm/i] },
  { id: 'right_hand', labelKey: 'ikPresetRightHand', patterns: [/right.*wrist/i, /right.*hand/i, /right.*palm/i] },
  { id: 'left_foot', labelKey: 'ikPresetLeftFoot', patterns: [/left.*ankle/i, /left.*foot/i] },
  { id: 'right_foot', labelKey: 'ikPresetRightFoot', patterns: [/right.*ankle/i, /right.*foot/i] }
];

const CHAIN_STOP_KEYWORDS = [
  'waist', 'torso', 'pelvis', 'base_link', 'base', 'trunk', 'lumbar'
];

/**
 * 枚举 URDF 中所有 link 名称
 */
export function listUrdfLinks(robot) {
  const names = [];
  if (robot?.links) {
    names.push(...Object.keys(robot.links));
  } else {
    robot?.traverse((obj) => {
      if (obj.isURDFLink && obj.name) names.push(obj.name);
    });
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/**
 * 从末端 link 向上收集运动链上的关节名（至躯干/对侧肢体为止）
 */
export function inferChainJointNames(robot, endEffectorLinkName) {
  if (!robot || !endEffectorLinkName) return [];

  const endLink = robot.links?.[endEffectorLinkName]
    || robot.frames?.[endEffectorLinkName];
  if (!endLink) return [];

  const sidePrefix = endEffectorLinkName.match(/^(left|right)_/i)?.[1]?.toLowerCase();

  const jointNames = [];
  let current = endLink;

  while (current) {
    if (current.isURDFJoint) {
      const name = current.urdfName || current.name;
      const nameLower = name.toLowerCase();

      if (CHAIN_STOP_KEYWORDS.some((k) => nameLower.includes(k))) {
        break;
      }

      if (sidePrefix) {
        const other = sidePrefix === 'left' ? 'right' : 'left';
        if (nameLower.includes(`${other}_`) || nameLower.startsWith(`${other}`)) {
          break;
        }
      }

      if (current.jointType !== 'fixed') {
        jointNames.unshift(name);
      }
    }
    current = current.parent;
  }

  return jointNames;
}

export function guessDefaultEndLink(robot) {
  const links = listUrdfLinks(robot);
  for (const preset of G1_END_EFFECTOR_PRESETS) {
    for (const link of links) {
      if (preset.patterns.some((p) => p.test(link))) {
        return link;
      }
    }
  }
  return links[0] || '';
}

export function getUrdfLinkObject(robot, linkName) {
  if (robot?.links?.[linkName]) return robot.links[linkName];
  let found = null;
  robot?.traverse((obj) => {
    if (obj.isURDFLink && obj.name === linkName) found = obj;
  });
  return found;
}
