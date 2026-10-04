import { DatabaseSync } from "node:sqlite";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  RunState, Mode, StepRecord, createState, stepOnce,
  ApiError,
} from "./core";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "patience.db"));

db.exec(`
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  input TEXT NOT NULL,
  mode TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0,
  tails TEXT NOT NULL DEFAULT '[]',
  tails_idx TEXT NOT NULL DEFAULT '[]',
  prev TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS steps (
  run_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  record TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);
`);

export interface RunRow { id: number; state: RunState }

function rowToState(row: any): RunState {
  const input = JSON.parse(row.input) as number[];
  const state = createState(input, row.mode as Mode);
  state.processed = row.processed;
  state.tails = JSON.parse(row.tails);
  state.tailsIdx = JSON.parse(row.tails_idx);
  state.prev = JSON.parse(row.prev);
  return state;
}

export function createRun(input: number[], mode: Mode): RunRow {
  const r = db
    .prepare("INSERT INTO runs (input, mode) VALUES (?, ?)")
    .run(JSON.stringify(input), mode);
  return getRun(Number(r.lastInsertRowid));
}

export function getRun(id: number): RunRow {
  const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(id);
  if (!row) throw new ApiError("NOT_FOUND", `运行 ${id} 不存在`, 404);
  return { id, state: rowToState(row) };
}

export function loadSteps(id: number, limit?: number, offset = 0): StepRecord[] {
  const rows = db
    .prepare("SELECT record FROM steps WHERE run_id = ? ORDER BY seq LIMIT ? OFFSET ?")
    .all(id, limit ?? 1 << 30, offset) as any[];
  return rows.map((r) => JSON.parse(r.record));
}

export function getStep(id: number, seq: number): StepRecord {
  const row = db
    .prepare("SELECT record FROM steps WHERE run_id = ? AND seq = ?")
    .get(id, seq) as any;
  if (!row) throw new ApiError("NOT_FOUND", `运行 ${id} 的第 ${seq} 步不存在`, 404);
  return JSON.parse(row.record);
}

/** 原子批量推进：状态与步骤在同一事务提交 */
export function advanceRun(id: number, budget: number): { state: RunState; processedNow: number } {
  if (!Number.isInteger(budget) || budget <= 0) {
    throw new ApiError("INVALID_BUDGET", "budget 必须是正整数");
  }
  const { state } = getRun(id);
  const newSteps: StepRecord[] = [];
  let n = 0;
  while (n < budget && state.processed < state.input.length) {
    newSteps.push(stepOnce(state)!);
    n++;
  }
  db.exec("BEGIN");
  try {
    db.prepare(
      "UPDATE runs SET processed = ?, tails = ?, tails_idx = ?, prev = ? WHERE id = ?"
    ).run(
      state.processed,
      JSON.stringify(state.tails),
      JSON.stringify(state.tailsIdx),
      JSON.stringify(state.prev),
      id
    );
    const ins = db.prepare("INSERT INTO steps (run_id, seq, record) VALUES (?, ?, ?)");
    for (const s of newSteps) {
      ins.run(id, s.index, JSON.stringify(s));
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { state, processedNow: n };
}

export function listRuns() {
  return db
    .prepare("SELECT id, mode, processed, length(input) AS _l, created_at FROM runs ORDER BY id")
    .all();
}
