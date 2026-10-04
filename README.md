# Patience Sorting 递增子序列后端

基于最小尾值数组（patience sorting）的 O(n log n) 最长递增子序列分析后端。
仅提供 HTTP API 与 CLI，使用 TypeScript + Node.js + SQLite（`node:sqlite`，无原生依赖），
Windows 本地运行，不需要 Docker / WSL / 外部服务。

## 功能

- 严格递增（`strict`）与非递减（`nondecreasing`）两种模式
- 返回最优长度与一条可核对的原下标链（0 起，下标严格递增，值满足模式）
- 逐步解释：二分位置、替换/增长、前驱、更新后尾部摘要
- 按元素预算推进，暂停时明确标注“前缀最优 ≠ 全输入答案”
- SQLite 持久化：输入与模式冻结，重启后续算不重复追加步骤
- 确定性平局策略：只保证输出一条合法最优链，不保证字典序最小

## 算法说明

维护 `tails[len-1]` = 长度为 `len` 的递增子序列的最小尾值，及对应尾部原下标 `tailsIdx`。
处理元素 `x` 时二分定位：

- `strict`：第一个 `>= x` 的位置（相等元素不能接在后面，只能替换）
- `nondecreasing`：第一个 `> x` 的位置（相等元素可以接在后面，使链增长）

因此全相等数组 `[5,5,5]` 在 strict 下长度为 1，在 nondecreasing 下长度为 3。

**关键**：更新尾值之前，先记录当时上一长度的尾部下标作为该元素的前驱 `prev[i]`。
最终从最长尾部下标沿 `prev` 反向重建链。`tails`/`tailsIdx` 本身只是摘要，
通常不是原序列中的合法解（例如 `[10,20,5,30,8]` 的 tails 为 `[5,8,30]`，
对应下标 `[2,4,3]` 不递增；合法解是 `[10,20,30]`，下标 `[0,1,3]`）。

## 快速开始

```powershell
npm install
npm run build     # 编译到 dist/
npm test          # 构建并运行全部测试
npm start         # 启动服务（PORT 未设置时自动选择空闲端口并打印）
npm run demo      # CLI 演示：两种模式对比表
```

环境变量：`PORT`（默认 0 = 空闲端口）、`DATA_DIR`（默认 `./data`）、
`MAX_INPUT_LEN`（默认 1000000）、`STEP_BUDGET`（默认推进预算 1000）、
`MAX_DETAIL`（步骤明细返回上限，默认 100）。

## CLI

```powershell
node dist/cli.js compare '[10,20,5,30,8]'   # 两种模式对比表（含原下标证据）
node dist/cli.js steps '[2,2,2,3,3,1]' strict
node dist/cli.js create '[3,1,2]' strict    # 创建持久化运行
node dist/cli.js advance 1 2                # 按预算推进
node dist/cli.js chain 1                    # 重建当前链
node dist/cli.js report 1                   # 导出报告 JSON
node dist/cli.js demo
```

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/runs` | 创建运行 `{input, mode}` |
| POST | `/runs/:id/run` | 一次处理完所有剩余元素 |
| POST | `/runs/:id/advance` | 按预算推进 `{budget}`，未完成时 `status=paused` |
| GET | `/runs/:id/status` | 当前前缀最优长度与进度 |
| GET | `/runs/:id/steps/:seq` | 解释指定步骤（二分位置/动作/前驱/尾部摘要） |
| GET | `/runs/:id/steps?limit=&offset=` | 步骤列表（上限 `MAX_DETAIL`） |
| GET | `/runs/:id/chain` | 重建当前下标链与值链 |
| GET | `/runs/:id/report` | 导出完整报告 |

错误统一为 `{"error":{"code","message"}}`，错误码包括
`INVALID_INPUT`、`INVALID_MODE`、`INVALID_BUDGET`、`INVALID_JSON`、`NOT_FOUND`。
输入只接受有限 JSON 数字数组，拒绝字符串转数、NaN、Infinity、嵌套数组与非法模式。

## 测试

`npm test` 覆盖：空输入、全相等、全降序、负数、浮点数、末尾产生更长解、
多个最优解、随机小数组与独立 O(n²) DP 核对长度并逐项校验链、
加常数/乘正数长度不变、一次/分批/重启续算一致性、失败操作不改变进度、
预算暂停标记、步骤记录字段完整性。

## 限制

- 只输出一条最优链（确定性平局策略），不枚举全部最优解
- 步骤明细查询有上限（`MAX_DETAIL`），但前驱数据与最终解始终完整
- `node:sqlite` 在 Node 25 仍打印 ExperimentalWarning，不影响功能（需 Node >= 22.5）
