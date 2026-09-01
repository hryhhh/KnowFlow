# Agent 升级总览（导航文档）

> 版本：v1.0  
> 日期：2026-08-31  
> 依赖文档：[08-agent-orchestration-v2.md](08-agent-orchestration-v2.md)（现有路由系统）  
> 关联 PRD：详见第三节索引

---

## 一、背景与目标

KnowBase X 当前是一个多 Agent 路由的 RAG 问答平台（[08-agent-orchestration-v2.md](08-agent-orchestration-v2.md)），核心链路为 `IntentRouter → Dispatcher → Compose`。

**核心缺失**：Agent 只能"选择谁回答"，不能"自主决定做什么"。需要补全工具调用和多步推理能力，才能进入真正的 Agent 系统。

**升级目标**：在保留现有路由模式（`AGENTS_ENABLED=true, AGENT_RUNTIME_ENABLED=false`）完全不变的前提下，通过 `AGENT_RUNTIME_ENABLED=true` 启用自主 Agent Runtime，具备 ReAct 循环、对话记忆、结构化 trace 和前端可观测面板。

---

## 二、关键设计决策

### 决策 1：Agent → Tool 改造策略

现有三个 Agent（`RagFlowAgent` / `DbQueryAgent` / `WebSearchAgent`）**不删除**，而是：

1. 新建原生 Tool 实现（`RagSearchTool` / `DbQueryTool` / `WebSearchTool`）— 使用 LangChain.js tool calling 机制
2. 保留现有 Agent 类，通过 `LegacyAgentAdapter` 包装为 Tool，作为降级路径
3. Feature Flag `AGENT_RUNTIME_ENABLED` 控制走哪条路径

### 决策 2：ReAct 不混入 Orchestrator

`Orchestrator` 职责是"路由 → 调度 → 合成"，三阶段单次执行。ReAct 是多轮循环，混入会破坏现有分层。

**方案**：新建 `AgentRuntime` 类，`AgentChatService` 根据 feature flag 路由到 `Orchestrator`（旧）或 `AgentRuntime`（新）。

### 决策 3：SSE 事件向后兼容

新增事件类型（`tool_call` / `tool_result` / `reasoning_summary`）不影响现有事件（`token` / `sources` / `done` / `error`）。旧客户端按 `type` 分支忽略未知事件，行为不变。

### 决策 4：Trace 存储方案

首期新建 `agent_traces` 单表（JSONB 存 steps），不拆多表。与 `usage_logs` 职责分离：
- `usage_logs`：调用统计（次数、耗时、状态）
- `agent_traces`：执行详情（每步 LLM/Tool 调用、token 消耗）

---

## 三、子 PRD 索引

| 文档 | 内容范围 | 所属 Phase | 主要修改文件 |
|------|---------|-----------|------------|
| [13-agent-tool-system-prd.md](13-agent-tool-system-prd.md) | Tool 抽象层 + 5 个内置工具 + LegacyAdapter | Phase 1 | `packages/agents/src/tools/` |
| [14-agent-runtime-prd.md](14-agent-runtime-prd.md) | AgentRuntime + ReAct 循环 + 对话记忆 + Trace 表 | Phase 1-2 | `packages/agents/src/runtime/` + DB migration |
| [15-agent-observability-prd.md](15-agent-observability-prd.md) | SSE 事件协议 + Trace API + 后端集成 | Phase 2 | `apps/server/src/modules/agents/trace/` |
| [16-agent-frontend-prd.md](16-agent-frontend-prd.md) | AgentActivity 面板 + chat-store + sse.ts 改造 | Phase 1-2 | `apps/frontend/src/` |

---

## 四、Phase 依赖关系

```
Phase 1 (3周)                    Phase 2 (2周)               Phase 3 (2周)
┌─────────────────────┐         ┌─────────────────────┐     ┌─────────────────────┐
│ Tool 系统           │────────▶│ Trace 系统          │────▶│ Supervisor Agent    │
│ (13号 PRD)          │ 依赖    │ (14/15号 PRD)       │ 依赖 │ (计划中)            │
│                     │         │                     │      │                     │
│ AgentRuntime        │────────▶│ 对话记忆            │────▶│ 前端优化            │
│ (14号 PRD)          │ 依赖    │ (14号 PRD)          │      │ (16号 PRD)          │
│                     │         │                     │      │                     │
│ LegacyAdapter       │         │ Trace API           │      │                     │
│ (13号 PRD)          │         │ (15号 PRD)          │      │                     │
└─────────────────────┘         └─────────────────────┘     └─────────────────────┘
      可以独立上线                      依赖 Phase 1                      依赖 Phase 2
```

**Phase 1 可以单独上线**：Tool 系统 + AgentRuntime 完成后，即使没有 Trace 前端面板，后端已具备完整的 ReAct 推理能力，用户可通过日志观察执行情况。

---

## 五、环境变量汇总

| 变量名 | 默认值 | Phase | 说明 |
|-------|-------|-------|------|
| `AGENT_RUNTIME_ENABLED` | `false` | P1 | 是否启用 AgentRuntime |
| `AGENT_REACT_MAX_ROUNDS` | `5` | P1 | ReAct 最大推理轮数 |
| `AGENT_RUNTIME_TIMEOUT_MS` | `30000` | P1 | 整体超时(ms) |
| `AGENT_MEMORY_MAX_MESSAGES` | `6` | P2 | 注入对话历史的最大的消息数 |
| `AGENT_TRACE_ENABLED` | `true` | P2 | 是否记录结构化 trace |
| `AGENT_SUPERVISOR_ENABLED` | `false` | P3 | 是否启用 Supervisor 模式 |
| `API_CALL_ALLOWED_DOMAINS` | `` | P1 | call_http_api 域名白名单（逗号分隔） |

---

## 六、风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| LLM tool calling 不稳定（模型不支持或返回格式错误） | 中 | 高 | try-catch + 重试 1 次；失败时降级到现有路由模式 |
| ReAct 循环导致 token 消耗超预期 | 中 | 中 | `AGENT_REACT_MAX_ROUNDS=5` + `AGENT_RUNTIME_TIMEOUT_MS=30000` 双重限制 |
| 工具执行超时影响用户体验 | 低 | 中 | 每个工具独立超时（web_search 3s，query_database 5s），超时返回部分结果 |
| 前端 SSE 事件类型不兼容旧客户端 | 低 | 低 | 新事件增量，旧客户端忽略未知 type |
| 对话历史注入导致 prompt 超长 | 中 | 中 | `AGENT_MEMORY_MAX_MESSAGES=6` 限制条数；后续加摘要机制 |

---

## 七、向后兼容性保证

| 场景 | 配置 | 行为 |
|------|------|------|
| 完全不升级 | `AGENT_RUNTIME_ENABLED=false`（默认） | 与当前代码行为完全一致，零影响 |
| 仅启用 Runtime | `AGENT_RUNTIME_ENABLED=true` | 走新链路，旧接口 `/api/agents/routeStream` 仍然可用 |
| 回退到路由模式 | `AGENT_RUNTIME_ENABLED=false` | 立即生效，无需重启（runtime 实例被废弃） |

---

## 八、不在范围内

以下内容列入未来规划，本期不实现：

| 功能 | 原因 | 预计进入版本 |
|------|------|------------|
| Supervisor 多 Agent 协作 | 现有路由模式已满足需求，复杂度高 | V0.7 |
| Planning 系统 | 需 YAML DSL，开发成本高 | V0.8 |
| Workflow 引擎 | 与 ReAct 重叠，先跑通 ReAct | V0.9 |
| MCP 支持 | 需引入新 SDK | V1.0+ |
| Human-in-the-loop | 无用户认证，审批无意义 | V1.0+ |
| Permission 系统 | 内网使用，DB Query 已有参数化保护 | V1.0+ |
| Long-term Memory | 先用 Conversation Memory 验证效果 | V0.5+ |
| 成本 USD 换算 | 国内模型价格变动频繁 | 后续 |
| Evaluation 系统 | 需要标注数据 | V1.0+ |
