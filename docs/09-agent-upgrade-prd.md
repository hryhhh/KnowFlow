# KnowBase X — Agent 升级 PRD

> 版本：v1.0  
> 日期：2026-08-30  
> 状态：草稿  

---

## 1. 背景与目标

### 1.1 现状

KnowBase X 目前是一个基于多 Agent 路由的 RAG 问答平台，核心链路如下：

```
用户提问
    │
    ▼
IntentRouter（正则 + LLM 仲裁）
    ├─ ragflow     → RAGFlowAgent（知识库检索 + 流式返回）
    ├─ db-query    → DbQueryAgent（参数化 SQL 查询）
    └─ web-search  → WebSearchAgent（Tavily/Serper 联网搜索）
    │
    ▼
Dispatcher（并行执行，rag-priority 合成）
    │
    ▼
SSE 流式响应 → 前端渲染
```

**已具备的能力**：多源路由、并行执行、结果融合、SSE 流式、会话管理、使用日志。

**核心缺失**：系统只能"选择哪个 Agent 回答"，不能"让 Agent 主动调用工具、规划多步推理"。本质是**查询路由系统**，不是真正的 **Agent 系统**。

### 1.2 目标

升级为**自主多 Agent 协作平台**，使系统具备：

| 能力维度 | 当前状态 | 目标状态 |
|---------|---------|---------|
| 工具调用 | ❌ 无 | ✅ Agent 可自主调用工具（search、query_db、read_file、call_api 等） |
| 多步推理 | ❌ 单次路由即答 | ✅ ReAct 循环：思考→行动→观察，直到得出结论 |
| 对话记忆 | ⚠️ 有会话存储，但未注入 Agent | ✅ 历史上下文自动注入，支持长期记忆摘要 |
| 多 Agent 协作 | ⚠️ 并行独立执行 | ✅ Supervisor 调度，子 Agent 可互相调用 |
| 可观测性 | ⚠️ traceId + 粗粒度 meta 事件 | ✅ 每次 tool call、LLM 推理均有结构化日志 |
| 成本追踪 | ⚠️ 仅记录调用次数 | ✅ 按 tool call / LLM call 粒度统计 token 消耗 |
| 前端展示 | ⚠️ 只展示最终文本 | ✅ 展示 thinking process、tool call 详情、来源高亮 |

---

## 2. 功能需求

### 2.1 Tool-Use 框架（P0）

**问题**：Agent 无法执行动作，只能返回预生成的文本。

**需求**：

- 定义 `Tool` 抽象接口，支持声明 `name`、`description`、`parameters`（JSON Schema）
- 每个 Agent 持有可调用工具列表
- 编排时，LLM 根据 query + 可用工具列表，决定调用哪个工具、传什么参数
- 工具执行结果作为 observation 反馈给 LLM，驱动下一轮推理

**涉及组件**：
- 新增 `packages/agents/src/tools/base-tool.ts` — 工具基类
- 新增 `packages/agents/src/tools/tool-registry.ts` — 工具注册中心（运行时增删）
- 新增 `packages/agents/src/tools/builtin/` — 内置工具实现

**内置工具清单**（首期）：

| 工具名 | 描述 | 实现方式 |
|-------|------|---------|
| `search_web` | 联网搜索 | 复用现有 `WebSearchAgent` 的 provider |
| `query_database` | 结构化数据库查询 | 复用现有 `DbQueryService` |
| `read_knowledge` | 知识库语义检索 | 复用现有 `RAGFlowAgent` / `retrieveAndChat` |
| `call_http_api` | 通用 HTTP 接口调用 | 新实现，支持 GET/POST + 自定义 header |
| `read_file` | 读取本地/上传文件 | 新实现，读取 `/uploads` 目录 |

**接口设计**：

```typescript
// packages/agents/src/tools/base-tool.ts
interface ToolCall {
  id: string;
  toolName: string;
  arguments: Record<string, any>;
}

interface ToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JSONSchema;
  execute(args: Record<string, any>): Promise<ToolResult>;
}
```

### 2.2 ReAct 推理循环（P0）

**问题**：单次路由 → 单次执行，无法处理需要多步推理的复杂问题。

**需求**：

- 在 `Orchestrator` 层增加 ReAct 循环控制
- 每轮循环：LLM 输出 thought + tool_call（或最终 answer）
- 若有 tool_call：执行工具 → 将结果加入上下文 → 下一轮
- 若无 tool_call：输出最终答案，结束循环
- 最大循环次数限制（默认 5 次），防止死循环
- 支持流式输出 thought 和最终 answer

**流程**：

```
┌─────────────────────────────────────────────────┐
│  Round 1: LLM                                    │
│  "我需要先搜索相关信息，再查数据库验证"           │
│  → tool_call: search_web("最新AI新闻")            │
├─────────────────────────────────────────────────┤
│  Tool Execution                                  │
│  → search_web 返回 3 条结果                       │
├─────────────────────────────────────────────────┤
│  Round 2: LLM（带 observation）                   │
│  "根据搜索结果...还需要查数据库确认数量"           │
│  → tool_call: query_database("SELECT COUNT...")  │
├─────────────────────────────────────────────────┤
│  Tool Execution                                  │
│  → query_database 返回 [{total: 42}]             │
├─────────────────────────────────────────────────┤
│  Round 3: LLM                                    │
│  "根据以上信息，答案是..."                        │
│  → final_answer（无 tool_call）                   │
│  循环结束                                        │
└─────────────────────────────────────────────────┘
```

**涉及组件**：
- 新增 `packages/agents/src/planner/react-loop.ts` — ReAct 循环控制器
- 修改 `packages/agents/src/orchestrator.ts` — 集成 ReAct 循环
- 修改 `packages/agents/src/types.ts` — 新增 `ToolCall`、`ToolResult` 类型

### 2.3 对话记忆增强（P1）

**问题**：每次查询独立，多轮对话无上下文关联。

**需求**：

- **短期记忆**：将最近 N 轮对话历史作为 context 注入每轮 LLM 调用
  - 默认保留最近 6 条消息（3 轮 user/assistant）
  - 通过环境变量 `AGENT_MEMORY_MAX_MESSAGES` 可配置
- **记忆摘要**：当对话超过阈值时，用 LLM 生成摘要，替换历史消息
  - 阈值由 `AGENT_MEMORY_SUMMARY_THRESHOLD` 控制（默认 10 轮）
- **长期记忆**（二期）：将重要事实存入向量库，下次会话检索相关记忆
  - 复用现有 `memory-store.ts`（rag-engine 已有雏形）

**数据流**：

```
用户消息: "昨天那个客户叫什么名字来着？"
    │
    ▼
SessionService.getMessageHistory(sessionId, limit=6)
    │
    ▼
[
  {role: 'user', content: '查一下客户张三的信息'},
  {role: 'assistant', content: '客户张三是 XX 公司的负责人...'},
  {role: 'user', content: '昨天那个客户叫什么名字来着？'}
]
    │
    ▼
拼入 prompt context → ReAct 循环使用
```

**涉及组件**：
- 修改 `apps/server/src/modules/session/session.service.ts` — 新增 `getMessagesWithHistory()` 方法
- 修改 `apps/server/src/modules/agents/agent-chat.service.ts` — 注入对话历史到 AgentParams
- 新增 `packages/agents/src/memory/conversation-memory.ts` — 记忆管理逻辑

### 2.4 多 Agent 协作（Supervisor 模式）（P1）

**问题**：现有并行执行无法处理"需要多个 Agent 协作完成"的任务。

**需求**：

- 新增 `SupervisorAgent`：接收用户问题，分解为子任务，分发给子 Agent
- 子 Agent 执行结果汇总给 Supervisor，由 Supervisor 生成最终答案
- 支持子 Agent 之间的依赖关系（串行/并行）

**场景举例**：

```
用户："帮我总结一下行业最新动态，并对比我们知识库里的相关资料"
    │
    ▼
SupervisorAgent
    ├── 子任务1: "行业最新动态" → WebSearchAgent（并行）
    ├── 子任务2: "知识库相关资料" → RAGFlowAgent（并行）
    └── 汇总两个结果，生成综合回答
```

**涉及组件**：
- 新增 `packages/agents/src/agents/supervisor-agent.ts`
- 修改 `packages/agents/src/orchestrator.ts` — 支持 Supervisor 模式路由

### 2.5 结构化 Trace 系统（P1）

**问题**：当前 traceId 仅有粗粒度 meta 事件，无法定位具体问题。

**需求**：

- 每次 tool call 记录：tool name、input args、output、latency、isError
- 每次 LLM 调用记录：model、tokens（prompt/completion）、latency、response
- 暴露 `/api/trace/:traceId` 接口，返回完整执行链路
- 前端可配置打开 trace 调试面板

**数据模型**：

```typescript
interface AgentTrace {
  traceId: string;
  kbId: string;
  sessionId: string;
  query: string;
  createdAt: string;
  // 执行步骤
  steps: Array<{
    type: 'route' | 'llm_call' | 'tool_call' | 'tool_result' | 'final_answer';
    timestamp: string;
    data: Record<string, any>;
  }>;
  // 汇总
  summary: {
    totalDurationMs: number;
    llmCalls: number;
    toolCalls: number;
    finalAnswer: string;
    tokensUsed: { prompt: number; completion: number; total: number };
  };
}
```

**涉及组件**：
- 新增 `apps/server/src/modules/agents/trace/trace.service.ts`
- 新增 `apps/server/src/modules/agents/trace/trace.controller.ts`
- 新增 DB 表 `agent_traces`
- 前端新增 `TraceView` 页面

### 2.6 成本追踪（P2）

**问题**：`UsageLogService` 仅记录调用次数，无法分析 token 成本。

**需求**：

- 每次 LLM 调用记录 `tokenUsage`
- 按模型单价计算成本（支持配置）
- 在 Dashboard 展示成本趋势

**涉及组件**：
- 扩展 `apps/server/src/modules/usage/usage-log.service.ts`
- 新增 `apps/server/src/modules/usage/entities/cost-log.entity.ts`

### 2.7 前端 Agent 可观测面板（P2）

**需求**：

- Chat 页面增加"推理过程"折叠面板
- 实时显示：当前正在调用哪个工具、LLM 的 thought 内容
- 工具调用结果可展开查看
- 支持切换到 Trace 详情页

**涉及组件**：
- 修改 `apps/frontend/src/pages/Chat/ChatPage.tsx`
- 新增 `apps/frontend/src/components/AgentThoughtPanel.tsx`

---

## 3. 非功能需求

| 类别 | 要求 |
|------|------|
| 性能 | ReAct 循环每轮 LLM 调用 ≤ 3s，最大 5 轮，整体响应 ≤ 30s |
| 可靠性 | 工具调用失败时降级：单工具失败不影响其他工具，最终 fallback 到纯 RAG |
| 可配置性 | 所有新功能通过环境变量控制开关和参数，不修改代码即可调整行为 |
| 向后兼容 | `AGENTS_ENABLED=false` 时保持原有 RAG 行为不变；ReAct 作为可选开启功能 |
| 测试 | 每个新模块单元测试覆盖率 ≥ 80% |

---

## 4. 环境石变量

| 变量名 | 默认值 | 说明 |
|-------|-------|------|
| `AGENT_REACT_ENABLED` | `false` | 是否启用 ReAct 循环 |
| `AGENT_REACT_MAX_ROUNDS` | `5` | 最大推理轮数 |
| `AGENT_MEMORY_MAX_MESSAGES` | `6` | 注入对话历史的最大的消息数 |
| `AGENT_MEMORY_SUMMARY_THRESHOLD` | `10` | 超过此轮数触发摘要 |
| `AGENT_TRACE_ENABLED` | `true` | 是否记录结构化 trace |
| `AGENT_SUPERVISOR_ENABLED` | `false` | 是否启用 Supervisor 协作模式 |

---

## 5. 实现计划

### Phase 1：Tool-Use + ReAct（2-3 周）

| 周 | 任务 | 交付物 |
|----|------|-------|
| W1 | 实现 Tool 抽象层 + ToolRegistry + 4 个内置工具 | `packages/agents/src/tools/` 可测试 |
| W1 | 实现 ReAct 循环控制器 | `packages/agents/src/planner/react-loop.ts` |
| W2 | 集成 ReAct 到 Orchestrator | `orchestrator.ts` 更新 |
| W2 | AgentChatService 适配新接口 | SSE 事件新增 `tool_call`、`tool_result` |
| W3 | 单元测试 + 端到端测试 | 覆盖率达到 80%+ |

### Phase 2：记忆增强 + Trace（1-2 周）

| 周 | 任务 | 交付物 |
|----|------|-------|
| W4 | 对话历史注入 + 记忆摘要 | `conversation-memory.ts` |
| W4 | Trace 系统 + DB 表 + API | `trace.service.ts` + `agent_traces` 表 |
| W5 | Trace 前端页面 | `/trace/:traceId` 路由 |

### Phase 3：Supervisor + 成本追踪 + 前端优化（2 周）

| 周 | 任务 | 交付物 |
|----|------|-------|
| W6 | SupervisorAgent | `supervisor-agent.ts` |
| W6 | 成本追踪模型 + Dashboard 图表 | `cost-log.service.ts` |
| W7 | Chat 页面推理过程面板 | `AgentThoughtPanel.tsx` |
| W7 | 文档更新 + 发布 | README / docs/ |

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| ReAct 循环导致响应变慢 | 用户体验下降 | 严格超时控制（单轮 5s，总计 30s），超时 fallback 到当前路由模式 |
| LLM 反复调用工具不结束 | Token 浪费、超时 | 最大轮数限制 + 检测重复 tool call 自动终止 |
| 工具调用失败影响整体 | 答案不完整 | 单工具 try-catch，失败记录到 trace，继续执行其他工具 |
| 记忆注入导致 prompt 过长 | Token 超限、成本高 | 动态摘要 + 截断策略，超出 context window 时自动压缩 |
| 前端渲染大量 trace 数据 | 页面卡顿 | 分页加载 + 虚拟滚动，trace 详情走懒加载 |

---

## 7. 不在范围内（未来考虑）

- **长时任务**：异步任务队列（Celery/RQ 风格），处理耗时 > 60s 的操作
- **多模态输入**：图片/语音理解（需接入视觉模型）
- **Agent 市场**：用户可分享/导入自定义 Agent 配置
- **持久化人格**：不同用户有不同的 Agent 行为风格
- **自主学习**：从用户反馈中自动优化路由规则权重
