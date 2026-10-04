/** SQLite 持久化：冻结输入与模式，保存进度、尾值、前驱与步骤摘要；批量推进原子提交。 */
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { LISProcessor, Mode, StepRecord } from "./lis";
import { ApiError, config } from "./config";

export interface RunRow {
  id: string;
  input: number[];
  mode: Mode;
  processed: number;
  status: "paused" | "done";
  createdAt: string;
}

export class RunStore {
  private db: DatabaseSync;

  constructor(dataDir: string = config.dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, "lis.db"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        input TEXT NOT NULL,
        mode TEXT NOT NULL,
        processed INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        tails TEXT NOT NULL,
        tail_indices TEXT NOT NULL,
        preds TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS steps (
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (run_id, seq)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  createRun(input: number[], mode: Mode): RunRow {
    const id = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const row: RunRow = {
      id,
      input,
      mode,
      processed: 0,
      status: "paused",
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        "INSERT INTO runs (id, input, mode, processed, status, created_at, tails, tail_indices, preds) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(id, JSON.stringify(input), mode, 0, "paused", row.createdAt, "[]", "[]", "[]");
    return row;
  }

  getRun(id: string): RunRow {
    const r = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as any;
    if (!r) throw new ApiError("RUN_NOT_FOUND", `运行 ${id} 不存在`, 404);
    return {
      id: r.id,
      input: JSON.parse(r.input),
      mode: r.mode,
      processed: r.processed,
      status: r.status,
      createdAt: r.created_at,
    };
  }

  listRuns(): RunRow[] {
    const rows = this.db.prepare("SELECT * FROM runs ORDER BY created_at").all() as any[];
    return rows.map((r) => ({
      id: r.id,
      input: JSON.parse(r.input),
      mode: r.mode,
      processed: r.processed,
      status: r.status,
      createdAt: r.created_at,
    }));
  }

  /** 从已有状态恢复处理器（不重新计算、不重复追加步骤） */
  loadProcessor(id: string): LISProcessor {
    const r = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as any;
    if (!r) throw new ApiError("RUN_NOT_FOUND", `运行 ${id} 不存在`, 404);
    const input = JSON.parse(r.input) as number[];
    const p = new LISProcessor(input, r.mode as Mode);
    p.tails = JSON.parse(r.tails);
    p.tailIdx = JSON.parse(r.tail_indices);
    p.preds = JSON.parse(r.preds);
    p.processed = r.processed;
    return p;
  }

  /** 原子批量推进：步骤与状态在同一事务提交 */
  advance(id: string, budget: number): { steps: StepRecord[]; processed: number; status: string } {
    const run = this.getRun(id);
    if (run.status === "done") {
      throw new ApiError("RUN_FINISHED", "运行已完成，不能继续推进");
    }
    const p = this.loadProcessor(id);
    const steps: StepRecord[] = [];
    this.db.exec("BEGIN");
    try {
      const ins = this.db.prepare("INSERT INTO steps (run_id, seq, json) VALUES (?,?,?)");
      for (let k = 0; k < budget && !p.done; k++) {
        const s = p.step()!;
        steps.push(s);
        ins.run(id, s.index, JSON.stringify(s));
      }
      const status = p.done ? "done" : "paused";
      this.db
        .prepare("UPDATE runs SET processed=?, status=?, tails=?, tail_indices=?, preds=? WHERE id=?")
        .run(p.processed, status, JSON.stringify(p.tails), JSON.stringify(p.tailIdx), JSON.stringify(p.preds), id);
      this.db.exec("COMMIT");
      return { steps, processed: p.processed, status };
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  getSteps(id: string, limit: number, offset: number): { total: number; steps: StepRecord[] } {
    this.getRun(id);
    const total = (this.db.prepare("SELECT COUNT(*) AS c FROM steps WHERE run_id=?").get(id) as any).c as number;
    const rows = this.db
      .prepare("SELECT json FROM steps WHERE run_id=? ORDER BY seq LIMIT ? OFFSET ?")
      .all(id, limit, offset) as any[];
    return { total, steps: rows.map((r) => JSON.parse(r.json)) };
  }

  stepCount(id: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS c FROM steps WHERE run_id=?").get(id) as any).c as number;
  }
}
