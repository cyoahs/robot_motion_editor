import * as THREE from 'three';

let _seq = 0;
/** @type {object | null} */
let _activeSession = null;

/** 是否打印每次子 solve（默认关，只打一轮拖拽的汇总） */
export function isIkSolveLogVerbose() {
  return typeof window !== 'undefined' && window.__IK_LOG_SOLVE_VERBOSE__ === true;
}

/** 是否打印 IK 求解日志（默认开启） */
export function isIkSolveLogEnabled() {
  if (typeof window !== 'undefined') {
    if (window.__IK_LOG_SOLVE__ === true) return true;
    if (window.__IK_LOG_SOLVE__ === false) return false;
  }
  const el = document.getElementById('ik-show-debug');
  if (el) return el.checked;
  return true;
}

function fmt3(v) {
  if (!v) return '-';
  return `(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
}

function fmtQuatShort(q) {
  if (!q) return '-';
  const e = new THREE.Euler().setFromQuaternion(q, 'ZYX');
  const d = (r) => (r * 180 / Math.PI).toFixed(2);
  return `RPY° ${d(e.x)}, ${d(e.y)}, ${d(e.z)}`;
}

function fmtErr(err) {
  if (!err) return '-';
  return `Δpos ${(err.position * 1000).toFixed(2)} mm · Δrot ${(err.rotation * 180 / Math.PI).toFixed(2)}°`;
}

function distMm(a, b) {
  if (!a || !b) return null;
  return a.distanceTo(b) * 1000;
}

/** 关节角 → console.table 行 */
export function formatJointRows(jointsBefore = {}, jointsAfter = {}, jointDelta = null) {
  const names = new Set([
    ...Object.keys(jointsBefore),
    ...Object.keys(jointsAfter),
    ...Object.keys(jointDelta || {})
  ]);
  const rows = [];
  for (const name of [...names].sort()) {
    const b = jointsBefore[name];
    const a = jointsAfter[name];
    let d = jointDelta?.[name];
    if (d == null && Number.isFinite(b) && Number.isFinite(a)) {
      d = a - b;
    }
    const bDeg = Number.isFinite(b) ? (b * 180 / Math.PI).toFixed(3) : '-';
    const aDeg = Number.isFinite(a) ? (a * 180 / Math.PI).toFixed(3) : '-';
    const dDeg = Number.isFinite(d) ? (d * 180 / Math.PI).toFixed(3) : '-';
    rows.push({
      joint: name,
      before_rad: Number.isFinite(b) ? b.toFixed(5) : '-',
      after_rad: Number.isFinite(a) ? a.toFixed(5) : '-',
      delta_rad: Number.isFinite(d) ? d.toFixed(5) : '-',
      before_deg: bDeg,
      after_deg: aDeg,
      delta_deg: dDeg
    });
  }
  return rows;
}

function computeJointDelta(before = {}, after = {}) {
  const delta = {};
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const name of names) {
    const d = (after[name] ?? 0) - (before[name] ?? 0);
    if (Math.abs(d) > 1e-6) delta[name] = d;
  }
  return delta;
}

/**
 * 开始一轮 IK（一次 _applyIkSolve），结束时调用 endIkSolveSession
 */
export function beginIkSolveSession(meta = {}) {
  if (!isIkSolveLogEnabled()) return null;
  const id = ++_seq;
  _activeSession = { id, tag: `[IK #${id}]`, ...meta, t0: performance.now() };
  return id;
}

/**
 * 打印一轮 IK 汇总（推荐只看这个折叠组）
 */
export function endIkSolveSession(payload = {}) {
  if (!isIkSolveLogEnabled() || !_activeSession) return;
  const s = _activeSession;
  _activeSession = null;
  const tag = s.tag;
  const success = payload.success ?? payload.result?.success;
  const title = s.title || payload.title || 'IK 求解';
  const isDrag = s.context?.source === 'drag';
  const solverStatus = payload.solverStatus ?? payload.result?.statusLabel;
  const errAfter = payload.errAfter ?? payload.result?.error;
  const errPosMm =
    errAfter?.position != null && Number.isFinite(errAfter.position)
      ? errAfter.position * 1000
      : null;
  const posTolMm =
    (payload.weights ?? s.weights)?.convergedPositionTolerance != null
      ? (payload.weights ?? s.weights).convergedPositionTolerance * 1000
      : 4;

  let statusSuffix = '';
  if (success === false) {
    statusSuffix =
      isDrag && errPosMm != null
        ? ` · 残差 ${errPosMm.toFixed(0)}mm`
        : ' · 未收敛';
    if (solverStatus) statusSuffix += ` · ${solverStatus}`;
  } else if (success && isDrag) {
    statusSuffix = ' · 已对齐';
  }
  const label = `${tag} ${title}${statusSuffix}`;

  const jointsBefore = payload.jointsBefore ?? s.initialJoints ?? {};
  const jointsAfter = payload.jointsAfter ?? {};
  const jointDelta = payload.jointDelta ?? computeJointDelta(jointsBefore, jointsAfter);
  const jointRows = formatJointRows(jointsBefore, jointsAfter, jointDelta);

  const targetPos = payload.targetPos ?? s.targetPos;
  const refQuat = payload.refQuat ?? s.refQuat;
  const dragStartFk = payload.dragStartFk ?? s.dragStartFk;
  const fkBefore = payload.fkBeforeSolve ?? s.fkBeforeSolve ?? payload.fkInitial ?? s.fkInitial;
  const fkAfter = payload.fkAfter ?? s.fkAfter;
  const errBefore = payload.errBefore ?? s.errBefore;
  const bd = payload.targetBreakdown ?? s.targetBreakdown;
  const weights = payload.weights ?? s.weights;
  const dt = ((performance.now() - s.t0) / 1000).toFixed(3);

  console.groupCollapsed(label);

  console.log(`${tag} ── 1. 概要 ──`);
  console.log(
    `${tag} ${s.mode || '-'} | ${s.context?.source || '-'} | ${s.context?.endLink || '-'} | ${dt}s`
  );
  const convergedHint =
    errPosMm != null
      ? ` (位置容差 ${posTolMm.toFixed(1)}mm，当前残差 ${errPosMm.toFixed(1)}mm)`
      : '';
  console.log(
    `${tag} 结果: success=${success}${solverStatus ? ` solver=${solverStatus}` : ''}${convergedHint}`
  );
  if (isDrag && success === false && errPosMm != null && errPosMm > posTolMm) {
    console.log(
      `${tag} 说明: 拖拽中 success 仅表示「未进入 ${posTolMm.toFixed(1)}mm 容差」，IK 仍已执行并更新关节`
    );
  }

  console.log(`${tag} ── 2. 输入目标 vs FK ──`);
  if (payload.proxyInput?.position) {
    console.log(
      `${tag} [输入] Gizmo/Proxy 位姿`,
      fmt3(payload.proxyInput.position),
      fmtQuatShort(payload.proxyInput.quaternion)
    );
  }
  if (targetPos) {
    console.log(`${tag} [输入] IK 目标位置`, fmt3(targetPos));
  }
  if (refQuat) {
    console.log(`${tag} [输入] 姿态软约束`, fmtQuatShort(refQuat));
  }
  if (dragStartFk?.position) {
    console.log(`${tag} [参考] 拖拽起点 FK`, fmt3(dragStartFk.position), fmtQuatShort(dragStartFk.quaternion));
    if (targetPos) {
      console.log(
        `${tag}       gizmo(目标)↔拖拽起点FK`,
        `${distMm(targetPos, dragStartFk.position)?.toFixed(2)} mm`
      );
    }
  }
  if (fkBefore?.position) {
    console.log(`${tag} [求解前] 当前末端 FK`, fmt3(fkBefore.position), fmtQuatShort(fkBefore.quaternion));
    if (targetPos) {
      console.log(`${tag}       目标↔求解前FK`, `${distMm(targetPos, fkBefore.position)?.toFixed(2)} mm`);
    }
    if (dragStartFk?.position) {
      console.log(
        `${tag}       求解前FK↔拖拽起点`,
        `${distMm(fkBefore.position, dragStartFk.position)?.toFixed(2)} mm`
      );
    }
  }
  if (bd) {
    console.log(
      `${tag} [Gizmo] 位移 ${bd.proxyDeltaMm?.toFixed(2)} mm · proxy`,
      fmt3(bd.proxyNow)
    );
  }

  console.log(`${tag} ── 3. 权重 ──`);
  if (weights) {
    const applied = payload.appliedWeights ?? weights;
    let wline = `${tag} T=${applied.translationFactor} R=${applied.rotationFactor} iter=${applied.maxIterations}`;
    if (applied.dampingFactor != null) wline += ` damp=${applied.dampingFactor}`;
    if (applied.translationErrorClamp != null) {
      wline += ` clamp=${applied.translationErrorClamp}`;
    }
    if (applied.convergedPositionTolerance != null) {
      wline += ` posTol=${(applied.convergedPositionTolerance * 1000).toFixed(1)}mm`;
    }
    if (applied.positionOnly) wline += ' posOnly';
    if (applied.rotationOnly) wline += ' rotOnly';
    if (applied.orientationSoft) wline += ' oriSoft';
    console.log(wline);
  }

  console.log(`${tag} ── 4. 链关节（求解前 → 求解后）──`);
  if (jointRows.length) {
    console.table(jointRows);
  } else {
    console.log(`${tag} (无链关节数据)`);
  }

  console.log(`${tag} ── 5. 末端 FK（求解后）──`);
  if (fkAfter?.position) {
    console.log(`${tag} [求解后] 末端 FK`, fmt3(fkAfter.position), fmtQuatShort(fkAfter.quaternion));
    if (targetPos) {
      console.log(`${tag}       目标↔求解后FK`, `${distMm(targetPos, fkAfter.position)?.toFixed(2)} mm`);
    }
    if (fkBefore?.position) {
      console.log(
        `${tag}       求解前→后 FK 位移`,
        `${distMm(fkBefore.position, fkAfter.position)?.toFixed(2)} mm`
      );
    }
  }

  const ikFkBefore = payload.ikFkBefore ?? s.ikFkBefore;
  const ikFkAfter = payload.ikFkAfter ?? s.ikFkAfter;
  if (ikFkBefore?.position || ikFkAfter?.position) {
    console.log(`${tag} ── 5b. IK 内部 closure link ──`);
    if (ikFkBefore?.position) {
      console.log(`${tag} [IK树] 求解前`, fmt3(ikFkBefore.position));
      if (fkBefore?.position) {
        console.log(
          `${tag}       URDF FK↔IK树`,
          `${distMm(fkBefore.position, ikFkBefore.position)?.toFixed(2)} mm`
        );
      }
    }
    if (ikFkAfter?.position) {
      console.log(`${tag} [IK树] 求解后`, fmt3(ikFkAfter.position));
      if (fkAfter?.position) {
        console.log(
          `${tag}       URDF FK↔IK树`,
          `${distMm(fkAfter.position, ikFkAfter.position)?.toFixed(2)} mm`
        );
      }
    }
    if (solverStatus) {
      console.log(`${tag} solver 状态: ${solverStatus}`);
    }
    const loopMm = payload.loopDeltaMm ?? payload.result?.loopDeltaMm;
    if (loopMm != null && Number.isFinite(loopMm)) {
      console.log(
        `${tag} [闭环] 写回后 URDF↔IK树`,
        `${loopMm.toFixed(2)} mm`,
        loopMm < 0.5 ? '(闭环 OK)' : '(⚠ 正逆运动学未闭环)'
      );
    }
    const maxJointDelta = payload.loopMaxJointDeltaRad ?? payload.result?.loopMaxJointDeltaRad;
    if (maxJointDelta != null && Number.isFinite(maxJointDelta)) {
      console.log(
        `${tag} [闭环] 链关节 IK↔URDF 最大差`,
        `${(maxJointDelta * 1000).toFixed(3)} mrad`
      );
    }
  }

  console.log(`${tag} ── 6. 相对目标的误差 ──`);
  if (errBefore) console.log(`${tag} 求解前`, fmtErr(errBefore));
  if (errAfter) console.log(`${tag} 求解后`, fmtErr(errAfter));
  if (errBefore && errAfter) {
    const dPos = (errAfter.position - errBefore.position) * 1000;
    console.log(`${tag} 误差变化 Δpos ${dPos >= 0 ? '+' : ''}${dPos.toFixed(2)} mm`);
  }

  console.groupEnd();
}

/**
 * 详细子步日志；默认不输出
 */
export function logIkSolve(kind, payload = {}) {
  if (!isIkSolveLogEnabled()) return null;
  if (
    (kind === 'solve' ||
      kind === 'pipeline-start' ||
      kind === 'pipeline-end' ||
      kind === 'solve-revert') &&
    !isIkSolveLogVerbose()
  ) {
    return null;
  }

  const id = ++_seq;
  const tag = `[IK #${id}]`;
  const title = payload.title || kind;
  let suffix = '';
  if (payload.reverted) suffix = ' [revert]';
  else if (payload.skipped) suffix = ' [skip]';
  const groupLabel = `${tag} ${title}${suffix}`;

  console.groupCollapsed(groupLabel);
  if (payload.targetPos) console.log(`${tag} target`, fmt3(payload.targetPos));
  if (payload.errBefore) console.log(`${tag} errBefore`, fmtErr(payload.errBefore));
  if (payload.errAfter) console.log(`${tag} errAfter`, fmtErr(payload.errAfter));
  console.groupEnd();
  return id;
}

export function installIkSolveLogGlobals() {
  if (typeof window === 'undefined') return;
  window.enableIkSolveLog = () => {
    window.__IK_LOG_SOLVE__ = true;
    console.info('[IK] 汇总日志已开启（每轮拖拽一个折叠组）');
  };
  window.disableIkSolveLog = () => {
    window.__IK_LOG_SOLVE__ = false;
    console.info('[IK] 日志已关闭');
  };
  window.enableIkSolveVerboseLog = () => {
    window.__IK_LOG_SOLVE__ = true;
    window.__IK_LOG_SOLVE_VERBOSE__ = true;
    console.info('[IK] 已开启 pipeline/solve 子步日志');
  };
  window.disableIkSolveVerboseLog = () => {
    window.__IK_LOG_SOLVE_VERBOSE__ = false;
    console.info('[IK] 仅保留汇总日志');
  };
}
