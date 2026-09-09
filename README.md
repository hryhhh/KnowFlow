# KnowBase X

> 以 Agent 为核心的智能应用系统：支持自主推理、工具调用、知识检索与多步任务执行，为业务场景提供可扩展的 AI 应用框架。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-8%2B-lightgrey.svg)](https://pnpm.io/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

---

## 为什么需要 Agent

传统 RAG 问答系统面临三个根本性局限：

1. **单步思维** — 用户提问后只做"检索 → 回答"一次调用，无法处理需要多步推理的任务
2. **被动执行** — 系统无法自主决定用什么方式获取信息，只能按预设路径运行
3. **知识孤立** — 答案仅来源于向量检索，无法调用数据库、联网搜索或外部 API 补充信息

Agent 系统的本质，是让 LLM 从"被动的回答者"变为"主动的问题解决者"：自主理解意图 → 规划行动 → 调用工具获取信息 → 合成答案。

KnowBase X 正是在这一理念上构建的 Agent 应用平台。

---

## 项目定位

这是一个 **Agent 应用框架**，而非单纯的 RAG 系统。RAG（知识库检索）只是 Agent 可调用的众多能力之一。

```
Agent 的能力体系
├── Task Understanding   意图识别与任务路由
├── Reasoning            ReAct 循环：推理 → 行动 → 观察 → 再推理
├── Tool Calling         内置 / 自定义工具调用
│   ├── RagSearchTool      知识库检索（RAG 能力）
│   ├── DbQueryTool        参数化 SQL 查询
│   ├── WebSearchTool      联网搜索
│   ├── ReadFileTool       读取本地文件
│   └── CallHttpApiTool    外部 HTTP API 调用
├── Knowledge Retrieval  RAG 引擎（切片 / Embedding / 向量存储 / 多路检索 / 融合）
├── Memory               对话历史注入与上下文管理
├── Observability        Trace 记录、Token 统计、SSE 事件流
└── Quality Guardrails   Faithfulness 校验 + 检索质量闸门（可灰度启用）
```

**两种运行时模式，同一套入口：**

| 模式 | 环境变量 | 适用场景 |
| --- | --- | --- |
| **AgentRuntime**（自主推理） | `AGENT_RUNTIME_ENABLED=true` | 多步任务、复杂查询、需组合多种信息来源 |
| **Orchestrator**（路由编排） | `AGENTS_ENABLED=true` | 意图明确、需并行调用多个专用 Agent |
| 传统 RAG（降级） | 不启用 Agent 开关 | 简单问答、低延迟场景 |

---

## Agent 核心能力

### 1. AgentRuntime — ReAct 自主推理循环

启用 `AGENT_RUNTIME_ENABLED=true` 后，系统进入自主 Agent 模式：LLM 每轮自主决定调用哪些工具、调用几次，直到给出最终答案。

```
[Round 1] LLM 推理
  思考："用户问本月新增客户数量，我需要查数据库"
  → 调用 tool: query_database({ sql: "..." })

[Round 2] LLM 推理
  思考："数据已获取，直接回答问题"
  → 返回最终答案（无工具调用）
```

关键实现细节：

- **ReAct 循环** 在 [packages/agents/src/runtime/react-loop.ts](packages/agents/src/runtime/react-loop.ts) 实现
- **消息历史** 遵循 OpenAI tool calling 协议格式（`tool_calls` + `tool` 角色消息）
- **截断收尾**：达到最大轮数时发起一次不带工具的收尾调用，让 LLM 基于已检索资料作答，而非直接输出原始工具结果
- **流式输出**：默认开启（`AGENT_LLM_STREAMING=true`），每轮 LLM 的 content 分片实时推送，前端可看到"边思考边输出"的体验
- **超时控制**：单轮 15s、整体 30s（均可通过环境变量调节），429/5xx 自动重试 1 次

### 2. 工具系统（Tool Calling）

Agent 通过标准 OpenAI tool calling 协议调用工具。框架内置 5 个工具：

#### 2.1 RagSearchTool — 知识库检索

在向量数据库中检索相关文档片段，是 Agent 获取内部知识的唯一通道：

```typescript
// Agent 可自主调整检索参数
await tool.execute({ query: "本季度营收", topK: 5, minScore: 0.3 })
// 返回： "[1] ...[2] ...[3] ..." + sources 引用列表
```

检索质量闸门（A3）在工具层也生效：当检索结果 top1 分数低于阈值时，工具返回 `lowQuality` 标记，Agent 据此决定是否换问法重试。

#### 2.2 DbQueryTool — 参数化 SQL 查询

通过预定义 SQL 模板安全地查询业务数据库，防止直接执行任意 SQL：

```typescript
// config/db-queries.yml 中预定义的模板
{ id: "new_customers", sql: "SELECT count(*) FROM customers WHERE created_at > $1" }
await tool.execute({ queryId: "new_customers", params: ["2024-01-01"] })
```

#### 2.3 WebSearchTool — 联网搜索

支持 Tavily / Serper 两个 Provider，扩展 Agent 的知识边界：

```bash
WEB_SEARCH_PROVIDER=tavily
WEB_SEARCH_API_KEY=xxx
```

#### 2.4 ReadFileTool — 读取本地文件

允许 Agent 读取上传的附件内容，用于基于文件内容的问答：

#### 2.5 CallHttpApiTool — 外部 API 调用

通过域名白名单（`API_CALL_ALLOWED_DOMAINS`）安全调用外部 HTTP 接口。

#### 工具注册表

所有工具通过 `ToolRegistry` 统一注册，运行时动态暴露给 LLM：

```typescript
const registry = new ToolRegistry();
registry.register(new RagSearchTool(retrieveFn));
registry.register(new DbQueryTool(dbService));
// ...
// LLM 通过 registry.getAllDefinitions() 获取所有工具描述
```

### 3. 意图理解与路由

系统通过 `IntentRouter` 对用户查询做意图分类，决定由哪个 Agent 处理：

```
用户问题
    │
    ▼
IntentRouter（正则优先级匹配）
    │
    ├─ 命中规则且 priority ≥ 阈值 → 直接路由
    ├─ 命中但 priority 低于阈值 → LLM 置信度仲裁（500ms 超时）
    └─ 无匹配规则 → LLM 兜底意图分类
```

路由规则通过 YAML 文件配置，支持热重载（无需重启服务）。

**示例规则**（[config/router.rules.yml](config/router.rules.yml)）：

| 规则 ID | 关键词模式 | 目标 Agent | 优先级 |
| ------- | --------- | ---------- | ------ |
| `kb-docs-strict` | 文档内容、资料内容 | ragflow | 100 |
| `db-stats` | 多少 / 统计 + 客户等实体 | db-query | 90 |
| `web-news` | 新闻、动态、热点 | web-search | 80 |
| `ragflow-soft` | 有没有知识 | ragflow | 30 |

### 4. 知识检索（RAG 引擎）

RAG 引擎（[packages/rag-engine](packages/rag-engine/src/)）是 Agent 的知识获取基础，提供以下能力：

**文档摄入**：支持 PDF / Word / CSV / XLSX 格式，MinerU 云端解析（默认）或自托管 CPU/GPU 双模式，BullMQ 异步 Worker 处理解析 / 切片 / 向量化全流程。

**多路检索**：三种检索模式可选，通过 `retrievalMode` 参数切换：
- `vector` — 向量相似度检索（默认）
- `keyword` — BM25 / ts_rank 全文检索
- `hybrid` — 向量 + 全文双路，支持 RRF 或线性加权融合

**质量护栏**（默认关闭，A1 评测标定后灰度上线）：
- **Faithfulness（A2）**：答案事实校验，拆解原子陈述逐条核对参考资料，通过 SSE `faithfulness` 事件推送 `{ score, claims }`
- **检索质量闸门（A3）**：结果为空或 top1 低于阈值时跳过 LLM，直接返回拒答文案
- **稀疏分归一化（A5）**：让 keyword + hybrid+RRF 模式的分数映射到 [0,1]，参与 A3 闸门判定

**Temperature 收紧（A4）**：RAG 链路 LLM 默认 temperature 从 0.7 降至 0.1（`DEFAULT_LLM_TEMPERATURE` 可调），降低幻觉与发散。

### 5. 对话记忆

`ConversationMemory` 自动注入最近 N 条历史消息到 Agent 的上下文窗口：

```bash
AGENT_MEMORY_MAX_MESSAGES=6   # 默认：最近 3 轮对话（user + assistant 各 3 条）
```

记忆从 `session_messages` 表加载，会话级别隔离；匿名请求（无 sessionId）直接跳过。

### 6. 可观测性

每次 Agent 执行都生成完整 Trace，贯穿意图识别 → 工具调用 → 最终答案的全链路：

- **全局 trace_id** 注入，`usage_logs` 调用统计与执行详情关联
- **结构化 Trace 表**（`agent_traces`）：记录每轮 LLM 调用的 token 用量、工具调用序列、最终答案
- **前端 Agent Activity 面板**：Chat 页实时展示 `tool_call` / `tool_result` / `reasoning_summary` 等事件流
- **Trace 详情页**：`GET /api/agents/traces/:id` 查询，`/traces/:traceId` 前端路由

---

## 整体架构

```
                    ┌─────────────────────────────────────┐
                    │         用户提问（SSE 流式）           │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │         AgentChatService             │
                    │   （双路径分流，统一 SSE 出口）        │
                    └───┬───────────────────────┬─────────┘
                        │                       │
              AGENT_RUNTIME_ENABLED            AGENTS_ENABLED
              = true (自主 Agent)          = true (路由编排)
                        │                       │
          ┌─────────────▼──────────┐  ┌────────▼───────────────┐
          │     AgentRuntime        │  │     Orchestrator        │
          │   ReAct 推理循环         │  │   路由 → 调度 → 合成     │
          │                         │  │                         │
          │  ┌─────────────────┐   │  │  IntentRouter           │
          │  │  ReactLoop      │   │  │  (YAML 规则 + LLM 仲裁)  │
          │  │  - LLM 推理     │   │  └──────────┬──────────────┘
          │  │  - 工具选择     │   │             │
          │  │  - 结果观察     │   │  ┌──────────▼──────────────┐
          │  │  - 继续循环     │   │  │     Dispatcher           │
          │  │  - 截断收尾     │   │  │  (并行执行，默认 30s)    │
          │  └────────┬────────┘   │  └──────────┬──────────────┘
          │           │            │             │
          │  ┌────────▼────────┐   │  ┌──────────▼──────────────┐
          │  │  ToolRegistry   │   │  │  Agent: ragflow          │
          │  │  - rag_search   │   │  │  Agent: db-query         │
          │  │  - db_query     │   │  │  Agent: web-search       │
          │  │  - web_search   │   │  └──────────┬──────────────┘
          │  │  - read_file    │   │             │
          │  │  - call_http    │   │  ┌──────────▼──────────────┐
          │  └────────┬────────┘   │  │  Compose                 │
          │           │            │  │  rag-priority / concat   │
          │  ┌────────▼────────┐   │  └─────────────────────────┘
          │  │  Conversation   │   │
          │  │  Memory         │   │
          │  └─────────────────┘   │
          └───────────┬────────────┘
                      │
          ┌───────────▼────────────┐
          │     RAG Engine          │
          │  (multi-mode retrieval │
          │   + fusion + rerank)   │
          └────────────────────────┘
                      │
          ┌───────────▼────────────┐
          │   PostgreSQL / pgvector│
          │   + Redis (BullMQ)     │
          └────────────────────────┘
```

---

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | React 19 + Vite + Zustand（图表 @ant-design/charts） |
| 后端 | NestJS 11 (Express) + TypeORM + PostgreSQL/pgvector |
| Agent 引擎 | `packages/agents` — IntentRouter / Orchestrator / AgentRuntime / ToolRegistry / ReactLoop / ConversationMemory |
| RAG 引擎 | `packages/rag-engine` — 加载/切片/Embedding/向量存储/多路检索/融合/重排 |
| 文档解析 | MinerU（云端 Agent API 默认；可选自托管 CPU/GPU） |
| 任务队列 | BullMQ（Redis backend）— 异步文档摄入 Worker |
| 基础设施 | Docker Compose: PostgreSQL 16 + pgvector, Redis 8 |

---

## 快速开始

### 环境要求

- Node.js >= 18（推荐 22）
- pnpm >= 8
- Docker & Docker Compose

### 一键启动

```bash
# 1. 复制并编辑环境变量
cp .env.example .env
# 必填：LLM_API_KEY、LLM_BASE_URL、LLM_MODEL、EMBEDDING_MODEL、EMBEDDING_DIMENSIONS

# 2. 启动基础设施（PGVector + Redis + 可选 MinerU）
pnpm infra:up
docker compose --profile mineru-cpu up -d   # 可选：MinerU 文档解析（CPU）

# 3. 安装依赖 & 启动开发服务
pnpm install
pnpm start:dev         # 构建 RAG 引擎 + 启动后端 (:3000)
pnpm start:frontend    # 另开终端：启动前端 (:5173)

# 4.（可选）启动异步摄入 Worker
pnpm --filter @knowbase-x/server start:worker:dev
```

访问 http://localhost:5173

> MinerU 解析策略默认走云端 Agent API（`mineru-agent`），无需启动本地服务。

---

## 使用示例

### 场景一：简单问答（传统 RAG）

不启用任何 Agent 开关，系统自动降级为单链路 RAG，适合简单的知识查询：

```bash
# 不设置 AGENTS_ENABLED，直接问答
curl -N -X POST http://localhost:3000/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"query": "本季度的营收是多少？", "kbId": "xxx"}'
```

### 场景二：多 Agent 路由编排

```bash
AGENTS_ENABLED=true
AGENT_COMPOSE_STRATEGY=rag-priority
WEB_SEARCH_PROVIDER=tavily
WEB_SEARCH_API_KEY=xxx
```

用户提问"本月新增客户多少" → IntentRouter 匹配 `db-stats` 规则 → DbQueryAgent 执行 SQL → 结果与 RAG 并行返回 → rag-priority 策略优先采信数据库精确数字。

### 场景三：自主 Agent 推理（推荐）

```bash
AGENTS_ENABLED=true
AGENT_RUNTIME_ENABLED=true
AGENT_REACT_MAX_ROUNDS=5
```

用户提问"帮我查一下上个月销售额最高的一批客户，把他们的联系方式整理成表格"：

```
[Round 1] LLM 思考：需要先查销售数据，调用 query_database
[Round 2] LLM 思考：拿到数据后还要查客户联系方式，再调用 query_database
[Round 3] LLM 思考：信息已充分，直接输出整理后的表格
```

全程 SSE 实时推送 `tool_call` / `tool_result` / `token` 事件，前端 Agent Activity 面板实时更新。

---

## 环境变量配置

参考 [.env.example](.env.example)，核心开关与参数：

### 必填项

| 变量 | 说明 |
| --- | --- |
| `LLM_API_KEY` | LLM API 密钥 |
| `LLM_BASE_URL` | OpenAI 兼容接口地址 |
| `LLM_MODEL` | 模型名称（如 qwen3.7-plus） |
| `EMBEDDING_MODEL` | Embedding 模型 |
| `EMBEDDING_DIMENSIONS` | 向量维度（需与模型一致） |
| `DATABASE_PASSWORD` | PostgreSQL 密码 |

### Agent 开关

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `AGENTS_ENABLED` | 启用多 Agent 能力 | `false` |
| `AGENT_RUNTIME_ENABLED` | 启用自主 Agent Runtime（ReAct） | `false` |
| `AGENT_REACT_MAX_ROUNDS` | ReAct 最大推理轮数 | `5` |
| `AGENT_RUNTIME_TIMEOUT_MS` | Runtime 整体超时 | `30000` |
| `AGENT_MEMORY_MAX_MESSAGES` | 注入对话历史的最大消息数 | `6` |
| `AGENT_TRACE_ENABLED` | 持久化 Agent 执行 Trace | `false` |
| `AGENT_RUNTIME_FALLBACK` | Runtime 失败时回退路由链路 | `true` |
| `AGENT_LEGACY_TOOLS_ENABLED` | 将旧 Agent 经适配器注册为工具 | `false` |
| `AGENT_LLM_STREAMING` | 是否开启 LLM 流式调用 | `true` |
| `AGENT_TRUNCATED_FINALIZE` | 达最大轮数后是否做收尾调用 | `true` |

### 路由与编排

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `AGENT_COMPOSE_STRATEGY` | 合成策略：`rag-priority` / `concat` / `llm-summarize` | `rag-priority` |
| `ROUTER_RULES_PATH` | 路由规则文件路径（默认读仓库根目录 `config/router.rules.yml`） | — |

### 工具配置

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `API_CALL_ALLOWED_DOMAINS` | `call_http_api` 域名白名单（逗号分隔） | — |
| `WEB_SEARCH_PROVIDER` | 联网搜索 Provider：`tavily` / `serper` | — |
| `WEB_SEARCH_API_KEY` | 搜索 API 密钥 | — |

### RAG 质量护栏（默认全部关闭）

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `DEFAULT_LLM_TEMPERATURE` | RAG 链路 LLM 温度 × 10（1 = 0.1） | `1` |
| `FAITHFULNESS_ENABLED` | A2 事实校验总开关 | `false` |
| `FAITHFULNESS_MODE` | A2 模式：`annotate`（仅标注）/ `gate`（低分拒答） | `annotate` |
| `FAITHFULNESS_MIN_SCORE` | A2 gate 拒答阈值 | `0.8` |
| `FAITHFULNESS_TIMEOUT_MS` | A2 校验超时（毫秒） | `3000` |
| `RETRIEVAL_QUALITY_GATE_ENABLED` | A3 检索质量闸门总开关 | `false` |
| `RETRIEVAL_QUALITY_GATE_THRESHOLD` | A3 top1 分数阈值 | `0.35` |
| `RETRIEVAL_SPARSE_SCORE_NORMALIZATION` | A5 稀疏分归一化（配合 A3） | `false` |

> 完整清单与校验入口见 [apps/server/src/config/env.ts](apps/server/src/config/env.ts)。

---

## 项目目录结构

```
knowbase-x/
├── apps/
│   ├── frontend/            # React 19 + Vite SPA
│   └── server/              # NestJS 后端
│       ├── modules/
│       │   ├── agents/      # AgentChatService（双路径入口）、路由、Trace、Cache
│       │   ├── chat/        # 传统 RAG 问答链路
│       │   ├── session/     # 会话管理与对话记忆
│       │   └── ...
│       └── config/          # 配置校验（env.ts）、RAG 配置注入
├── packages/
│   ├── agents/              # Agent 引擎核心
│   │   ├── src/
│   │   │   ├── runtime/     # AgentRuntime / ReactLoop / AgentContext
│   │   │   ├── router/      # IntentRouter（YAML 规则 + LLM 仲裁）
│   │   │   ├── tools/       # ToolRegistry + 5 个内置工具
│   │   │   ├── memory/      # ConversationMemory
│   │   │   ├── observability/# TraceCollector
│   │   │   └── orchestrator.ts  # Orchestrator（路由→调度→合成）
│   │   └── src/agents/      # RAGFlowAgent / DbQueryAgent / WebSearchAgent
│   ├── rag-engine/          # RAG 引擎
│   │   ├── src/
│   │   │   ├── loaders/     # 文档加载（PDF/Word/CSV/XLSX）
│   │   │   ├── splitters/   # 智能切片（递归 / Markdown / 语义）
│   │   │   ├── embeddings/  # Embedding 接口
│   │   │   ├── stores/      # pgvector / sparse-store / memory-store
│   │   │   ├── retrievers/  # vector / keyword / hybrid 三路检索
│   │   │   ├── fusion/      # RRF / 线性加权融合
│   │   │   ├── rerankers/   # Bi-encoder / Cross-encoder 重排
│   │   │   ├── llm/         # LLM 调用 + Faithfulness 校验
│   │   │   ├── pipeline.ts  # retrieveAndChat 主管线
│   │   │   └── retrieval-gate.ts  # 检索质量闸门（A3）
│   │   └── src/cache/       # 检索结果缓存
├── config/
│   ├── router.rules.yml     # 意图路由规则（正则优先级，支持热重载）
│   ├── compose.prompts.yml  # 结果合成策略 Prompt 模板
│   └── db-queries.yml       # DB Query 参数化 SQL 模板
├── docker/
│   ├── Dockerfile.server    # 后端生产镜像
│   └── Dockerfile.frontend  # 前端 Nginx 镜像
├── db/init.sql              # 数据库初始化（pgvector 扩展）
├── docs/                    # 设计文档
├── .env.example             # 环境变量模板
├── docker-compose.yml       # 基础设施编排
└── pnpm-workspace.yaml
```

---

## 核心 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/knowledge-bases` | 知识库列表 / 创建 |
| GET/POST/DELETE | `/api/knowledge-bases/:kbId/documents` | 文档管理（上传即异步摄入） |
| POST | `/api/retrieval/search` | 知识检索（vector/keyword/hybrid） |
| POST(SSE) | `/api/chat/stream` | 传统 RAG 问答（流式） |
| POST(SSE) | `/api/agents/routeStream` | Agent 路由编排（流式） |
| POST | `/api/agents/route` | Agent 路由（同步） |
| POST | `/api/agents/rules/reload` | 热重载路由规则 |
| GET | `/api/agents/traces?kbId=&limit=` | Agent Trace 列表 |
| GET | `/api/agents/traces/:id` | Agent Trace 详情（含执行步骤） |
| POST(SSE) | `/api/service-calls/:svcId/chat/stream` | 外部服务调用（Bearer API Key） |

### SSE 事件类型

| 事件名 | 内容 |
| --- | --- |
| `token` | LLM 输出分片（流式答案实时推送） |
| `sources` | 引用来源列表 `[{ content, sourceFile, score }]` |
| `done` | 问答完成 |
| `error` | 错误信息 |
| `trace` | 链路 trace_id |
| `agent_start` / `agent_completed` | Agent 生命周期事件 |
| `tool_call` / `tool_result` | 工具调用前后（Runtime 模式） |
| `reasoning_summary` | LLM 推理说明文本（截断 200 字符，Runtime 模式） |
| `answer_delta` / `answer_reset` | 答案流式分片 / 工具轮次后重置（Runtime 模式） |
| `faithfulness` | A2 事实校验结果 `{ score, claims }`（仅 `FAITHFULNESS_ENABLED=true`） |
| `session_id` | 本次会话 ID |

---

## 扩展与二次开发

### 添加自定义工具

在 `packages/agents/src/tools/` 下新建工具类，实现 `Tool` 接口：

```typescript
import { Tool, ToolContext, ToolResult } from '@knowbase-x/agents';

export class MyCustomTool implements Tool {
  readonly name = 'my_tool';
  readonly description = '我的自定义工具';
  readonly parameters = { type: 'object', properties: { ... }, required: ['param'] };

  async execute(args: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    // 实现业务逻辑
    return { toolCallId: '', content: '结果', isError: false };
  }
}

// 注册
const registry = new ToolRegistry();
registry.register(new MyCustomTool());
```

### 添加路由规则

编辑 [config/router.rules.yml](config/router.rules.yml)，修改后服务自动热重载（最长 30 秒），也可手动触发 `POST /api/agents/rules/reload`。

### 调整质量护栏阈值

在 `.env` 中覆盖默认值（见[环境变量配置](#环境变量配置)章节）。建议先关闭护栏验证基线行为，再通过 A1 评测标定阈值后灰度开启。

### 接入自定义 Embedding 模型

继承 `packages/rag-engine/src/embeddings/` 下的接口，替换 `getEmbeddings` 实现即可。

---

## Roadmap

| 阶段 | 目标 | 状态 |
| --- | --- | --- |
| Phase 1 | 质量护栏：Faithfulness 校验、检索质量闸门、Temperature 收紧、稀疏分归一化 | ✅ 已完成 |
| Phase 2 | 评测体系：Golden Set、Agent 评测 Runner、指标 Dashboard | 🔄 进行中 |
| Phase 3 | Agent 生态：更多内置工具、外部服务集成、插件机制 | 📋 规划中 |

详细设计见 [docs/18-agent-prd-quality-guardrails.md](docs/18-agent-prd-quality-guardrails.md)。

---

## 文档

- [项目总览](docs/01-project-overview.md)
- [服务端设计](docs/02-server-design.md)
- [前端设计](docs/03-frontend-design.md)
- [RAG 引擎设计](docs/04-rag-engine-design.md)
- [部署方案](docs/05-deployment.md)
- [自托管 MinerU](docs/06-self-hosted-mineru.md)
- [混合检索设计](docs/07-hybrid-retrieval.md)
- [Agent 系统总览（Tool / Runtime / 可观测）](docs/12-agent-upgrade-overview.md)
- [RAG 待优化点清单](docs/17-rag-optimizations.md)
- [Agent PRD — 质量护栏与评测（A1~A5）](docs/18-agent-prd-quality-guardrails.md)

## 贡献指南

1. Fork 本仓库并创建特性分支 (`git checkout -b feat/your-feature`)
2. 遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范提交
3. 运行 `pnpm build` 确保构建通过
4. 提交 PR 并描述变更内容与原因

代码规范详见 [AGENTS.md](AGENTS.md)。

## 许可证

[ISC](LICENSE)
