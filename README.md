# KnowBase X

> 基于多智能体编排的企业级 RAG 平台：文档上传 → 智能切片 → 向量检索 → 多源问答 → API 服务化。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-8%2B-lightgrey.svg)](https://pnpm.io/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

## 目录

- [特性](#特性)
- [架构概览](#架构概览)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [环境变量配置](#环境变量配置)
- [多 Agent 编排](#多-agent-编排)
- [核心 API](#核心-api)
- [生产部署](#生产部署)
- [文档](#文档)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

---

## 特性

- **多智能体编排** — IntentRouter 自动路由查询到 RAG / DB Query / Web Search，支持并行执行与结果融合
- **自主 Agent Runtime** — ReAct 循环 + 工具调用（`AGENT_RUNTIME_ENABLED=true`），LLM 自主决定调用哪些工具、调用几次，支持多步推理与对话记忆
- **内置工具系统** — `rag_search` / `query_database` / `web_search` / `read_file` / `call_http_api` 五个内置工具，支持 Legacy Agent 降级适配
- **Agent 可观测性** — 结构化 Trace（`agent_traces` 表 + Trace 查询 API + 前端 Trace 详情页）、Chat 页实时 Agent Activity 面板（tool_call / tool_result 事件流）
- **RAG 知识库** — 支持 PDF / Word / CSV / XLSX 文档加载、智能切片、向量化与相似度检索
- **异步文档摄入** — BullMQ Worker 架构，解析/切片/向量化在独立进程执行，带进度追踪、重试与幂等
- **MinerU 文档解析** — 云端 Agent API（默认）或自托管 CPU/GPU 双模式
- **流式响应** — SSE 流式返回，支持 trace_id / tool_call / agent_start / sources / token 等事件
- **可配置路由** — 基于正则优先级的路由规则文件，支持热重载
- **开箱即用** — Docker Compose 一键启动 PostgreSQL + pgvector + Redis 基础设施

## 架构概览

```
用户提问
    │
    ▼
AgentChatService（双链路，按 AGENT_RUNTIME_ENABLED 分流）
    │
    ├─ AgentRuntime 链路（AGENT_RUNTIME_ENABLED=true）
    │   ├── ConversationMemory 注入对话历史
    │   └── ReAct 循环：LLM 推理 ⇄ 工具调用，直到产出最终答案
    │       ├─ rag_search      知识库检索
    │       ├─ query_database  参数化 SQL 查询
    │       ├─ web_search      Tavily/Serper 联网搜索
    │       ├─ read_file       读取上传文件
    │       └─ call_http_api   外部 HTTP API（域名白名单）
    │
    └─ 路由链路（Legacy，默认）
        │
        IntentRouter (router.rules.yml)
            │  正则匹配 → 优先级排序 → 低置信度时 LLM 仲裁
            ├─ ragflow     → RAGFlowAgent      (知识库检索)
            ├─ db-query    → DbQueryAgent      (参数化 SQL 查询)
            └─ web-search  → WebSearchAgent    (Tavily/Serper 联网搜索)
            │
            ▼
        Dispatcher  (并行执行，默认超时 30s)
            │
            ▼
        Compose  (rag-priority | concat | llm-summarize)
    │
    ▼
SSE 流式返回 → 前端渲染 + Agent Activity 面板
    │
    ▼
可观测：usage_logs 调用统计 + agent_traces 执行详情（Trace API / Trace 详情页）
```

### 路由规则示例

| 规则             | 匹配关键词                     | 目标 Agent | 优先级 |
| ---------------- | ------------------------------ | ---------- | ------ |
| `kb-docs-strict` | 文档内容、资料内容、知识是什么 | ragflow    | 100    |
| `db-stats`       | 多少/统计 + 客户/员工/订单等   | db-query   | 90     |
| `web-news`       | 新闻、动态、热点               | web-search | 80     |
| `ragflow-soft`   | 有没有知识、怎么查             | ragflow    | 30     |

> 完整规则见 [config/router.rules.yml](config/router.rules.yml)。  
> 关键设计：`db-stats` 使用正向断言确保"多少"后紧跟业务实体词才触发，避免误路由。

## 技术栈

| 层级       | 技术                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| 前端       | React 19 + Vite + Zustand（图表用 @ant-design/charts）                                                |
| 后端       | NestJS 11 (Express) + TypeORM + PostgreSQL/pgvector                                                   |
| RAG 引擎   | `packages/rag-engine` — 加载/切片/Embedding/向量存储/检索                                             |
| Agent 引擎 | `packages/agents` — IntentRouter / Orchestrator / ToolRegistry / AgentRuntime(ReAct) / TraceCollector |
| 文档解析   | MinerU（云端 Agent API 默认；可选自托管 CPU/GPU）                                                     |
| 任务队列   | BullMQ（Redis backend）— 异步文档摄入 Worker                                                          |
| 基础设施   | Docker Compose: PostgreSQL 16 + pgvector, Redis 8                                                     |

## 项目结构

```
knowbase-x/
├── apps/
│   ├── frontend/            # React 19 + Vite SPA
│   └── server/              # NestJS 后端 API
├── packages/
│   ├── rag-engine/          # RAG 核心引擎（切片/Embedding/检索）
│   └── agents/              # Agent 引擎（路由/调度/合成 + tools/ + runtime/ + observability/）
├── config/
│   ├── router.rules.yml     # 意图路由规则（正则优先级匹配）
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
pnpm infra:up                         # 基础服务
docker compose --profile mineru-cpu up -d   # 可选：MinerU 文档解析（CPU）

# 3. 安装依赖 & 启动开发服务
pnpm install
pnpm start:dev         # 构建 RAG 引擎 + 启动后端 (:3000)
pnpm start:frontend    # 另开终端：启动前端 (:5173)

# 4.（可选）启动异步摄入 Worker（独立进程，文档解析/切片/向量化）
pnpm --filter @knowbase-x/server start:worker:dev
```

访问 http://localhost:5173

> 提示：MinerU 解析策略默认走云端 Agent API（`mineru-agent`），无需启动本地服务；仅当选择自托管策略 `mineru` 时才需要上面的 `--profile mineru-cpu`。

## 环境变量配置

参考 [.env.example](.env.example)，主要配置项：

| 变量                         | 说明                                                  | 必填 |
| ---------------------------- | ----------------------------------------------------- | ---- |
| `LLM_API_KEY`                | LLM API 密钥                                          | ✅   |
| `LLM_BASE_URL`               | OpenAI 兼容接口地址                                   | ✅   |
| `LLM_MODEL`                  | 模型名称（如 qwen3.7-plus）                           | ✅   |
| `EMBEDDING_MODEL`            | Embedding 模型                                        | ✅   |
| `EMBEDDING_DIMENSIONS`       | 向量维度（需与模型一致）                              | ✅   |
| `DATABASE_PASSWORD`          | PostgreSQL 密码                                       | ✅   |
| `AGENTS_ENABLED`             | 启用多 Agent 编排（`true`/`false`）                   | ❌   |
| `AGENT_COMPOSE_STRATEGY`     | 组合策略：`rag-priority` / `concat` / `llm-summarize` | ❌   |
| `AGENT_RUNTIME_ENABLED`      | 启用自主 Agent Runtime（ReAct + 工具调用）            | ❌   |
| `AGENT_REACT_MAX_ROUNDS`     | ReAct 最大推理轮数（默认 5）                          | ❌   |
| `AGENT_RUNTIME_TIMEOUT_MS`   | Runtime 整体超时（默认 30000ms）                      | ❌   |
| `AGENT_MEMORY_MAX_MESSAGES`  | 注入对话历史的最大消息数（默认 6）                    | ❌   |
| `AGENT_TRACE_ENABLED`        | 持久化 Agent 执行 Trace（`agent_traces` 表）          | ❌   |
| `AGENT_RUNTIME_FALLBACK`     | Runtime 失败时回退路由链路（默认 `true`）             | ❌   |
| `AGENT_LEGACY_TOOLS_ENABLED` | 将旧 Agent 经适配器注册为工具                         | ❌   |
| `API_CALL_ALLOWED_DOMAINS`   | `call_http_api` 域名白名单（逗号分隔）                | ❌   |
| `WEB_SEARCH_PROVIDER`        | 联网搜索 Provider：`tavily` / `serper`                | ❌   |
| `WEB_SEARCH_API_KEY`         | 搜索 API 密钥                                         | ❌   |
| `MINERU_AGENT_API_BASE_URL`  | MinerU 云端 Agent API 端点（默认解析策略）            | ❌   |

> 完整清单与默认值见 [.env.example](.env.example)，统一校验入口为 `apps/server/src/config/env.ts`。

## 多 Agent 编排

### 1. 路由模式（Legacy，默认链路）

在 `.env` 中配置即可启用：

```bash
AGENTS_ENABLED=true
AGENT_COMPOSE_STRATEGY=rag-priority
WEB_SEARCH_PROVIDER=tavily
WEB_SEARCH_API_KEY=xxx
```

IntentRouter 按正则规则路由 → Dispatcher 并行执行 → rag-priority 合成（优先采信 RAG 结果，其他 Agent 作补充）。未启用 `AGENTS_ENABLED` 时自动降级为传统单链路 RAG。

> 规则文件默认自动解析到仓库根目录的 `config/router.rules.yml`（支持热重载，改文件即生效，也可 `POST /api/agents/rules/reload` 手动触发），无需再设置 `ROUTER_RULES_PATH`。

### 2. 自主 Agent Runtime（ReAct + 工具调用）

```bash
AGENT_RUNTIME_ENABLED=true
```

启用后，LLM 通过 tool calling **自主决定**调用哪些工具、调用几次，多轮推理直到给出最终答案：

- 内置 5 个工具：`rag_search`（知识库检索）、`query_database`（参数化 SQL）、`web_search`（联网搜索）、`read_file`（读取上传文件）、`call_http_api`（外部 API，域名白名单防护）
- 对话记忆：自动注入最近 `AGENT_MEMORY_MAX_MESSAGES`（默认 6）条历史消息
- 双重护栏：`AGENT_REACT_MAX_ROUNDS`（默认 5 轮）+ `AGENT_RUNTIME_TIMEOUT_MS`（默认 30s）
- 平滑降级：Runtime 失败且 `AGENT_RUNTIME_FALLBACK=true`（默认）时自动回退到路由链路，不中断用户请求

### 3. 可观测性（Trace）

```bash
AGENT_TRACE_ENABLED=true
```

- 全局 trace_id 注入，`usage_logs` 调用统计与执行详情关联
- 每轮 LLM 调用 / 工具调用 / 最终答案持久化到 `agent_traces` 表（JSONB steps + token 用量）
- 前端 Chat 页内嵌 **Agent Activity 实时面板**（tool_call / tool_result / agent_completed 事件流）
- Trace 详情页 `/traces/:traceId`，或通过 API 查询：`GET /api/agents/traces/:id`

## 核心 API

| 方法            | 路径                                    | 说明                              |
| --------------- | --------------------------------------- | --------------------------------- |
| GET/POST        | `/api/knowledge-bases`                  | 知识库列表 / 创建                 |
| GET/POST/DELETE | `/api/knowledge-bases/:kbId/documents`  | 文档管理（上传即异步摄入）        |
| GET             | `/api/knowledge-bases/:kbId/chunks`     | 切片列表                          |
| POST            | `/api/retrieval/search`                 | 知识检索（vector/keyword/hybrid） |
| POST(SSE)       | `/api/chat/stream`                      | 知识问答（流式，双链路自动分流）  |
| POST(SSE)       | `/api/agents/routeStream`               | Agent 路由（流式）                |
| POST            | `/api/agents/route`                     | Agent 路由（同步，非流式）        |
| POST            | `/api/agents/rules/reload`              | 热重载路由规则                    |
| GET             | `/api/agents/traces?kbId=&limit=`       | Agent Trace 列表                  |
| GET             | `/api/agents/traces/:id`                | Agent Trace 详情（含执行步骤）    |
| POST(SSE)       | `/api/service-calls/:svcId/chat/stream` | 外部服务调用（Bearer API Key）    |

> SSE 事件类型：
>
> - 基础：`sources` / `token` / `done` / `error`
> - 路由链路（`AGENTS_ENABLED=true`）：`trace_id` / `process` / `agent_start` / `agent_done` / `agent_error` 及可观测元数据事件
> - Runtime 链路（`AGENT_RUNTIME_ENABLED=true`）：`trace` / `tool_call` / `tool_result` / `agent_completed`

## 生产部署

### 方式一：Docker Compose 一键部署（推荐）

```bash
# 构建 + 启动 server / worker / frontend（postgres、redis 常驻自动带起）
docker compose --profile app up -d --build

# 生产环境运行数据库迁移（Worker 侧关闭了 synchronize）
pnpm --filter @knowbase-x/server migration:run
```

- `server`（API，端口 `SERVER_PORT` 默认 3000）与 `worker`（BullMQ 摄入进程，无 HTTP 端口）复用同一镜像 [docker/Dockerfile.server](docker/Dockerfile.server)
- `frontend` 由 [docker/Dockerfile.frontend](docker/Dockerfile.frontend) 构建（Nginx 托管静态资源，内置 `/api` 反向代理与 SSE 支持）

### 方式二：手动构建镜像

```bash
# 构建所有包
pnpm build

# 后端镜像
docker build -f docker/Dockerfile.server -t knowbase-x-server .

# 前端镜像（内置 Nginx，含 /api 反向代理与 SSE 支持）
docker build -f docker/Dockerfile.frontend -t knowbase-x-frontend .
```

## 文档

- [项目总览](docs/01-project-overview.md)
- [服务端设计](docs/02-server-design.md)
- [前端设计](docs/03-frontend-design.md)
- [RAG 引擎设计](docs/04-rag-engine-design.md)
- [部署方案](docs/05-deployment.md)
- [自托管 MinerU](docs/06-self-hosted-mineru.md)
- [混合检索设计](docs/07-hybrid-retrieval.md)
- [多 Agent 路由编排 PRD（Legacy 链路）](docs/08-agent-orchestration-v2.md)
- [Agent 系统总览（Tool / Runtime / 可观测）](docs/12-agent-upgrade-overview.md)
- [RAG 待优化点清单](docs/17-rag-optimizations.md)

## 贡献指南

1. Fork 本仓库并创建特性分支 (`git checkout -b feat/your-feature`)
2. 遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范提交
3. 运行 `pnpm build` 确保构建通过
4. 提交 PR 并描述变更内容与原因

代码规范详见 [AGENTS.md](AGENTS.md)。

## 许可证

[ISC](LICENSE)
