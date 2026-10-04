import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RunStore } from "../src/store";
import { LisService } from "../src/service";
import { ApiError, validateInput } from "../src/config";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lis-test-"));
}

const INPUT = [5, 2, 2, 8, 6, 3, 3, 7, 1, 9];

test("一次推进、分批推进、重启续算结果一致", () => {
  // 一次完成
  const d1 = tmpDir();
  const s1 = new LisService(new RunStore(d1));
  const r1 = s1.create(INPUT, "strict");
  s1.finish(r1.id);
  const c1 = s1.chain(r1.id);
  const rep1 = s1.report(r1.id);
  s1.store.close();

  // 分批推进
  const d2 = tmpDir();
  const s2 = new LisService(new RunStore(d2));
  const r2 = s2.create(INPUT, "strict");
  s2.advance(r2.id, 3);
  s2.advance(r2.id, 4);
  s2.finish(r2.id);
  const c2 = s2.chain(r2.id);
  s2.store.close();

  assert.deepEqual(c2.indices, c1.indices);
  assert.equal(c2.length, c1.length);

  // 模拟重启：推进一半后关闭，新建 Store 续算
  const d3 = tmpDir();
  let s3 = new LisService(new RunStore(d3));
  const r3 = s3.create(INPUT, "strict");
  s3.advance(r3.id, 4);
  s3.store.close();
  s3 = new LisService(new RunStore(d3));
  s3.finish(r3.id);
  const c3 = s3.chain(r3.id);
  const rep3 = s3.report(r3.id);
  s3.store.close();

  assert.deepEqual(c3.indices, c1.indices);
  // 步骤数等于输入长度，没有重复追加
  assert.equal(rep3.stepCount, INPUT.length);
  assert.equal(rep1.stepCount, INPUT.length);
  // 步骤序列一致
  const steps1 = JSON.stringify(rep1.chainIndices);
  assert.equal(JSON.stringify(rep3.chainIndices), steps1);
});

test("预算停止标记为 paused 且说明只处理了多少元素", () => {
  const d = tmpDir();
  const s = new LisService(new RunStore(d));
  const r = s.create(INPUT, "strict");
  const res = s.advance(r.id, 3);
  assert.equal(res.status, "paused");
  assert.equal(res.processed, 3);
  assert.match(res.note, /3\/10/);
  const st = s.status(r.id);
  assert.equal(st.prefixBestLength <= 3, true);
  assert.match(st.note, /前缀/);
  s.store.close();
});

test("失败操作不改变进度", () => {
  const d = tmpDir();
  const s = new LisService(new RunStore(d));
  const r = s.create(INPUT, "strict");
  s.advance(r.id, 4);
  assert.throws(() => s.advance(r.id, 0), ApiError);
  assert.throws(() => s.advance(r.id, -2), ApiError);
  assert.throws(() => s.advance(r.id, 1.5), ApiError);
  assert.throws(() => s.advance("no-such-run", 2), ApiError);
  assert.throws(() => s.create(["1", 2], "strict"), ApiError);
  assert.throws(() => s.create([NaN], "strict"), ApiError);
  assert.throws(() => s.create([Infinity], "strict"), ApiError);
  assert.throws(() => s.create([[1]], "strict"), ApiError);
  assert.throws(() => s.create([1], "bogus"), ApiError);
  const st = s.status(r.id);
  assert.equal(st.processed, 4);
  s.store.close();
});

test("完成后拒绝继续推进", () => {
  const d = tmpDir();
  const s = new LisService(new RunStore(d));
  const r = s.create([1, 2], "strict");
  s.finish(r.id);
  assert.throws(() => s.advance(r.id, 1), /已完成/);
  s.store.close();
});

test("两种模式是独立运行", () => {
  const d = tmpDir();
  const s = new LisService(new RunStore(d));
  const a = s.create([2, 2, 2], "strict");
  const b = s.create([2, 2, 2], "nondecreasing");
  s.finish(a.id);
  s.finish(b.id);
  assert.equal(s.chain(a.id).length, 1);
  assert.equal(s.chain(b.id).length, 3);
  s.store.close();
});

test("validateInput 拒绝非法输入", () => {
  assert.throws(() => validateInput("123"), ApiError);
  assert.throws(() => validateInput(["5"]), ApiError);
  assert.throws(() => validateInput([null]), ApiError);
  assert.throws(() => validateInput([[1, 2]]), ApiError);
  assert.deepEqual(validateInput([]), []);
});

test("解释明细限量但前驱与解完整", () => {
  const d = tmpDir();
  const s = new LisService(new RunStore(d));
  const r = s.create(INPUT, "nondecreasing");
  s.finish(r.id);
  const ex = s.explain(r.id, 3);
  assert.equal(ex.returned, 3);
  assert.equal(ex.totalSteps, INPUT.length);
  const rep = s.report(r.id);
  assert.equal(rep.predecessors.length, INPUT.length);
  assert.ok(rep.chainIndices.length > 0);
  s.store.close();
});
