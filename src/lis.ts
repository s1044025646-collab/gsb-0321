/** 核心算法：基于最小尾值数组的 O(n log n) 最长递增子序列（Patience sorting）。 */

export type Mode = "strict" | "nondecreasing";

export interface StepRecord {
  /** 已处理元素的原下标（0 基） */
  index: number;
  value: number;
  /** 二分找到的位置（0 基，即长度-1） */
  pos: number;
  /** grow=追加新长度；replace=替换已有长度的尾值 */
  action: "grow" | "replace";
  /** 更新前 pos-1 长度的尾部原下标，即该元素的前驱；-1 表示无前驱 */
  predecessor: number;
  /** 更新后被替换掉的原尾部下标（replace 时有效） */
  replacedTailIndex: number;
  /** 更新后的尾值摘要 */
  tails: number[];
  /** 更新后的尾部原下标摘要 */
  tailIndices: number[];
}

export class LISProcessor {
  /** tails[len-1] = 长度为 len 的递增子序列的最小尾值 */
  tails: number[] = [];
  /** tailIdx[len-1] = 该尾值对应元素的原下标 */
  tailIdx: number[] = [];
  /** preds[i] = 原下标 i 处元素的前驱原下标，-1 表示无 */
  preds: number[] = [];
  processed = 0;

  constructor(
    private readonly input: number[],
    private readonly mode: Mode,
  ) {}

  /** 二分位置：strict 找第一个 >= x；nondecreasing 找第一个 > x */
  private locate(x: number): number {
    let lo = 0;
    let hi = this.tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const goRight = this.mode === "strict" ? this.tails[mid] < x : this.tails[mid] <= x;
      if (goRight) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  get done(): boolean {
    return this.processed >= this.input.length;
  }

  /** 处理一个元素，返回步骤记录；已全部处理完返回 null */
  step(): StepRecord | null {
    if (this.done) return null;
    const i = this.processed;
    const x = this.input[i];
    const pos = this.locate(x);
    // 关键：更新尾值之前记录当时上一长度的尾部下标作为前驱
    const predecessor = pos > 0 ? this.tailIdx[pos - 1] : -1;
    const action = pos === this.tails.length ? "grow" : "replace";
    const replacedTailIndex = action === "replace" ? this.tailIdx[pos] : -1;
    if (action === "grow") {
      this.tails.push(x);
      this.tailIdx.push(i);
    } else {
      this.tails[pos] = x;
      this.tailIdx[pos] = i;
    }
    this.preds[i] = predecessor;
    this.processed = i + 1;
    return {
      index: i,
      value: x,
      pos,
      action,
      predecessor,
      replacedTailIndex,
      tails: [...this.tails],
      tailIndices: [...this.tailIdx],
    };
  }

  /** 当前前缀的最优长度（注意：只是前缀答案，不是全输入答案） */
  bestLength(): number {
    return this.tails.length;
  }

  /** 从最长尾部沿前驱反向重建一条合法的原下标链 */
  chain(): number[] {
    if (this.tails.length === 0) return [];
    const out: number[] = [];
    let cur = this.tailIdx[this.tailIdx.length - 1];
    while (cur !== -1) {
      out.push(cur);
      cur = this.preds[cur];
    }
    return out.reverse();
  }

  /** 校验链在当前模式下合法且取自原数组 */
  verifyChain(indices: number[]): boolean {
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      if (!Number.isInteger(i) || i < 0 || i >= this.processed) return false;
      if (k > 0) {
        const p = indices[k - 1];
        if (i <= p) return false;
        const ok = this.mode === "strict"
          ? this.input[i] > this.input[p]
          : this.input[i] >= this.input[p];
        if (!ok) return false;
      }
    }
    return indices.length === this.bestLength();
  }
}

/** 独立 O(n^2) DP，用于测试交叉核对长度 */
export function lisLengthDP(input: number[], mode: Mode): number {
  const n = input.length;
  if (n === 0) return 0;
  const dp = new Array<number>(n).fill(1);
  let best = 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      const ok = mode === "strict" ? input[i] > input[j] : input[i] >= input[j];
      if (ok && dp[j] + 1 > dp[i]) dp[i] = dp[j] + 1;
    }
    if (dp[i] > best) best = dp[i];
  }
  return best;
}
