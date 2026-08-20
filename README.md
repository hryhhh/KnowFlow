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
- **RAG 知识库** — 支持 PDF / Word / CSV / XLSX 文档加载、智能切片、向量化与相似度检索
- **MinerU 文档解析** — 可选 CPU/GPU 双模式文档解析服务
- **流式响应** — SSE 流式返回，支持 trace_id / agent_start / sources / token 等事件
- **可配置路由** — 基于正则优先级的路由规则文件，支持热重载
- **开箱即用** — Docker Compose 一键启动 PostgreSQL + pgvector + Redis 基础设施

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
Compose  (rag-priority | concat | llm-summarize)
    │
    ▼
SSE 流式返回 → 前端渲染
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

| 层级       | 技术                                                      |
| ---------- | --------------------------------------------------------- |
| 前端       | React 19 + Vite + Ant Design + Zustand                    |
| 后端       | NestJS 11 (Express) + TypeORM + PostgreSQL/pgvector       |
| RAG 引擎   | `packages/rag-engine` — 加载/切片/Embedding/向量存储/检索 |
| Agent 编排 | `packages/agents` — IntentRouter / Dispatcher / Compose   |
| 文档解析   | MinerU（可选，CPU/GPU 双模式）                            |
| 基础设施   | Docker Compose: PostgreSQL 16 + pgvector, Redis 8         |

## 项目结构

```
knowbase-x/
├── apps/
│   ├── frontend/            # React 19 + Vite SPA
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
```

访问 http://localhost:5173

## 环境变量配置

参考 [.env.example](.env.example)，主要配置项：

| 变量                     | 说明                                                  | 必填 |
| ------------------------ | ----------------------------------------------------- | ---- |
| `LLM_API_KEY`            | LLM API 密钥                                          | ✅   |
| `LLM_BASE_URL`           | OpenAI 兼容接口地址                                   | ✅   |
| `LLM_MODEL`              | 模型名称（如 qwen3.7-plus）                           | ✅   |
| `EMBEDDING_MODEL`        | Embedding 模型                                        | ✅   |
| `EMBEDDING_DIMENSIONS`   | 向量维度（需与模型一致）                              | ✅   |
| `DATABASE_PASSWORD`      | PostgreSQL 密码                                       | ✅   |
| `AGENTS_ENABLED`         | 启用多 Agent 编排（`true`/`false`）                   | ❌   |
| `AGENT_COMPOSE_STRATEGY` | 组合策略：`rag-priority` / `concat` / `llm-summarize` | ❌   |
| `WEB_SEARCH_PROVIDER`    | 联网搜索 Provider：`tavily` / `serper`                | ❌   |
| `WEB_SEARCH_API_KEY`     | 搜索 API 密钥                                         | ❌   |

## 多 Agent 编排

在 `.env` 中配置即可启用：

```bash
AGENTS_ENABLED=true
AGENT_COMPOSE_STRATEGY=rag-priority
ROUTER_RULES_PATH=./config/router.rules.yml
WEB_SEARCH_PROVIDER=tavily
WEB_SEARCH_API_KEY=xxx
```

未启用时自动降级为传统单链路 RAG。

## 核心 API

| 方法            | 路径                                   | 说明               |
| --------------- | -------------------------------------- | ------------------ |
| GET/POST        | `/api/knowledge-bases`                 | 知识库列表 / 创建  |
| GET/POST/DELETE | `/api/knowledge-bases/:kbId/documents` | 文档管理           |
| GET             | `/api/knowledge-bases/:kbId/chunks`    | 切片列表           |
| POST            | `/api/retrieval/search`                | 知识检索           |
| POST(SSE)       | `/api/chat/stream`                     | 知识问答（流式）   |
| POST(SSE)       | `/api/agents/routeStream`              | Agent 路由（流式） |
| GET             | `/api/agents/rules/reload`             | 热重载路由规则     |

> SSE 事件类型：`trace_id` / `agent_start` / `sources` / `token` / `agent_done` / `done` / `error`

## 生产部署

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
- [多 Agent 编排设计](docs/06-agent-orchestration-design.md)
- [部署方案](docs/05-deployment.md)
- [自托管 MinerU](docs/08-self-hosted-mineru.md)

## 贡献指南

1. Fork 本仓库并创建特性分支 (`git checkout -b feat/your-feature`)
2. 遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范提交
3. 运行 `pnpm build` 确保构建通过
4. 提交 PR 并描述变更内容与原因

代码规范详见 [AGENTS.md](AGENTS.md)。

## 许可证

[ISC](LICENSE)
