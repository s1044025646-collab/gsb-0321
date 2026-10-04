import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "patience-test-"));

import {
  createState, advance, stepOnce, reconstruct, chainValues, dpLength,
  validateInput, validateMode, ApiError, Mode,
} from "../src/core";
import { createRun, advanceRun, getRun, loadSteps } from "../src/db";

function solve(input: number[], mode: Mode) {
  const st = createState(input, mode);
  advance(st, input.length);
  const chain = reconstruct(st);
  return { st, chain, values: chainValues(st, chain) };
}

function checkChain(input: number[], mode: Mode, chain: number[], expectedLen: number) {
  assert.equal(chain.length, expectedLen);
  for (let k = 1; k < chain.length; k++) {
    assert.ok(chain[k] > chain[k - 1], "下标必须严格递增");
    const a = input[chain[k - 1]], b = input[chain[k]];
    assert.ok(mode === "strict" ? a < b : a <= b, "值必须满足模式");
  }
  for (const i of chain) assert.ok(Number.isInteger(i) && i >= 0 && i < input.length);
}

test("空输入", () => {
  const { chain } = solve([], "strict");
  assert.deepEqual(chain, []);
  assert.equal(solve([], "nondecreasing").chain.length, 0);
});

test("全相等：严格=1，非递减=n", () => {
  const a = [5, 5, 5, 5];
  assert.equal(solve(a, "strict").chain.length, 1);
  const nd = solve(a, "nondecreasing");
  assert.equal(nd.chain.length, 4);
  assert.deepEqual(nd.chain, [0, 1, 2, 3]);
});

test("全降序", () => {
  assert.equal(solve([9, 7, 5, 3, 1], "strict").chain.length, 1);
  assert.equal(solve([9, 7, 5, 3, 1], "nondecreasing").chain.length, 1);
});

test("负数与浮点数", () => {
  const a = [-3.5, -10, -3.5, 0.25, -1];
  for (const m of ["strict", "nondecreasing"] as Mode[]) {
    const { chain } = solve(a, m);
    checkChain(a, m, chain, dpLength(a, m));
  }
});

test("末尾产生更长解", () => {
  const a = [5, 6, 7, 1, 2, 3, 4, 8];
  const { chain, values } = solve(a, "strict");
  assert.equal(chain.length, 5);
  assert.deepEqual(values, [1, 2, 3, 4, 8]);
  assert.equal(chain[chain.length - 1], 7);
});

test("多个最优解时输出确定且合法", () => {
  const a = [1, 3, 2, 4];
  const r1 = solve(a, "strict");
  const r2 = solve(a, "strict");
  assert.deepEqual(r1.chain, r2.chain, "平局策略必须确定");
  checkChain(a, "strict", r1.chain, 3);
});

test("尾值数组不是合法解链（较小尾值替换）", () => {
  const a = [10, 20, 5, 30, 8];
  const { st, chain } = solve(a, "strict");
  assert.deepEqual(st.tails, [5, 8, 30]);
  // tailsIdx 对应值 [5,8,30]，但 8 的下标在 30 之后，tailsIdx 不是合法链
  const ti = st.tailsIdx;
  assert.ok(!(ti[0] < ti[1] && ti[1] < ti[2]), "tailsIdx 不应构成合法链");
  checkChain(a, "strict", chain, 3);
  // 确定性平局策略：重建链是 [10,20,30]（下标 0,1,3），与尾值摘要 [5,8,30] 不同
  assert.deepEqual(chainValues(st, chain), [10, 20, 30]);
});

test("随机小数组与 O(n^2) DP 核对", () => {
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 200; t++) {
    const n = Math.floor(rnd() * 12);
    const a = Array.from({ length: n }, () => Math.floor(rnd() * 8) - 4);
    for (const m of ["strict", "nondecreasing"] as Mode[]) {
      const { chain } = solve(a, m);
      checkChain(a, m, chain, dpLength(a, m));
    }
  }
});

test("加常数/乘正数保持长度", () => {
  const a = [3, 1, 4, 1, 5, 9, 2, 6];
  for (const m of ["strict", "nondecreasing"] as Mode[]) {
    const base = dpLength(a, m);
    assert.equal(dpLength(a.map((x) => x + 100), m), base);
    assert.equal(dpLength(a.map((x) => x * 7.5), m), base);
  }
});

test("一次推进、分批推进、重启续算结果一致", () => {
  const a = [4, 2, 9, 3, 7, 1, 8, 8, 0, 5];
  const once = solve(a, "strict");

  const r1 = createRun(a, "strict");
  advanceRun(r1.id, 3);
  advanceRun(r1.id, 4);
  advanceRun(r1.id, 100);
  const s1 = getRun(r1.id).state;
  assert.deepEqual(reconstruct(s1), once.chain);
  assert.deepEqual(s1.tails, once.st.tails);

  // 模拟重启：分批推进中途重新从 DB 加载
  const r2 = createRun(a, "strict");
  advanceRun(r2.id, 2);
  advanceRun(r2.id, 3); // advanceRun 每次从 DB 重新加载，等价于重启续算
  advanceRun(r2.id, 50);
  const s2 = getRun(r2.id).state;
  assert.deepEqual(reconstruct(s2), once.chain);
  assert.deepEqual(s2.prev, once.st.prev);
  // 步骤不重复追加
  assert.equal(loadSteps(r2.id).length, a.length);
  assert.equal(loadSteps(r1.id).length, a.length);
});

test("失败操作不改变进度", () => {
  const a = [2, 1, 3];
  const r = createRun(a, "strict");
  advanceRun(r.id, 2);
  assert.throws(() => advanceRun(r.id, 0), ApiError);
  assert.throws(() => advanceRun(r.id, -5), ApiError);
  assert.throws(() => advanceRun(r.id, 1.5), ApiError);
  const st = getRun(r.id).state;
  assert.equal(st.processed, 2);
  assert.equal(loadSteps(r.id).length, 2);
});

test("输入与模式校验", () => {
  assert.throws(() => validateInput("[1,2]"), /数组/);
  assert.throws(() => validateInput(["3"]), /有限/);
  assert.throws(() => validateInput([NaN]), /有限/);
  assert.throws(() => validateInput([Infinity]), /有限/);
  assert.throws(() => validateInput([[1, 2]]), /有限/);
  assert.throws(() => validateInput([null]), /有限/);
  assert.throws(() => validateMode("asc"), /mode/);
  assert.equal(validateMode("strict"), "strict");
});

test("预算暂停标记", () => {
  const r = createRun([1, 2, 3, 4, 5], "strict");
  const { state, processedNow } = advanceRun(r.id, 2);
  assert.equal(processedNow, 2);
  assert.equal(state.processed, 2);
  assert.ok(state.processed < state.input.length, "应处于暂停状态");
});

test("步骤记录包含二分位置/动作/前驱/尾部摘要", () => {
  const st = createState([10, 20, 5], "strict");
  stepOnce(st); stepOnce(st);
  const s = stepOnce(st)!;
  assert.equal(s.pos, 0);
  assert.equal(s.action, "replace");
  assert.equal(s.prevIndex, -1);
  assert.deepEqual(s.tailsAfter, [5, 20]);
});
