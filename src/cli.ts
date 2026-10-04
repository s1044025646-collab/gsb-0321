/** CLI：创建/推进/完成/状态/解释/链/报告/对照/演示 */
import { LisService } from "./service";
import { LISProcessor, Mode } from "./lis";
import * as fs from "node:fs";

const service = new LisService();

function parseArrayArg(s: string): unknown {
  const v = fs.existsSync(s) ? JSON.parse(fs.readFileSync(s, "utf8")) : JSON.parse(s);
  return v;
}

function table(rows: string[][]): string {
  const w = rows[0].map((_, c) => Math.max(...rows.map((r) => displayWidth(r[c]))));
  return rows
    .map((r) => r.map((cell, c) => pad(cell, w[c])).join("  |  "))
    .join("\n");
}
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += ch.codePointAt(0)! > 0xff ? 2 : 1;
  return w;
}
function pad(s: string, w: number): string {
  return s + " ".repeat(w - displayWidth(s));
}

function showCompare(input: number[]) {
  const r = service.compare(input);
  const rows: string[][] = [["模式", "最优长度", "原下标链", "值链"]];
  for (const m of ["strict", "nondecreasing"]) {
    const v = (r as any)[m];
    rows.push([m, String(v.length), `[${v.indices.join(", ")}]`, `[${v.values.join(", ")}]`]);
  }
  console.log(table(rows));
}

function demo() {
  console.log("== 演示 1：较小尾值替换 —— 尾值摘要 ≠ 最终重建链 ==");
  const a = [1, 3, 2, 0];
  const p = new LISProcessor(a, "strict");
  while (!p.done) {
    const s = p.step()!;
    console.log(`处理 a[${s.index}]=${s.value}: pos=${s.pos} ${s.action} 前驱=${s.predecessor} 尾值=[${s.tails}] 尾部下标=[${s.tailIndices}]`);
  }
  console.log(`尾值摘要尾部下标: [${p.tailIdx}] （不是一条合法链：下标 3 -> 2 不递增）`);
  console.log(`前驱重建链: [${p.chain()}] 值=[${p.chain().map((i) => a[i])}]`);
  console.log();
  console.log("== 演示 2：多个相等元素 —— strict 与 nondecreasing 的区别 ==");
  const b = [2, 2, 2, 3];
  showCompare(b);
  console.log("strict 用第一个 >= x 的位置，相等元素互相覆盖，长度不增；");
  console.log("nondecreasing 用第一个 > x 的位置，相等元素可接续，长度增长。");
  console.log();
  console.log("== 演示 3：同一数组两种模式对照 ==");
  showCompare([5, 2, 2, 8, 6, 3, 3, 7]);
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "create": {
      const input = parseArrayArg(args[0]);
      const mode = args[1] ?? "strict";
      console.log(JSON.stringify(service.create(input, mode), null, 2));
      break;
    }
    case "step":
      console.log(JSON.stringify(service.advance(args[0], Number(args[1] ?? 1)), null, 2));
      break;
    case "finish":
      console.log(JSON.stringify(service.finish(args[0]), null, 2));
      break;
    case "status":
      console.log(JSON.stringify(service.status(args[0]), null, 2));
      break;
    case "explain":
      console.log(JSON.stringify(service.explain(args[0], args[1] ? Number(args[1]) : undefined), null, 2));
      break;
    case "chain":
      console.log(JSON.stringify(service.chain(args[0]), null, 2));
      break;
    case "report":
      console.log(JSON.stringify(service.report(args[0]), null, 2));
      break;
    case "list":
      console.log(JSON.stringify(service.store.listRuns(), null, 2));
      break;
    case "compare":
      showCompare(parseArrayArg(args[0]) as number[]);
      break;
    case "demo":
      demo();
      break;
    default:
      console.log(`用法: node dist/src/cli.js <命令>
  create <json数组|文件> [strict|nondecreasing]   创建运行
  step <id> [n]        按预算推进 n 个元素
  finish <id>          一次完成
  status <id>          查看前缀最优长度与尾值摘要
  explain <id> [limit] 解释步骤明细
  chain <id>           重建当前链（原下标证据）
  report <id>          导出完整报告
  list                 列出全部运行
  compare <json数组>   两种模式对照表
  demo                 演示`);
  }
}

main();
