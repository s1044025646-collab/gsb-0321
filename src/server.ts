import * as http from "node:http";
import {
  validateInput, validateMode, statusOf, reconstruct, chainValues, ApiError,
} from "./core";
import { createRun, getRun, advanceRun, loadSteps, getStep } from "./db";

const MAX_DETAIL = Number(process.env.MAX_DETAIL ?? 100);
const DEFAULT_BUDGET = Number(process.env.STEP_BUDGET ?? 1000);
const MAX_INPUT_LEN = Number(process.env.MAX_INPUT_LEN ?? 1_000_000);

function send(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 64 * 1024 * 1024) reject(new ApiError("PAYLOAD_TOO_LARGE", "请求体过大", 413));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch { reject(new ApiError("INVALID_JSON", "请求体不是合法 JSON")); }
    });
    req.on("error", reject);
  });
}

function parseId(seg: string | undefined): number {
  const id = Number(seg);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError("INVALID_ID", "运行 id 必须是正整数");
  return id;
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const body = req.method === "POST" ? await readBody(req) : {};

      // POST /runs {input, mode}
      if (req.method === "POST" && parts[0] === "runs" && parts.length === 1) {
        const input = validateInput(body.input);
        if (input.length > MAX_INPUT_LEN) {
          throw new ApiError("INPUT_TOO_LONG", `输入长度超过上限 ${MAX_INPUT_LEN}`);
        }
        const mode = validateMode(body.mode);
        const { id, state } = createRun(input, mode);
        return send(res, 201, { id, ...statusOf(state) });
      }

      if (parts[0] === "runs" && parts.length >= 2) {
        const id = parseId(parts[1]);
        const action = parts[2];

        // POST /runs/:id/run — 一次完成
        if (req.method === "POST" && action === "run") {
          const { state, processedNow } = advanceRun(id, 1 << 30);
          return send(res, 200, { id, processedNow, ...statusOf(state) });
        }

        // POST /runs/:id/advance {budget?}
        if (req.method === "POST" && action === "advance") {
          const budget = body.budget ?? DEFAULT_BUDGET;
          const { state, processedNow } = advanceRun(id, budget);
          const out: any = { id, processedNow, ...statusOf(state) };
          if (!out.complete) {
            out.note = `已暂停：仅处理了 ${state.processed}/${state.input.length} 个元素，当前为前缀最优，不是全输入答案`;
          }
          return send(res, 200, out);
        }

        // GET /runs/:id/status — 前缀最优长度
        if (req.method === "GET" && action === "status") {
          const { state } = getRun(id);
          return send(res, 200, { id, ...statusOf(state) });
        }

        // GET /runs/:id/steps?limit=&offset= 或 /runs/:id/steps/:seq
        if (req.method === "GET" && action === "steps") {
          if (parts[3] !== undefined) {
            const seq = Number(parts[3]);
            if (!Number.isInteger(seq) || seq < 0) throw new ApiError("INVALID_STEP", "步骤序号非法");
            return send(res, 200, { id, step: getStep(id, seq) });
          }
          const limit = Math.min(Number(url.searchParams.get("limit") ?? MAX_DETAIL), MAX_DETAIL);
          const offset = Number(url.searchParams.get("offset") ?? 0);
          return send(res, 200, { id, steps: loadSteps(id, limit, offset), limit });
        }

        // GET /runs/:id/chain — 重建当前链
        if (req.method === "GET" && action === "chain") {
          const { state } = getRun(id);
          const chain = reconstruct(state);
          return send(res, 200, {
            id,
            ...statusOf(state),
            chain,
            values: chainValues(state, chain),
          });
        }

        // GET /runs/:id/report
        if (req.method === "GET" && action === "report") {
          const { state } = getRun(id);
          const chain = reconstruct(state);
          return send(res, 200, {
            id,
            input: state.input,
            ...statusOf(state),
            chain,
            values: chainValues(state, chain),
            steps: loadSteps(id),
          });
        }
      }

      throw new ApiError("NOT_FOUND", "路由不存在", 404);
    } catch (e: any) {
      if (e instanceof ApiError) {
        send(res, e.status, { error: { code: e.code, message: e.message } });
      } else {
        send(res, 500, { error: { code: "INTERNAL", message: String(e?.message ?? e) } });
      }
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 0); // 默认选择空闲端口
  const srv = createServer().listen(port, () => {
    const addr = srv.address() as any;
    console.log(`patience-lis 服务已启动: http://127.0.0.1:${addr.port}`);
  });
}
