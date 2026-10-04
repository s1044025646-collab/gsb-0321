/** 服务层：组合校验、持久化与算法，供 API 与 CLI 共用 */
import { RunStore } from "./store";
import { ApiError, config, validateInput, validateMode } from "./config";
import { LISProcessor, Mode } from "./lis";

export class LisService {
  constructor(public readonly store: RunStore = new RunStore()) {}

  create(rawInput: unknown, rawMode: unknown) {
    const input = validateInput(rawInput);
    const mode = validateMode(rawMode);
    return this.store.createRun(input, mode);
  }

  private budget(raw: unknown): number {
    const n = typeof raw === "string" ? Number(raw) : raw;
    if (!Number.isInteger(n) || (n as number) <= 0) {
      throw new ApiError("INVALID_BUDGET", "推进预算必须是正整数");
    }
    if ((n as number) > config.maxStepBatch) {
      throw new ApiError("BATCH_TOO_LARGE", `单次推进 ${n} 超过上限 ${config.maxStepBatch}`);
    }
    return n as number;
  }

  advance(id: string, rawBudget: unknown) {
    const b = this.budget(rawBudget);
    const r = this.store.advance(id, b);
    const run = this.store.getRun(id);
    return {
      id,
      requested: b,
      advanced: r.steps.length,
      processed: r.processed,
      total: run.input.length,
      status: r.status,
      prefixBestLength: this.store.loadProcessor(id).bestLength(),
      note: r.status === "paused"
        ? `已暂停：只处理了 ${r.processed}/${run.input.length} 个元素，当前为前缀答案，不是全输入答案`
        : "已完成",
    };
  }

  finish(id: string) {
    const run = this.store.getRun(id);
    const remaining = run.input.length - run.processed;
    if (run.status === "done") return { id, processed: run.processed, total: run.input.length, status: "done", advanced: 0 };
    if (remaining > config.maxStepBatch) {
      // 分批原子提交直至完成
      let left = remaining;
      while (left > 0) {
        const b = Math.min(left, config.maxStepBatch);
        this.store.advance(id, b);
        left -= b;
      }
      return { id, processed: run.input.length, total: run.input.length, status: "done", advanced: remaining };
    }
    const r = this.store.advance(id, remaining);
    return { id, processed: r.processed, total: run.input.length, status: r.status, advanced: r.steps.length };
  }

  status(id: string) {
    const run = this.store.getRun(id);
    const p = this.store.loadProcessor(id);
    return {
      id: run.id,
      mode: run.mode,
      processed: run.processed,
      total: run.input.length,
      status: run.status,
      prefixBestLength: p.bestLength(),
      tails: p.tails,
      tailIndices: p.tailIdx,
      note: run.status === "paused" ? "前缀最优长度，非全输入答案" : "全输入最优长度",
    };
  }

  explain(id: string, limit?: number, offset = 0) {
    const lim = Math.min(limit ?? config.explainLimit, config.explainLimit);
    const r = this.store.getSteps(id, lim, offset);
    return { id, returned: r.steps.length, totalSteps: r.total, steps: r.steps };
  }

  chain(id: string) {
    const run = this.store.getRun(id);
    const p = this.store.loadProcessor(id);
    const indices = p.chain();
    return {
      id,
      status: run.status,
      processed: run.processed,
      total: run.input.length,
      length: indices.length,
      indices,
      values: indices.map((i) => run.input[i]),
      valid: p.verifyChain(indices),
      note: run.status === "paused" ? "当前链仅为已处理前缀的最优解" : "全输入最优解",
    };
  }

  report(id: string) {
    const run = this.store.getRun(id);
    const p = this.store.loadProcessor(id);
    const indices = p.chain();
    return {
      id: run.id,
      createdAt: run.createdAt,
      mode: run.mode,
      input: run.input,
      processed: run.processed,
      total: run.input.length,
      status: run.status,
      bestLength: p.bestLength(),
      chainIndices: indices,
      chainValues: indices.map((i) => run.input[i]),
      tails: p.tails,
      tailIndices: p.tailIdx,
      predecessors: p.preds.slice(0, run.processed).map((v, i) => ({ index: i, predecessor: v })),
      stepCount: this.store.stepCount(id),
    };
  }

  /** 对照：同一数组两种模式（独立运行，互不影响） */
  compare(rawInput: unknown) {
    const input = validateInput(rawInput);
    const out: Record<string, { length: number; indices: number[]; values: number[] }> = {};
    for (const mode of ["strict", "nondecreasing"] as Mode[]) {
      const p = new LISProcessor(input, mode);
      while (!p.done) p.step();
      const indices = p.chain();
      out[mode] = { length: indices.length, indices, values: indices.map((i) => input[i]) };
    }
    return out;
  }
}
