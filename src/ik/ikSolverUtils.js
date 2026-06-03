import { SOLVE_STATUS_NAMES } from 'closed-chain-ik/src/core/ChainSolver.js';

export function findIKLinkByName(ikRoot, linkName) {
  let found = null;
  ikRoot?.traverse((c) => {
    if (c.isLink && (c.name === linkName || c.urdfName === linkName)) {
      found = c;
    }
  });
  return found;
}

/** 格式化 closed-chain-ik 求解状态数组 */
export function formatSolverStatus(status) {
  if (!status) return '-';
  const arr = Array.isArray(status) ? status : [status];
  return arr.map((s) => SOLVE_STATUS_NAMES[s] ?? String(s)).join(', ');
}
