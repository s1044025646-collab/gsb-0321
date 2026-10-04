export type Mode = "strict" | "nondecreasing";

export interface StepRecord {
  index: number;          // 原数组下标（0 起）
  value: number;
  pos: number;            // 二分得到的位置
  action: "grow" | "replace";
  prevIndex: number;      // 更新前上一长度的尾部下标，-1 表示无
  tailsAfter: number[];   // 更新后的尾值摘要
  tailsIdxAfter: number[];
}

export interface RunState {
  input: number[];
  mode: Mode;
  processed: number;
  tails: number[];
  tailsIdx: number[];
  prev: number[];         // 每个已处理元素的前驱原下标，-1 表示无
  steps: StepRecord[];
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export function validateInput(input: unknown): number[] {
  if (!Array.isArray(input)) {
    throw new ApiError("INVALID_INPUT", "input 必须是 JSON 数字数组");
  }
  for (const v of input) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new ApiError(
        "INVALID_INPUT",
        "input 只能包含有限 JSON 数字（拒绝字符串、NaN、Infinity、嵌套数组）"
      );
    }
  }
  return input as number[];
}

export function validateMode(mode: unknown): Mode {
  if (mode !== "strict" && mode !== "nondecreasing") {
    throw new ApiError("INVALID_MODE", "mode 必须是 'strict' 或 'nondecreasing'");
  }
  return mode;
}

function lowerBoundGE(tails: number[], x: number): number {
  let lo = 0, hi = tails.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tails[mid] >= x) hi = mid; else lo = mid + 1;
  }
  return lo;
}

function lowerBoundGT(tails: number[], x: number): number {
  let lo = 0, hi = tails.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tails[mid] > x) hi = mid; else lo = mid + 1;
  }
  return lo;
}

export function createState(input: number[], mode: Mode): RunState {
  return { input, mode, processed: 0, tails: [], tailsIdx: [], prev: [], steps: [] };
}

/** 处理一个元素，返回步骤记录 */
export function stepOnce(state: RunState): StepRecord | null {
  const i = state.processed;
  if (i >= state.input.length) return null;
  const x = state.input[i];
  const pos =
    state.mode === "strict"
      ? lowerBoundGE(state.tails, x)
      : lowerBoundGT(state.tails, x);
  // 关键：更新尾值之前记录上一长度的尾部下标作为前驱
  const prevIndex = pos > 0 ? state.tailsIdx[pos - 1] : -1;
  const action: "grow" | "replace" = pos === state.tails.length ? "grow" : "replace";
  state.tails[pos] = x;
  state.tailsIdx[pos] = i;
  state.prev[i] = prevIndex;
  state.processed = i + 1;
  const rec: StepRecord = {
    index: i,
    value: x,
    pos,
    action,
    prevIndex,
    tailsAfter: [...state.tails],
    tailsIdxAfter: [...state.tailsIdx],
  };
  state.steps.push(rec);
  return rec;
}

/** 推进至多 budget 个元素；返回本次处理数 */
export function advance(state: RunState, budget: number): number {
  if (!Number.isInteger(budget) || budget < 0) {
    throw new ApiError("INVALID_BUDGET", "budget 必须是非负整数");
  }
  let n = 0;
  while (n < budget && state.processed < state.input.length) {
    stepOnce(state);
    n++;
  }
  return n;
}

export function isComplete(state: RunState): boolean {
  return state.processed >= state.input.length;
}

/** 从最长尾部反向重建一条最优下标链 */
export function reconstruct(state: RunState): number[] {
  const chain: number[] = [];
  if (state.tailsIdx.length === 0) return chain;
  let cur = state.tailsIdx[state.tailsIdx.length - 1];
  while (cur !== -1) {
    chain.push(cur);
    cur = state.prev[cur];
  }
  return chain.reverse();
}

export function chainValues(state: RunState, chain: number[]): number[] {
  return chain.map((i) => state.input[i]);
}

export function statusOf(state: RunState) {
  return {
    mode: state.mode,
    total: state.input.length,
    processed: state.processed,
    complete: isComplete(state),
    status: isComplete(state) ? "completed" : "paused",
    bestLength: state.tails.length,
  };
}

/** 独立 O(n^2) DP，仅用于测试核对 */
export function dpLength(input: number[], mode: Mode): number {
  const n = input.length;
  if (n === 0) return 0;
  const dp = new Array<number>(n).fill(1);
  let best = 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      const ok = mode === "strict" ? input[j] < input[i] : input[j] <= input[i];
      if (ok && dp[j] + 1 > dp[i]) dp[i] = dp[j] + 1;
    }
    if (dp[i] > best) best = dp[i];
  }
  return best;
}
