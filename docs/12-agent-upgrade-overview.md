# Agent 系统设计与实现总览

> 版本：v2.0（原升级总览，Phase 1/2 落地后改版为实现总览）  
> 日期：2026-09-06  
> 依赖文档：[08-agent-orchestration-v2.md](08-agent-orchestration-v2.md)（路由系统 / Legacy 链路）  
> 代码位置：`packages/agents/`（引擎）、`apps/server/src/modules/agents/`（服务端集成）、`apps/frontend/src/components/AgentThoughtPanel.tsx`（前端）

---

## 一、背景与目标

KnowBase X 的路由系统（IntentRouter → Orchestrator → Compose，见 08 号文档）解决"选择谁回答"，但 Agent 只能"被路由到"，不能"自主决定做什么"。

**升级目标**：在保留路由模式（`AGENTS_ENABLED=true, AGENT_RUNTIME_ENABLED=false`）完全不变的前提下，通过 `AGENT_RUNTIME_ENABLED=true` 启用自主 Agent Runtime：ReAct 循环、工具调用、对话记忆、结构化 trace 与前端可观测面板。

**当前状态**：Phase 1（Tool 系统 + AgentRuntime）与 Phase 2（Trace/SSE 可观测 + 前端面板）已全部实现并有单元测试覆盖；Phase 3（Supervisor 等）仍为规划。

---

## 二、整体架构

`AgentChatService.stream()` 按 feature flag 选择链路（`apps/server/src/modules/agents/agent-chat.service.ts`）：

```
POST /api/chat/stream 或 /api/agents/routeStream
    │
    ├─ useRuntime = AGENTS_ENABLED && AGENT_RUNTIME_ENABLED && toolRegistry 就绪
    │
    ├─ true  ──▶ AgentRuntime 链路（新）
    │            ConversationMemory 加载历史 → ReAct 循环（LLM ⇄ Tools）
    │            → 流式 answer_delta → 保存 agent_traces
    │            → 失败且 AGENT_RUNTIME_FALLBACK=true 时回退 Orchestrator
    │
    └─ false ──▶ Orchestrator 链路（旧，08 号文档）
                 IntentRouter → Dispatcher 并行 → Compose(rag-priority)
```

### 关键设计决策（沿用升级时拍板）

1. **Agent → Tool 改造策略**：三个既有 Agent（`RagFlowAgent` / `DbQueryAgent` / `WebSearchAgent`）不删除，新建原生 Tool 实现，同时通过 `LegacyAgentAdapter` 把旧 Agent 包装为 Tool 作为可选项（`AGENT_LEGACY_TOOLS_ENABLED` 控制）。
2. **ReAct 不混入 Orchestrator**：Orchestrator 保持"路由 → 调度 → 合成"三阶段单次执行；多轮循环由独立的 `AgentRuntime` 承担。
3. **SSE 事件向后兼容**：新增事件（`tool_call` / `tool_result` / `agent_completed` 等）均为增量，旧客户端按 `type` 忽略未知事件。
4. **Trace 存储单表**：`agent_traces`（JSONB 存 steps），与 `usage_logs` 职责分离——前者存执行详情，后者存调用统计。

---

## 三、已实现能力

### 3.1 Tool 系统（`packages/agents/src/tools/`）

- `Tool` 接口 + `ToolRegistry`（注册 / 定义枚举）+ `ToolExecutor`（超时、必填参数校验、结果截断、异常捕获）
- 5 个内置工具：

| 工具名           | 说明                                                       |
| ---------------- | ---------------------------------------------------------- |
| `rag_search`     | 知识库检索（复用 `retrieve()`，非流式返回片段）            |
| `query_database` | 预定义 SQL 模板参数化查询（复用 `DbQueryService`，防注入） |
| `web_search`     | Tavily / Serper 联网搜索                                   |
| `read_file`      | 读取 `uploads/` 目录内文件（路径穿越防护）                 |
| `call_http_api`  | 外部 HTTP API 调用（域名白名单 + 内网保护）                |

### 3.2 AgentRuntime + ReAct 循环（`packages/agents/src/runtime/`）

- `AgentContext`：运行期上下文（runId、消息历史、AbortSignal 整体超时、ToolRegistry、TraceCollector）
- `ReactLoop`：LLM 推理 → 提取 tool_calls → 执行工具 → 追加消息 → 重复；`AGENT_REACT_MAX_ROUNDS`（默认 5）限制轮数，超限返回 `truncated`
- `AgentRuntime`：主入口，串起记忆加载、循环执行、trace 保存

### 3.3 对话记忆（`packages/agents/src/memory/`）

- `ConversationMemory` 经 `SessionService.getRecentMessages()` 加载最近 N 条消息（`AGENT_MEMORY_MAX_MESSAGES`，默认 6），sessionId 为空时返回空数组

### 3.4 可观测性（`packages/agents/src/observability/` + `apps/server/src/modules/agents/trace/`）

- `TraceCollector` 在内存中记录 `llm_call` / `tool_call` / `final_answer` 步骤与 token 用量
- `AGENT_TRACE_ENABLED=true` 时持久化到 `agent_traces` 表（`TraceService`），SSE `done` 之前落库；查询 API：
  - `GET /api/agents/traces/:id` — 单条 trace 详情
  - `GET /api/agents/traces?kbId=&limit=` — 列表（limit 1..100）
- 全局 `TraceIdInterceptor` 注入 trace_id，`usage_logs.traceId` 与 trace 关联

### 3.5 前端可观测（`apps/frontend/src/`）

- `AgentThoughtPanel` 组件：在 Chat 页 assistant 消息下方实时展示 `tool_call` / `tool_result` / `agent_completed` 等事件
- Trace 详情页：路由 `/traces/:traceId`，回看完整执行步骤
- chat-store 新增 `agentEvents` 状态；sse.ts 解析新增事件类型

### 3.6 SSE 事件协议（AgentRuntime 链路）

| 事件                                   | 触发时机         | 数据                                                     |
| -------------------------------------- | ---------------- | -------------------------------------------------------- |
| `trace`                                | 请求开始         | `{ traceId }`                                            |
| `agent_start`                          | Runtime 开始执行 | `{ agent: 'AgentRuntime' }`                              |
| `tool_call`                            | LLM 决定调用工具 | `{ toolName, args }`                                     |
| `tool_result`                          | 工具执行完成     | `{ toolName, result(截断 200 字), durationMs, isError }` |
| `agent_completed`                      | 整个 Run 完成    | `{ status, durationMs, tokensUsed? }`                    |
| `agent_error`                          | 执行出错         | `{ error, traceId }`                                     |
| `sources` / `token` / `done` / `error` | 与传统 RAG 相同  | —                                                        |

> Legacy 链路事件（`trace_id` / `agent_start` / `agent_done` / `process` / `meta`）见 08 号文档。

---

## 四、环境变量汇总（与 `.env.example` / `apps/server/src/config/env.ts` 对齐）

| 变量名                              | 默认值         | 说明                                        |
| ----------------------------------- | -------------- | ------------------------------------------- |
| `AGENTS_ENABLED`                    | `false`        | 启用多 Agent 编排（路由模式总开关）         |
| `AGENT_RUNTIME_ENABLED`             | `false`        | 启用 AgentRuntime（ReAct）链路              |
| `AGENT_RUNTIME_FALLBACK`            | `true`         | Runtime 失败时回退 Orchestrator 链路        |
| `AGENT_LEGACY_TOOLS_ENABLED`        | `false`        | 将旧 Agent 经 LegacyAgentAdapter 注册为工具 |
| `AGENT_REACT_MAX_ROUNDS`            | `5`            | ReAct 最大推理轮数                          |
| `AGENT_RUNTIME_TIMEOUT_MS`          | `30000`        | 整体超时（ms）                              |
| `AGENT_MEMORY_MAX_MESSAGES`         | `6`            | 注入对话历史的最大消息数                    |
| `AGENT_TRACE_ENABLED`               | `false`        | 是否持久化结构化 trace 到 `agent_traces`    |
| `AGENT_LLM_STREAMING`               | —              | Runtime LLM 流式开关                        |
| `AGENT_LLM_STREAM_TIMEOUT_MS`       | —              | 流式超时                                    |
| `AGENT_ALWAYS_INCLUDE_AGENTS`       | `ragflow`      | 路由模式：始终加入候选的 Agent（逗号分隔）  |
| `AGENT_ROUTER_CONFIDENCE_THRESHOLD` | `70`           | 路由模式：LLM 仲裁触发阈值（百分制）        |
| `AGENT_COMPOSE_STRATEGY`            | `rag-priority` | 路由模式合成策略                            |
| `AGENT_ROUTER_ALLOW_PARALLEL`       | `true`         | 路由模式：允许并行执行                      |
| `API_CALL_ALLOWED_DOMAINS`          | （空）         | `call_http_api` 域名白名单（逗号分隔）      |
| `API_CALL_ALLOW_PRIVATE`            | —              | 是否允许调用内网地址                        |

---

## 五、后续规划（Phase 3，未实现）

| 功能                     | 原因                              | 预计进入版本 |
| ------------------------ | --------------------------------- | ------------ |
| Supervisor 多 Agent 协作 | 现有路由模式已满足需求，复杂度高  | V0.7         |
| Planning 系统            | 需 YAML DSL，开发成本高           | V0.8         |
| Workflow 引擎            | 与 ReAct 重叠，先跑通 ReAct       | V0.9         |
| MCP 支持                 | 需引入新 SDK                      | V1.0+        |
| Human-in-the-loop        | 无用户认证，审批无意义            | V1.0+        |
| Long-term Memory         | 先用 Conversation Memory 验证效果 | V0.5+        |
| Evaluation 系统          | 需要标注数据                      | V1.0+        |

---

## 六、向后兼容性保证

| 场景           | 配置                                  | 行为                                                |
| -------------- | ------------------------------------- | --------------------------------------------------- |
| 完全不升级     | `AGENT_RUNTIME_ENABLED=false`（默认） | 与路由模式行为完全一致                              |
| 仅启用 Runtime | `AGENT_RUNTIME_ENABLED=true`          | 走新链路，旧接口 `/api/agents/routeStream` 仍然可用 |
| 回退到路由模式 | `AGENT_RUNTIME_ENABLED=false`         | 立即生效                                            |
| Runtime 异常   | `AGENT_RUNTIME_FALLBACK=true`（默认） | 自动回退 Orchestrator，不中断用户请求               |
