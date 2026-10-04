import {
  validateInput, validateMode, createState, advance, reconstruct,
  chainValues, statusOf, Mode,
} from "./core";
import { createRun, advanceRun, getRun, loadSteps } from "./db";
import { reconstruct as rc } from "./core";

function parseArray(s: string): number[] {
  let v: unknown;
  try { v = JSON.parse(s); } catch { throw new Error("数组参数必须是合法 JSON，如 '[3,1,2]'"); }
  return validateInput(v);
}

function table(rows: string[][]): string {
  const w = rows[0].map((_, c) => Math.max(...rows.map((r) => displayWidth(r[c]))));
  return rows
    .map((r) => r.map((cell, c) => pad(cell, w[c])).join("  |  "))
    .join("\n");
}
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 255 ? 2 : 1;
  return w;
}
function pad(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - displayWidth(s)));
}

function analyze(input: number[], mode: Mode) {
  const st = createState(input, mode);
  advance(st, input.length);
  const chain = reconstruct(st);
  return { st, chain, values: chainValues(st, chain) };
}

function cmdCompare(arr: string) {
  const input = parseArray(arr);
  const s = analyze(input, "strict");
  const n = analyze(input, "nondecreasing");
  const rows = [
    ["模式", "最优长度", "下标链(0起)", "值链"],
    ["strict 严格递增", String(s.chain.length), `[${s.chain.join(", ")}]`, `[${s.values.join(", ")}]`],
    ["nondecreasing 非递减", String(n.chain.length), `[${n.chain.join(", ")}]`, `[${n.values.join(", ")}]`],
  ];
  console.log(`输入: [${input.join(", ")}]`);
  console.log(table(rows));
  console.log("\n尾值摘要对比（说明：尾值数组不是合法解链）:");
  console.log(`  strict        tails = [${s.st.tails.join(", ")}]  tailsIdx = [${s.st.tailsIdx.join(", ")}]`);
  console.log(`  nondecreasing tails = [${n.st.tails.join(", ")}]  tailsIdx = [${n.st.tailsIdx.join(", ")}]`);
}

function cmdSteps(arr: string, mode: Mode) {
  const input = parseArray(arr);
  const st = createState(input, mode);
  advance(st, input.length);
  const rows = [["下标", "值", "二分位置", "动作", "前驱", "更新后尾值"]];
  for (const s of st.steps) {
    rows.push([
      String(s.index), String(s.value), String(s.pos),
      s.action === "grow" ? "增长" : "替换",
      s.prevIndex === -1 ? "-" : String(s.prevIndex),
      `[${s.tailsAfter.join(", ")}]`,
    ]);
  }
  console.log(`模式: ${mode}`);
  console.log(table(rows));
  const chain = reconstruct(st);
  console.log(`\n重建链: [${chain.join(", ")}]  值: [${chainValues(st, chain).join(", ")}]  长度: ${chain.length}`);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "compare":
      cmdCompare(args[0]);
      break;
    case "steps":
      cmdSteps(args[0], validateMode(args[1] ?? "strict"));
      break;
    case "create": {
      const input = parseArray(args[0]);
      const mode = validateMode(args[1]);
      const { id, state } = createRun(input, mode);
      console.log(JSON.stringify({ id, ...statusOf(state) }));
      break;
    }
    case "advance": {
      const { state, processedNow } = advanceRun(Number(args[0]), Number(args[1] ?? 1));
      console.log(JSON.stringify({ processedNow, ...statusOf(state) }));
      break;
    }
    case "chain": {
      const { state } = getRun(Number(args[0]));
      const chain = rc(state);
      console.log(JSON.stringify({ ...statusOf(state), chain, values: chainValues(state, chain) }));
      break;
    }
    case "report": {
      const { state } = getRun(Number(args[0]));
      const chain = rc(state);
      console.log(JSON.stringify({
        input: state.input, ...statusOf(state),
        chain, values: chainValues(state, chain),
        steps: loadSteps(Number(args[0])),
      }, null, 2));
      break;
    }
    case "demo": {
      console.log("== 示例1：尾值摘要 ≠ 重建链（较小尾值替换）==");
      cmdCompare("[10, 20, 5, 30, 8]");
      console.log("\n== 示例2：多个相等元素，严格 vs 非递减 ==");
      cmdCompare("[2, 2, 2, 3, 3, 1]");
      break;
    }
    default:
      console.log(`用法:
  node dist/cli.js compare '<json数组>'        两种模式对比表
  node dist/cli.js steps '<json数组>' [mode]  逐步解释
  node dist/cli.js create '<json数组>' <mode> 创建持久化运行
  node dist/cli.js advance <id> [budget]     按预算推进
  node dist/cli.js chain <id>                重建当前链
  node dist/cli.js report <id>               导出报告
  node dist/cli.js demo                      运行演示`);
  }
}

main().catch((e) => {
  console.error(`错误: ${e.code ?? ""} ${e.message}`);
  process.exit(1);
});
