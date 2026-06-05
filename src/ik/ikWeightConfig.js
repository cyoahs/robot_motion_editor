/**
 * closed-chain-ik Solver：translationFactor / rotationFactor 为误差向量权重，
 * 库文档要求取值范围 [0, 1]，用于平衡平移与旋转优先级（不是“加速系数”）。
 */

/** 面板/配置允许的 maxIterations 上限（closed-chain-ik 本身无硬顶） */
export const IK_MAX_ITERATIONS_LIMIT = 1e9;

/** 拖拽过程中每帧 IK 迭代上限 */
export const IK_DRAG_LIVE_ITER_CAP = 128;

export function capIterationsForLiveDrag(opts, dragging) {
  if (!dragging || !opts) return opts;
  const iter = opts.maxIterations ?? IK_WEIGHT_DEFAULTS.position.maxIterations;
  return {
    ...opts,
    maxIterations: Math.min(iter, IK_DRAG_LIVE_ITER_CAP)
  };
}

export const IK_WEIGHT_DEFAULTS = Object.freeze({
  position: Object.freeze({
    translationFactor: 1,
    rotationFactor: 0.012,
    maxIterations: 32,
    /** DLS 阻尼，越大越稳、越慢 */
    dampingFactor: 0.012,
    /** 单步位置误差向量上限（米），越小越不易冲过限位 */
    translationErrorClamp: 0.02,
    /** 误差增幅超过该比例时提前停止本轮迭代 */
    divergeThreshold: 0.02,
    /** 判定收敛的位置误差（米） */
    convergedPositionTolerance: 0.004
  }),
  orientation: Object.freeze({
    /** @deprecated 仅用于旧工程 JSON 兼容，求解不再读取 */
    rotationFactor: 1,
    maxIterations: 32,
    solvePasses: 1
  })
});

export const IK_WEIGHT_LIMITS = Object.freeze({
  translationFactor: { min: 0, max: 1, step: 0.001 },
  rotationFactor: { min: 0, max: 1, step: 0.001 },
  maxIterations: { min: 1, max: IK_MAX_ITERATIONS_LIMIT, step: 1 },
  solvePasses: { min: 1, max: 16, step: 1 },
  dampingFactor: { min: 0.0001, max: 0.2, step: 0.001 },
  translationErrorClamp: { min: 0.001, max: 0.2, step: 0.001 },
  divergeThreshold: { min: 0.001, max: 0.5, step: 0.001 },
  convergedPositionTolerance: { min: 0.0005, max: 0.05, step: 0.0005 }
});

export function cloneIkWeights(source = IK_WEIGHT_DEFAULTS) {
  return {
    position: { ...IK_WEIGHT_DEFAULTS.position, ...source?.position },
    orientation: { ...IK_WEIGHT_DEFAULTS.orientation, ...source?.orientation }
  };
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function sanitizeWeightSet(set, defaults) {
  const lim = IK_WEIGHT_LIMITS;
  const out = {
    rotationFactor: clampNum(
      set?.rotationFactor,
      lim.rotationFactor.min,
      lim.rotationFactor.max,
      defaults.rotationFactor
    ),
    maxIterations: Math.round(
      clampNum(
        set?.maxIterations,
        lim.maxIterations.min,
        lim.maxIterations.max,
        defaults.maxIterations
      )
    )
  };
  if (defaults.translationFactor != null) {
    out.translationFactor = clampNum(
      set?.translationFactor,
      lim.translationFactor.min,
      lim.translationFactor.max,
      defaults.translationFactor
    );
  }
  if (defaults.dampingFactor != null) {
    out.dampingFactor = clampNum(
      set?.dampingFactor,
      lim.dampingFactor.min,
      lim.dampingFactor.max,
      defaults.dampingFactor
    );
  }
  if (defaults.translationErrorClamp != null) {
    out.translationErrorClamp = clampNum(
      set?.translationErrorClamp,
      lim.translationErrorClamp.min,
      lim.translationErrorClamp.max,
      defaults.translationErrorClamp
    );
  }
  if (defaults.divergeThreshold != null) {
    out.divergeThreshold = clampNum(
      set?.divergeThreshold,
      lim.divergeThreshold.min,
      lim.divergeThreshold.max,
      defaults.divergeThreshold
    );
  }
  if (defaults.convergedPositionTolerance != null) {
    out.convergedPositionTolerance = clampNum(
      set?.convergedPositionTolerance,
      lim.convergedPositionTolerance.min,
      lim.convergedPositionTolerance.max,
      defaults.convergedPositionTolerance
    );
  }
  if (defaults.solvePasses != null) {
    out.solvePasses = Math.round(
      clampNum(
        set?.solvePasses,
        lim.solvePasses.min,
        lim.solvePasses.max,
        defaults.solvePasses
      )
    );
  }
  return out;
}

export function sanitizeIkWeights(weights) {
  return {
    position: sanitizeWeightSet(weights?.position, IK_WEIGHT_DEFAULTS.position),
    orientation: sanitizeWeightSet(weights?.orientation, IK_WEIGHT_DEFAULTS.orientation)
  };
}

/** 拖拽结束：单次求解，仅提高 maxIterations（位置/姿态共用 position 组权重） */
export function getDragEndSolveOptions(mode, weights) {
  const w = weights.position;
  const base = { ...w };
  if (mode === 'orientation') {
    base.orientationSoft = true;
  }
  return {
    ...base,
    maxIterations: Math.min(
      IK_MAX_ITERATIONS_LIMIT,
      Math.round((w.maxIterations ?? 32) * 1.35)
    )
  };
}

/** @deprecated 姿态与位置共用 position 组权重，保留导出以免外部引用报错 */
export function getOrientationSolveOptions(weights, opts = {}) {
  const p = weights.position;
  return {
    ...p,
    orientationSoft: true,
    ...(opts.dragging ? capIterationsForLiveDrag({ ...p }, true) : {})
  };
}

/** 条形图宽度：translation 与 rotation 在 [0,1] 内分别归一化 */
export function weightBarPercent(value, key) {
  const lim = IK_WEIGHT_LIMITS[key];
  if (!lim) return 0;
  const t = (Number(value) - lim.min) / (lim.max - lim.min);
  return Math.round(Math.min(100, Math.max(0, t * 100)));
}

export function formatWeightRatio(translationFactor, rotationFactor) {
  const t = Number(translationFactor) || 0;
  const r = Number(rotationFactor) || 0;
  const sum = t + r || 1;
  return {
    transPct: Math.round((t / sum) * 100),
    rotPct: Math.round((r / sum) * 100)
  };
}

function readNum(id, fallback) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const n = parseFloat(el.value);
  return Number.isFinite(n) ? n : fallback;
}

/** 从 IK 面板 DOM 读取当前权重（已 clamp 到合法范围） */
export function readIkWeightsFromDom(stored = null) {
  const base = sanitizeIkWeights(stored || IK_WEIGHT_DEFAULTS);
  const p = base.position;

  return sanitizeIkWeights({
    position: {
      translationFactor: readNum('ik-w-pos-trans', p.translationFactor),
      rotationFactor: readNum('ik-w-pos-rot', p.rotationFactor),
      maxIterations: readNum('ik-w-pos-iter', p.maxIterations),
      dampingFactor: readNum('ik-w-pos-damp', p.dampingFactor),
      translationErrorClamp: readNum('ik-w-pos-clamp', p.translationErrorClamp),
      divergeThreshold: readNum('ik-w-pos-diverge', p.divergeThreshold),
      convergedPositionTolerance: readNum('ik-w-pos-tol', p.convergedPositionTolerance)
    }
  });
}

/** 更新 T/R 滑条旁数值显示 */
export function refreshIkWeightDisplays(weights) {
  const w = sanitizeIkWeights(weights).position;
  const transEl = document.getElementById('ik-w-pos-trans-val');
  const rotEl = document.getElementById('ik-w-pos-rot-val');
  if (transEl) transEl.textContent = w.translationFactor.toFixed(3);
  if (rotEl) rotEl.textContent = w.rotationFactor.toFixed(3);
}

/** 将权重写入面板 DOM（用于工程恢复） */
export function writeIkWeightsToDom(weights) {
  const w = sanitizeIkWeights(weights);
  const map = {
    'ik-w-pos-trans': w.position.translationFactor,
    'ik-w-pos-rot': w.position.rotationFactor,
    'ik-w-pos-iter': w.position.maxIterations,
    'ik-w-pos-damp': w.position.dampingFactor,
    'ik-w-pos-clamp': w.position.translationErrorClamp,
    'ik-w-pos-diverge': w.position.divergeThreshold,
    'ik-w-pos-tol': w.position.convergedPositionTolerance
  };
  for (const [id, val] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.value = String(val);
  }
  refreshIkWeightDisplays(w);
}
