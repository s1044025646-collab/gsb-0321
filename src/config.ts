/** 配置：可用环境变量覆盖 */
export const config = {
  /** 输入长度上限 */
  maxInputLength: Number(process.env.LIS_MAX_INPUT ?? 100000),
  /** 单次推进元素数上限 */
  maxStepBatch: Number(process.env.LIS_MAX_BATCH ?? 10000),
  /** 解释明细返回上限（默认） */
  explainLimit: Number(process.env.LIS_EXPLAIN_LIMIT ?? 100),
  /** 数据目录（项目内） */
  dataDir: process.env.LIS_DATA_DIR ?? "data",
  /** 端口：0 表示自动选择空闲端口 */
  port: Number(process.env.PORT ?? 0),
};

export type ErrorCode =
  | "INVALID_INPUT"
  | "INVALID_MODE"
  | "INVALID_BUDGET"
  | "RUN_NOT_FOUND"
  | "RUN_FINISHED"
  | "INPUT_TOO_LONG"
  | "BATCH_TOO_LARGE"
  | "BAD_REQUEST";

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

/** 严格校验输入：只接受有限 JSON 数字数组，拒绝字符串转数、NaN、Infinity、嵌套数组 */
export function validateInput(raw: unknown): number[] {
  if (!Array.isArray(raw)) {
    throw new ApiError("INVALID_INPUT", "input 必须是 JSON 数字数组");
  }
  if (raw.length > config.maxInputLength) {
    throw new ApiError("INPUT_TOO_LONG", `输入长度 ${raw.length} 超过上限 ${config.maxInputLength}`);
  }
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new ApiError(
        "INVALID_INPUT",
        `下标 ${i} 不是有限 JSON 数字（拒绝字符串/NaN/Infinity/嵌套数组）`,
      );
    }
  }
  return raw as number[];
}

export function validateMode(raw: unknown): "strict" | "nondecreasing" {
  if (raw !== "strict" && raw !== "nondecreasing") {
    throw new ApiError("INVALID_MODE", "mode 必须是 \"strict\" 或 \"nondecreasing\"");
  }
  return raw;
}
