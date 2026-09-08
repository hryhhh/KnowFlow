# Agent PRD — Phase 4：工程化与产品化

> 编号：PRD-P4 ｜ 上游路线图：[09-agent-evolution-roadmap.md](09-agent-evolution-roadmap.md) ｜ 通用约定见 09 号 §九  
> 范围：D1 异步 Agent 运行、D2 工具权限与配额（用户认证体系延后）、D3 Human-in-the-loop、D4 成本换算、D5 参数调优  
> 依赖：D1/D2/D3 相互独立（D3 以 apiKey 身份记录 decidedBy，见范围决议）；D5 依赖 PRD-P1 的 A1 评测集。

---

## D1 异步 Agent 运行

### 背景

`AGENT_RUNTIME_TIMEOUT_MS`（30s）是复杂任务硬天花板；SSE 要求客户端在线。目标：长任务后台执行、状态可查、结果可回取。

### 架构

- 新 BullMQ 队列 `agent-run`（复用现有 worker 进程与 Redis，新增 `AgentRunProcessor`，并发 `AGENT_RUN_CONCURRENCY` 默认 2）；
- **重构前置**：将 `AgentChatService.stream()` 中的执行内核拆出非流式方法 `execute(query, kbId, params, traceId, apiKeyId): Promise<AgentExecuteResult>`（返回 finalAnswer/sources/meta），SSE 与队列两条入口共用；这是本项的主要重构风险点，拆分时现有测试必须零修改通过。

### API

```
POST /api/agents/runs            # body 同 routeStream + { callbackUrl?: string }
                                 # → 202 { runId, traceId }
GET  /api/agents/runs/:runId     # → { status: queued|running|completed|failed,
                                 #      answer?, sources?, traceId?, error? }
DELETE /api/agents/runs/:runId   # 取消：写 Redis `cancel:<runId>` 标志，AgentRunProcessor 订阅后
                                 # 触发既有 AbortSignal（跨进程），随后队列 remove
                                 # （注意：BullMQ Job.remove() 对运行中任务不会中止执行，禁止仅依赖它）
```

- 结果落库：新表 `agent_runs`（id PK, status, query, kb_id, trace_id FK→agent_traces, **created_by**（发起方 apiKeyId / user id，D2 后无缝映射到用户）, answer TEXT, sources JSONB, error, created_at, completed_at）；**GET / DELETE 按 created_by 过滤，非属主返回 404**（否则任何调用方可枚举读取他人 run 的答案与 sources、取消他人任务）；保留期 `AGENT_RUN_RETENTION_DAYS`（默认 7；以 BullMQ repeatable job 每日清理，复用现有 worker 进程，不引入外部 cron）；
- 回调：完成后若带 `callbackUrl`，POST `{ runId, status, answer, sources, traceId }`，携带 `X-Callback-Signature`（HMAC-SHA256，密钥 env `AGENT_RUN_CALLBACK_SECRET`，接收方可验证来源），失败重试 3 次（退避 5s/30s/120s）；
- 超时：run 级 `AGENT_RUN_TIMEOUT_MS`（默认 300000），abort 语义与 ReAct 现有 signal 一致。

### 环境变量

| 变量                               | 默认     | 说明                                          |
| ---------------------------------- | -------- | --------------------------------------------- |
| `AGENT_RUN_ENABLED`                | `false`  | 总开关                                        |
| `AGENT_RUN_CONCURRENCY`            | `2`      | 队列并发                                      |
| `AGENT_RUN_TIMEOUT_MS`             | `300000` | 单 run 超时                                   |
| `AGENT_RUN_RETENTION_DAYS`         | `7`      | 结果保留期                                    |
| `AGENT_RUN_CALLBACK_SECRET`        | （空）   | 回调 HMAC 签名密钥；配置了 callbackUrl 时必填 |
| `AGENT_RUN_CALLBACK_ALLOWED_HOSTS` | （空）   | 回调域名白名单（逗号分隔；空 = 拒绝所有回调） |
| `AGENT_RUN_MAX_PENDING`            | `5`      | 单 Key pending 状态 run 上限（防队列洪泛）    |

### 安全约束

- runs POST 挂 ApiKeyGuard（Bearer API Key，已确认），`created_by` 即该 apiKeyId；浏览器聊天场景不使用异步 API；
- `callbackUrl` 强制 https 且 host 在白名单内，否则 422；
- 队列入口与 SSE 入口共享工具权限过滤（D2：按 `api_keys.allowed_tools` 裁剪）；
- runs POST 纳入现有 RateLimitGuard（apikey 模式），并校验单 Key pending run ≤ `AGENT_RUN_MAX_PENDING`，超限 429——防止刷队列饿死共享 worker 的文档摄入任务。

### 验收标准

- [ ] `execute()` 拆分后全部现有 agent 相关测试零修改通过；
- [ ] 200s 级长任务（mock 慢工具）后台完成，轮询可取结果，trace 完整；
- [ ] 取消：running 状态下 DELETE 返回 202，≤ 3s 内 status=cancelled、trace 含 aborted 步骤、mock 断言无后续 LLM 调用；
- [ ] 非属主访问 GET / DELETE 他人 run 返回 404（集成测）；
- [ ] pending 超过 `AGENT_RUN_MAX_PENDING` 时新请求 429；
- [ ] 回调白名单外地址被拒。

### 工作量

5 人日。

---

## D2 工具权限与配额（用户认证体系延后）

> **范围决议（2026-09-06，已确认）**：登录/用户体系（users 表、JWT、注册登录、JwtAuthGuard、前端登录页）整体延后至独立专项，本 PRD 集只保留 Agent 相关部分——工具级授权与配额，均以 **API Key** 为身份主体。

### 工具级权限

- 权限源：`api_keys.allowed_tools`（JSONB 新列，null = 不限制）——**本期内唯一权限源**，对 service-call 链路与 D1 异步 runs 链路（均带 Bearer API Key）生效；
- 生效范围边界：浏览器 chat 场景无 API Key 身份，不受工具过滤（与现状一致）；`users.role` → 工具映射设计随认证体系延后（见下"延后设计"），落地前 readonly 等角色粒度不可用；
- `ToolRegistry` 新增 `getFilteredFor(permission: ToolPermission)`；`AgentChatService.initTools()` 后按请求构建 per-request registry（注册成本可忽略，Map 复制）；D1 的 `AgentRunProcessor` 按 run 的 `created_by` apiKey 同样过滤；
- 未授权工具不出现在 `getAllDefinitions()`，LLM 无法调用（而非调用时报错）。

### 配额

- `api_keys` 新增 `monthly_quota INT nullable`（null = 不限）：`usage_logs` 按 apiKeyId + 自然月聚合校验，超限返回 429（复用 RateLimitGuard 的响应结构）；聚合校验存在并发窗口，允许 ±1 误差、最终一致，不做行锁；429 响应体含 `quota` / `used` 字段；跨自然月首个请求自动重置；
- 前置补齐：`usage_logs.apiKeyId` 现状仅 api 类型调用有值，chat / agent 调用点须补传（无 Key 的浏览器调用记 null，不参与配额）。

### 延后设计（认证体系专项，保留备查，本 PRD 集不排期）

- 新表 `users`（id UUID PK, username VARCHAR(64) UNIQUE, password_hash VARCHAR(128)（bcrypt）, role VARCHAR(16)（admin/user/readonly）, created_at）；
- 接口：`POST /api/auth/login` → `{ token, user }`（JWT，有效期 `AUTH_JWT_TTL` 默认 24h）；`POST /api/auth/register`（仅当 `AUTH_INVITE_CODE` 配置且匹配时开放）；`AUTH_ENABLED` 灰度开关 + `JwtAuthGuard` 保护管理类端点（含 custom-tools 管理开关的解禁条件，见 PRD-P3 C2）；`@CurrentUser()` 装饰器；
- role → 工具映射：admin 全部；user 全部排除 `mcp_*` 与 `requires_approval` 工具；readonly 仅 `rag_search`/`read_file`；
- 首期边界（登记遗留项）：无 token 吊销（登出/改密后旧 token 在 TTL 内仍有效）、无密码找回、无用户停用流程；前端登录页 / token 存储 / 路由守卫同步延后；
- env：`AUTH_ENABLED` / `AUTH_JWT_SECRET`（启用时必填 fail-fast）/ `AUTH_JWT_TTL` / `AUTH_INVITE_CODE` 随专项登记，本期内不引入。

### 验收标准

- [ ] `allowed_tools=null` 的存量 Key 行为不变，全部现有集成测不改通过（回归红线）；
- [ ] allowed_tools 过滤对 service-call 链路与 D1 runs 链路生效（getAllDefinitions 断言：白名单外工具不出现）；
- [ ] 配额超限 429 且 usage 统计准确（chat/agent 调用点补传 apiKeyId 后按 Key 聚合）；跨月边界自动重置。

### 工作量

5 人日（allowed_tools 列与过滤 2、配额与 usage 补传 2、回归与评测 1）。

---

## D3 Human-in-the-loop 审批

### 交互协议

- 工具侧：`Tool` 接口新增可选元数据 `requiresApproval?: boolean`（C2 的写操作自定义工具默认 true；`call_http_api` 仅 method=POST 时 true）；
- 执行侧：`ToolExecutor` 命中需审批工具 → 不执行，抛出 `ApprovalRequiredError`；
- ReactLoop 捕获后：生成 `approvalId`（UUID），状态存 Redis `approval:<id>`（{ runId, toolName, args, traceId }，TTL `APPROVAL_TTL_SECONDS` 默认 300），run 状态置 `awaiting_approval`，SSE 推事件：
  `approval_required` → `{ approvalId, toolName, args, traceId }`，本轮循环挂起（Promise pending）；
  **挂起期间暂停 `AGENT_RUNTIME_TIMEOUT_MS` 整体超时计时**（超时 deadline 重算 / signal 暂停）——否则 30s 默认超时将先于 300s 审批窗口中止 run，SSE 主链路的审批功能必然断裂；`APPROVAL_TTL_SECONDS` 不受 run 超时约束（写入 env 说明）；
  **Redis 降级**：Redis 不可用/写入失败时按拒绝处理（注入拒绝上下文后走完 run）并记 error，不允许永久挂起；
- 决策接口：`POST /api/agents/approvals/:approvalId` body `{ approved: boolean, editedArgs?: object }`：
  - `editedArgs` 须经该工具 parameters schema 校验（与 ToolExecutor 同套校验），非法返回 422——防止审批环节注入任意参数；
  - approved=true → 用（可能被编辑的）args 继续执行该工具，循环恢复；
  - false 或 TTL 过期 → 向消息历史注入"该操作已被用户拒绝"，循环恢复（模型自行决定下一步）；
- **断线恢复**：run 查询接口（`GET /api/agents/runs/:runId` 或 D1 前的等价只读端点）返回 pending approval（`approvalId` / `toolName` / `args` / 剩余 TTL），SSE 断线或页面刷新后前端据此重建决策 UI，避免 300s 后用户无感地被自动拒绝；
- trace：`steps` 记录 `type: 'approval'`（data: `{ approvalId, toolName, decision, decidedBy, latencyMs }`；decidedBy = apiKeyId / `anonymous`，认证体系上线后迁移为 user_id）；
- 异步链路（D1）：`awaiting_approval` 的 job 延迟重试（BullMQ delayed job 30s 轮询 Redis 状态），不占用并发槽位则先移出再 re-add。

### 环境变量

| 变量                   | 默认    | 说明                                         |
| ---------------------- | ------- | -------------------------------------------- |
| `APPROVAL_ENABLED`     | `false` | 总开关；关闭时需审批工具直接执行（现状语义） |
| `APPROVAL_TTL_SECONDS` | `300`   | 决策等待窗口                                 |

### 验收标准

- [ ] 集成测：POST 类工具触发 approval_required → approve 后工具结果进入下一轮 → 最终答案正常；
- [ ] 审批挂起期间 run 不被 `AGENT_RUNTIME_TIMEOUT_MS`（mock 时钟 ≥ TTL 时长）中止；
- [ ] SSE 断开后经 run 查询接口取回 pending approval 并完成决策；
- [ ] editedArgs 不符合工具 schema 返回 422；
- [ ] reject 与超时路径：模型收到拒绝上下文并能继续或收尾；Redis 异常时按拒绝收尾（不永久挂起）；
- [ ] 审批链完整写入 trace；决策接口幂等（重复提交返回首次结果）。

### 工作量

5 人日（decidedBy 记录 apiKeyId / `anonymous`，认证体系上线后迁移为 user_id；**无前置依赖**）。

---

## D4 成本换算与预算

- 价目配置：`config/model-prices.yml`：

```yaml
prices: # USD / 1M tokens
  qwen3.7-plus: { input: 0.8, output: 2.0 }
  text-embedding-v4: { input: 0.5, output: 0 }
  default: { input: 1.0, output: 2.0 } # 未登记模型回退
```

- 数据：`usage_logs` 新增 `tokens_input INT`、`tokens_output INT`、`cost_usd NUMERIC(10,4)`、`gate_reason VARCHAR(32) nullable`（PRD-P1 A3 闸门拒答标记，迁移同批）列；各 `usageLog.record()` 调用点补传 tokens（TraceCollector 已有统计，Legacy 链路从 LLM 响应 usage 取，缺省 0）；
- **前置 spike（0.5 人日，计入 D4）**：验证阿里云 MaaS（qwen3.7-plus）对 OpenAI `stream_options.include_usage` 的支持——现状 `streamChat` 流式路径不请求 usage；不支持则流式链路按 tokenizer 估算并在 `usage_logs` 标记 `estimated=true`（成本 KPI 标注估算口径），避免主聊天链路 cost 恒 0 导致 KPI 失真；
- 聚合：dashboard summary 增加成本 KPI（本月累计、按 type 分布）；`GET /api/dashboard/usage-trends` 响应附 `costUsd`；
- env：`COST_ENABLED`（默认 false）。

### 验收标准

- [ ] record 时 tokens 缺失不报错（cost 记 0）；价目未登记模型走 default；
- [ ] 流式链路：provider 支持 include_usage 时按实际 usage 计费；不支持时走估算并标记 estimated=true（spike 结论归档）；
- [ ] dashboard 成本与 usage_logs 明细聚合一致（对账单测）。

### 工作量

3 人日。

---

## D5 检索参数调优（执行手册，非代码项）

### 流程

1. 前置：A1 评测集与指标基线已归档（`tests/eval/report/baseline.json`）；
2. 网格：`chunkSize ∈ {500, 1000, 1500}` × `denseWeight ∈ {0.3, 0.5, 0.7}`（其余参数固定现状值），共 9 组；
3. 每组：以 `test-data/` 语料重建评测知识库 → 跑 `pnpm eval:agent` → 记录 recall@10 与 judge 均分；
4. 产出：`tests/eval/report/tuning-<date>.md` 对比矩阵 + 结论（含"维持现状"的可能）；
5. 若变更默认值：更新 `rag-config.provider.ts` / `.env.example` / 本文档与 12 号能力清单，并作为新 baseline 归档。

### 验收标准

- [ ] 9 组对比矩阵归档，每组 ≥ 2 次运行取均值（剔除 LLM 抖动）；
- [ ] 默认值变更（如有）经 A1 回归无退化。

### 工作量

2 人日（多为机器时间）。

---

## Phase 4 汇总

| 项   | 工作量     | 依赖                                   |
| ---- | ---------- | -------------------------------------- |
| D1   | 5 人日     | execute() 拆分（本项内含）             |
| D2   | 5 人日     | 无（认证体系延后，见范围决议）         |
| D3   | 5 人日     | 无（decidedBy = apiKeyId）             |
| D4   | 3 人日     | 无                                     |
| D5   | 2 人日     | A1                                     |
| 合计 | 约 20 人日 | D1/D2/D3/D4 可并行（认证延后后腾出 5） |
