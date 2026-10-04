import { test } from "node:test";
import assert from "node:assert/strict";
import { LISProcessor, lisLengthDP, Mode } from "../src/lis";

function run(input: number[], mode: Mode) {
  const p = new LISProcessor(input, mode);
  while (!p.done) p.step();
  return p;
}

test("空输入返回长度 0 和空链", () => {
  const p = run([], "strict");
  assert.equal(p.bestLength(), 0);
  assert.deepEqual(p.chain(), []);
});

test("全相等：strict=1，nondecreasing=n", () => {
  const a = [5, 5, 5, 5];
  assert.equal(run(a, "strict").bestLength(), 1);
  const p = run(a, "nondecreasing");
  assert.equal(p.bestLength(), 4);
  assert.deepEqual(p.chain(), [0, 1, 2, 3]);
});

test("全降序", () => {
  assert.equal(run([9, 7, 5, 3, 1], "strict").bestLength(), 1);
  assert.equal(run([9, 7, 5, 3, 1], "nondecreasing").bestLength(), 1);
});

test("负数与浮点数", () => {
  const p = run([-3.5, -1.2, -2.8, 0.5, -1.2], "strict");
  assert.equal(p.bestLength(), lisLengthDP([-3.5, -1.2, -2.8, 0.5, -1.2], "strict"));
  assert.ok(p.verifyChain(p.chain()));
});

test("末尾产生更长解", () => {
  const p = run([3, 1, 2, 4], "strict");
  assert.equal(p.bestLength(), 3);
  assert.deepEqual(p.chain().map((i) => [3, 1, 2, 4][i]), [1, 2, 4]);
});

test("尾值摘要不是合法链，前驱重建才是", () => {
  const a = [1, 3, 2, 0];
  const p = run(a, "strict");
  // 尾值下标 [3, 2] 不是递增下标链
  assert.deepEqual(p.tailIdx, [3, 2]);
  assert.deepEqual(p.chain(), [0, 2]);
  assert.ok(p.verifyChain(p.chain()));
});

test("多个最优解时确定性输出一条", () => {
  const a = [2, 1, 4, 3];
  const p1 = run(a, "strict");
  const p2 = run(a, "strict");
  assert.equal(p1.bestLength(), 2);
  assert.deepEqual(p1.chain(), p2.chain());
  assert.ok(p1.verifyChain(p1.chain()));
});

test("随机小数组与 O(n^2) DP 交叉核对，链逐项取自原数组", () => {
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 200; t++) {
    const n = Math.floor(rand() * 12);
    const a = Array.from({ length: n }, () => Math.floor(rand() * 8) - 4);
    for (const mode of ["strict", "nondecreasing"] as Mode[]) {
      const p = run(a, mode);
      assert.equal(p.bestLength(), lisLengthDP(a, mode), `len mismatch ${a} ${mode}`);
      const chain = p.chain();
      assert.ok(p.verifyChain(chain), `chain invalid ${a} ${mode}`);
      for (const i of chain) assert.ok(i >= 0 && i < a.length);
    }
  }
});

test("整体加常数或乘正数保留长度", () => {
  const a = [3, 1, 4, 1, 5, 9, 2, 6];
  for (const mode of ["strict", "nondecreasing"] as Mode[]) {
    const base = lisLengthDP(a, mode);
    assert.equal(lisLengthDP(a.map((x) => x + 100), mode), base);
    assert.equal(lisLengthDP(a.map((x) => x * 7.5), mode), base);
    assert.equal(run(a.map((x) => x + 100), mode).bestLength(), base);
    assert.equal(run(a.map((x) => x * 7.5), mode).bestLength(), base);
  }
});
