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
  const names = new Set();
  if (!robot) return [];

  if (robot.links) {
    Object.keys(robot.links).forEach((n) => names.add(n));
  }
  if (typeof robot.traverse === 'function') {
    robot.traverse((obj) => {
      if (obj.isURDFLink) {
        const n = obj.urdfName || obj.name;
        if (n) names.add(n);
      }
    });
  }
  return [...names].sort((a, b) => a.localeCompare(b));
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

/**
 * 从 IK 树 closure link 向上收集具名、有 DoF 的关节（用于校验 URDF 链推断）
 */
export function inferChainJointNamesFromIkTree(ikRoot, endEffectorLinkName) {
  if (!ikRoot || !endEffectorLinkName) return [];

  let endLink = null;
  ikRoot.traverse((c) => {
    if (c.isLink && (c.name === endEffectorLinkName || c.urdfName === endEffectorLinkName)) {
      endLink = c;
    }
  });
  if (!endLink) return [];

  const names = [];
  const seen = new Set();
  let current = endLink.parent;
  while (current) {
    if (current.isJoint && current.name && current.name !== '__world_joint__') {
      if (current.dof?.length > 0 && !seen.has(current.name)) {
        names.unshift(current.name);
        seen.add(current.name);
      }
    }
    current = current.parent;
  }
  return names;
}

export function getUrdfLinkObject(robot, linkName) {
  if (robot?.links?.[linkName]) return robot.links[linkName];
  let found = null;
  robot?.traverse((obj) => {
    if (obj.isURDFLink && (obj.urdfName === linkName || obj.name === linkName)) {
      found = obj;
    }
  });
  return found;
}
