# Patience Sorting 递增子序列后端

基于最小尾值数组（Patience sorting）的 O(n log n) 最长递增子序列分析后端，含前驱证据重建。
TypeScript + Node.js + SQLite（`node:sqlite`，零原生依赖），只做 API 与 CLI，Windows 本地运行。

## 要求

- Node.js >= 22.5（内置 `node:sqlite`；开发环境为 Node 25）
- 无 Docker / WSL / 外部服务依赖

## 命令

```powershell
npm install        # 安装开发依赖（typescript）
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm start          # 启动 HTTP 服务（默认自动空闲端口；--port 指定）
npm run cli -- ... # 运行 CLI
npm run demo       # 演示：尾值摘要≠重建链、strict vs nondecreasing
```

## 算法说明

- 维护 `tails[len-1]` = 长度为 len 的递增子序列的最小尾值，及对应原下标 `tailIdx`。
- 二分位置：**strict** 取第一个 `>= x` 的位置；**nondecreasing** 取第一个 `> x` 的位置。
  因此相等元素在 strict 下互相覆盖（长度不增），在 nondecreasing 下可接续（长度增长）。
- 更新尾值**之前**记录当时上一长度的尾部原下标作为该元素的前驱 `preds[i]`。
- 最终从最长尾部沿前驱**反向重建**原下标链。尾值数组本身不是合法解
  （例如 `[1,3,2,0]` 的尾部下标为 `[3,2]`，下标不递增）。
- 平局策略确定性：相同输入与模式必得相同链（由二分规则唯一决定），不保证字典序最小。

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/runs` | 创建运行，body `{"input":[...],"mode":"strict"\|"nondecreasing"}` |
| POST | `/runs/:id/step` | 按预算推进，body `{"count":n}` |
| POST | `/runs/:id/finish` | 一次完成 |
| GET | `/runs/:id` | 状态与前缀最优长度 |
| GET | `/runs/:id/explain?limit=&offset=` | 步骤解释（二分位置、替换/增长、前驱、尾值摘要） |
| GET | `/runs/:id/chain` | 重建当前链（原下标 + 值 + 校验） |
| GET | `/runs/:id/report` | 导出完整报告（含全部前驱） |
| GET | `/runs` | 列出运行 |
| POST | `/compare` | 同一数组两种模式对照 |

预算停止时 `status="paused"`，响应注明只处理了多少元素，前缀答案不等于全输入答案。

## CLI

```
node dist/src/cli.js create "[3,1,2]" strict   # 或传 JSON 文件路径
node dist/src/cli.js step <id> 5
node dist/src/cli.js finish <id>
node dist/src/cli.js status <id>
node dist/src/cli.js explain <id> 10
node dist/src/cli.js chain <id>
node dist/src/cli.js report <id>
node dist/src/cli.js compare "[5,2,2,8,3,3,7]"
node dist/src/cli.js demo
```

## 校验与错误码

只接受有限 JSON 数字；拒绝字符串转数、NaN、Infinity、嵌套数组、非法模式。
错误以 `{"error": 代码, "message": 说明}` 返回：
`INVALID_INPUT` `INVALID_MODE` `INVALID_BUDGET` `RUN_NOT_FOUND` `RUN_FINISHED`
`INPUT_TOO_LONG` `BATCH_TOO_LARGE` `BAD_REQUEST`。

## 持久化与配置

- 数据保存在项目内 `data/lis.db`：输入与模式冻结，保存处理位置、尾值、尾部下标、前驱与逐步摘要。
- 批量推进在单事务中原子提交；重启后从已有状态续算，不重算、不重复追加步骤。
- 环境变量：`PORT`（默认 0=空闲端口）、`LIS_DATA_DIR`、`LIS_MAX_INPUT`、`LIS_MAX_BATCH`、`LIS_EXPLAIN_LIMIT`。

## 测试

`npm test` 覆盖：空输入、全相等、全降序、负数、浮点数、末尾更长解、多最优解、
随机小数组与独立 O(n²) DP 交叉核对、链逐项取自原数组、一次/分批/重启续算一致性、
加常数/乘正数长度不变、失败操作不改变进度、解释限量但前驱完整。

## 限制

- 单进程本地服务，无鉴权；不保证列出全部最优解。
- `node:sqlite` 仍标记为实验特性（Node 25 可用，启动时有 ExperimentalWarning）。
