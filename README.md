# KnowBase X — 智能知识库平台

> 基于多智能体编排的企业级 RAG 平台：文档上传 → 智能切片 → 向量检索 → 多源问答 → API 服务化。
> 支持知识库检索（RAGFlow）、数据库查询（DB Query）、联网搜索（Web Search）三种智能体，自动路由、并行执行、结果融合。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + Vite + Ant Design + Zustand |
| 后端 | NestJS 11 (Express) + TypeORM + PostgreSQL/pgvector |
| RAG 引擎 | `packages/rag-engine` — 加载/切片/Embedding/向量存储/检索 |
| Agent 编排 | `packages/agents` — IntentRouter / Dispatcher / Compose |
| 文档解析 | MinerU（可选，CPU/GPU 双模式） |
| 基础设施 | Docker Compose: PostgreSQL 16 + pgvector, Redis 8 |

## 目录结构

```
knowbase-x/
├── apps/
│   ├── frontend/            # React 前端应用
│   └── server/              # NestJS 后端 API
├── packages/
│   ├── rag-engine/          # RAG 核心引擎（切片/Embedding/检索）
│   └── agents/              # 多 Agent 编排引擎（路由/调度/合成）
├── config/
│   ├── router.rules.yml     # 意图路由规则（正则优先级匹配）
│   ├── compose.prompts.yml  # 结果合成策略 Prompt 模板
│   └── db-queries.yml       # DB Query 参数化 SQL 模板
├── docker/
│   ├── Dockerfile.server    # 后端生产镜像
│   └── Dockerfile.frontend  # 前端 Nginx 镜像
├── db/init.sql              # 数据库初始化（pgvector 扩展）
├── docs/                    # 设计文档
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
docker compose up -d                        # 基础服务
docker compose --profile mineru-cpu up -d   # 可选：MinerU 文档解析（CPU）

# 3. 安装依赖 & 启动开发服务
pnpm install
pnpm start:dev         # 构建 RAG 引擎 + 启动后端 (:3000)
pnpm start:frontend    # 另开终端：启动前端 (:5173)
```

访问 http://localhost:5173

### 开启多 Agent 编排

在 `.env` 中配置：

```bash
# 启用 Agent 编排（默认 false，降级为传统单链路 RAG）
AGENTS_ENABLED=true

# 组合策略：rag-priority | concat | llm-summarize
AGENT_COMPOSE_STRATEGY=rag-priority

# 路由规则文件路径（默认 config/router.rules.yml）
ROUTER_RULES_PATH=./config/router.rules.yml

# 联网搜索 Provider（tavily | serper）
WEB_SEARCH_PROVIDER=tavily
WEB_SEARCH_API_KEY=xxx
```

## 架构概览

```
用户提问
    │
    ▼
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
Compose  (rag-priority 策略)
    │  RAGFlow 有效 → 优先展示 + 其他作补充
    │  RAGFlow 无效 → 回退 concat
    │
    ▼
SSE 流式返回 → 前端渲染
```

### 路由规则示例

| 规则 | 匹配关键词 | 目标 Agent | 优先级 |
|------|-----------|-----------|--------|
| `kb-docs-strict` | 文档内容、资料内容、知识是什么 | ragflow | 100 |
| `db-stats` | 多少/统计 + 客户/员工/订单等 | db-query | 90 |
| `db-list` | 列出、清单、全部 | db-query | 88 |
| `db-stat` | 趋势、排行、TopN | db-query | 85 |
| `db-person` | 学号、身份证、手机号 | db-query | 85 |
| `web-news` | 新闻、动态、热点 | web-search | 80 |
| `web-weather` | 天气、气温、降雨 | web-search | 78 |
| `ragflow-soft` | 有没有知识、怎么查 | ragflow | 30 |

> 关键设计：`db-stats` 使用正向断言 `(?=.*?(客户\|员工\|订单...))`，确保"多少"后紧跟业务实体词才触发，避免"知识库有多少文档"被误路由。

## 核心 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/knowledge-bases` | 知识库列表 / 创建 |
| GET/POST/DELETE | `/api/knowledge-bases/:kbId/documents` | 文档管理 |
| GET | `/api/knowledge-bases/:kbId/chunks` | 切片列表 |
| POST | `/api/retrieval/search` | 知识检索 |
| POST(SSE) | `/api/chat/stream` | 知识问答（流式） |
| POST(SSE) | `/api/agents/routeStream` | Agent 路由（流式） |
| GET | `/api/agents/rules/reload` | 热重载路由规则 |

> SSE 事件类型：`trace_id` / `agent_start` / `sources` / `token` / `agent_done` / `done` / `error`

## 生产部署

```bash
# 构建 RAG 引擎 + 后端
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
- [多 Agent 编排 v2 PRD](docs/09-agent-orchestration-v2.md)
