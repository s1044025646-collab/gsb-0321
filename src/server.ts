/** HTTP API（node:http，零依赖）。默认端口 0 = 自动选择空闲端口。 */
import * as http from "node:http";
import { LisService } from "./service";
import { ApiError, config } from "./config";

function send(res: http.ServerResponse, status: number, body: unknown) {
  const s = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(s);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError("BAD_REQUEST", "请求体不是合法 JSON");
  }
}

export function createServer(service: LisService = new LisService()) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";

      if (method === "POST" && url.pathname === "/runs") {
        const body = (await readBody(req)) as any;
        send(res, 201, service.create(body.input, body.mode));
        return;
      }
      if (method === "GET" && url.pathname === "/runs") {
        send(res, 200, service.store.listRuns());
        return;
      }
      if (method === "POST" && url.pathname === "/compare") {
        const body = (await readBody(req)) as any;
        send(res, 200, service.compare(body.input));
        return;
      }
      if (parts[0] === "runs" && parts.length >= 2) {
        const id = parts[1];
        const action = parts[2];
        if (method === "GET" && !action) return send(res, 200, service.status(id));
        if (method === "POST" && action === "step") {
          const body = (await readBody(req)) as any;
          return send(res, 200, service.advance(id, body.count ?? 1));
        }
        if (method === "POST" && action === "finish") return send(res, 200, service.finish(id));
        if (method === "GET" && action === "explain") {
          const limit = url.searchParams.get("limit");
          const offset = url.searchParams.get("offset");
          return send(res, 200, service.explain(id, limit ? Number(limit) : undefined, offset ? Number(offset) : 0));
        }
        if (method === "GET" && action === "chain") return send(res, 200, service.chain(id));
        if (method === "GET" && action === "report") return send(res, 200, service.report(id));
      }
      send(res, 404, { error: "NOT_FOUND", message: "未知路由" });
    } catch (e) {
      if (e instanceof ApiError) send(res, e.status, { error: e.code, message: e.message });
      else send(res, 500, { error: "INTERNAL", message: String(e) });
    }
  });
}

if (require.main === module) {
  const portArg = process.argv.indexOf("--port");
  const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : config.port;
  const server = createServer();
  server.listen(port, () => {
    const addr = server.address() as any;
    console.log(`LIS 服务已启动: http://127.0.0.1:${addr.port}`);
  });
}
