# KnowBase X 项目学习文档

> 帮助新开发者在 30 分钟内快速理解项目架构、核心业务链路和开发方式。

---

## 项目介绍

**KnowBase X** 是一个基于 **LangChain.js** 的企业级 RAG（检索增强生成）知识库平台。

核心能力：用户上传业务文档（CSV / PDF / Word / XLSX）→ 自动切片与向量化 → 存入 PostgreSQL/pgvector → 通过语义检索找到相关内容 → 交给大语言模型生成精准回答，结果以 SSE 流式推送给前端。

项目定位是**可对外输出 API 服务**的知识问答系统，支持两类使用场景：
1. **Web 界面**：管理员在浏览器中管理知识库、上传文档、调试检索参数、进行对话问答。
2. **外部调用**：通过生成 API Key，其他业务系统可以 POST 调用 `/api/service-calls/:svcId/chat/stream` 实现知识问答。

---

## 技术架构

### 整体分层

```
Browser (React SPA)
    │ HTTP / SSE
    ▼
NestJS Server (Express, :3000)
    │
    ├─→ packages/rag-engine   (RAG 核心：加载/切片/向量/检索/LLM)
    │
    ├─→ packages/agents       (多 Agent 编排：路由/调度/合成)
    │
    ▼
PostgreSQL 16 + pgvector   (向量存储 + 业务数据)
Redis 8                   (缓存，当前主要用于 agent 搜索缓存)
```

### 技术栈清单

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + Vite 8 + React Router v7 + Zustand + Ant Design |
| 后端 | NestJS 11 (Express) + TypeORM + pg |
| RAG 引擎 | LangChain.js (@langchain/*) |
| 向量数据库 | PostgreSQL 16 + pgvector |
| LLM | OpenAI 兼容接口（阿里云 MaaS：qwen3.7-plus + text-embedding-v4）|
| 包管理 | pnpm workspace Monorepo |
| 语言 | TypeScript（全栈严格模式） |

### 构建产物

- `packages/rag-engine/dist/` — TS 编译产物，被 server 依赖
- `packages/agents/dist/` — TS 编译产物，被 server 依赖
- `apps/server/dist/` — NestJS 编译产物
- `apps/frontend/dist/` — Vite 静态资源（含 Nginx 配置）

---

## 目录说明

```
knowbase-x/
├── package.json                 # workspace 根，脚本入口
├── pnpm-workspace.yaml          # 包含 apps/* 和 packages/*
├── tsconfig.base.json           # 共享 TS 编译配置（strict 模式）
├── docker-compose.yml           # PGVector + Redis 一键启动
├── db/init.sql                  # 数据库初始化（启用 pgvector 扩展）
├── .env.example                 # 环境变量模板
│
├── apps/
│   ├── frontend/                # React 前端应用
│   │   ├── src/
│   │   │   ├── main.tsx         # 入口：BrowserRouter + App
│   │   │   ├── App.tsx          # 路由定义
│   │   │   ├── pages/           # 页面组件（知识库/文档/切片/检索/问答）
│   │   │   ├── components/      # 公共布局组件（Sidebar/MainLayout 等）
│   │   │   ├── stores/          # Zustand 状态管理（kb-store / chat-store）
│   │   │   ├── services/        # API 调用封装（api.ts / sse.ts）
│   │   │   └── types/index.ts   # 前端类型定义
│   │   ├── vite.config.ts       # Vite 配置，代理 /api → :3000
│   │   └── nginx.conf           # 生产 Nginx 配置（含 SSE 支持）
│   │
│   └── server/                  # NestJS 后端应用
│       └── src/
│           ├── main.ts          # 启动入口：AppModule + 全局中间件
│           ├── app.module.ts    # 根模块：DB + 所有业务模块注册
│           ├── common/          # 全局过滤器/装饰器（HttpExceptionFilter, CurrentApiKey）
│           ├── config/          # RAG 配置模块（从 .env 读取，注入全局）
│           └── modules/
│               ├── knowledge-base/   # 知识库 CRUD
│               ├── document/         # 文档上传/切片处理
│               ├── chunk/            # 切片管理（列表/编辑/删除）
│               ├── retrieval/        # 知识检索
│               ├── chat/             # SSE 流式问答
│               ├── api-service/      # 外部服务调用模块
│               ├── dashboard/        # 数据统计面板
│               ├── usage/            # 调用日志记录
│               └── agents/           # 多 Agent 编排
│
├── packages/
│   ├── rag-engine/            # RAG 核心引擎（被 server 依赖）
│   │   └── src/
│   │       ├── index.ts       # 统一导出
│   │       ├── types.ts       # 核心类型定义
│   │       ├── pipeline.ts    # 核心函数：ingestDocument / retrieve / retrieveAndChat
│   │       ├── loaders/       # 文档加载器（csv/pdf/word/xlsx）
│   │       ├── splitters/     # 切片策略（递归/语义）
│   │       ├── embeddings/    # OpenAI 兼容 Embedding
│   │       ├── stores/        # 向量存储（PGVector / 内存）
│   │       ├── retrievers/    # 检索器（相似度 / 混合）
│   │       ├── rerankers/     # 重排器（Cross-Encoder）
│   │       └── llm/           # LLM 流式对话（ChatOpenAI）
│   │
│   └── agents/                # 多 Agent 编排引擎
│       └── src/
│           ├── index.ts       # 统一导出
│           ├── types.ts       # Agent/RouterRule/AgentResult 等类型
│           ├── router/intent-router.ts  # 基于 YAML 的规则路由（支持热重载）
│           ├── dispatcher.ts    # 并行/串行调度 Agent，支持合成策略
│           ├── orchestrator.ts  # 编排入口：路由 → 调度 → 合成
│           └── agents/        # Agent 实现（当前主要是 ragflow）
│
├── config/
│   ├── router.rules.yml       # Agent 路由规则（pattern → targetAgent）
│   └── db-queries.yml         # DB 查询相关配置
│
├── docs/                      # 设计文档
│   ├── 01-project-overview.md # 项目总览
│   ├── 02-server-design.md    # 后端设计
│   ├── 03-frontend-design.md  # 前端设计
│   ├── 04-rag-engine-design.md # RAG 引擎设计
│   └── 05-deployment.md       # 部署方案
│
└── spec/                      # 功能升级规格说明
    └── 00-upgrade-overview.md ~ 12-agent-log-upgrade.md
```

---

## 核心模块

### 1. RAG Engine (`packages/rag-engine`)

被 server 依赖的核心库，封装了完整的 RAG 流程：

| 文件 | 作用 |
|------|------|
| [pipeline.ts](packages/rag-engine/src/pipeline.ts) | 三个核心导出函数 |
| [types.ts](packages/rag-engine/src/types.ts) | 所有核心类型（TextChunk, SearchParams, RAGPipelineConfig 等）|
| [loaders/](packages/rag-engine/src/loaders/) | CSV/PDF/Word/XLSX 文档加载 |
| [splitters/](packages/rag-engine/src/splitters/) | 文本切片策略 |
| [embeddings/openai-embeddings.ts](packages/rag-engine/src/embeddings/openai-embeddings.ts) | OpenAI 兼容 Embedding |
| [stores/pgvector-store.ts](packages/rag-engine/src/stores/pgvector-store.ts) | PGVector 持久化向量存储 |
| [retrievers/similarity-retriever.ts](packages/rag-engine/src/retrievers/similarity-retriever.ts) | 余弦相似度检索 |
| [retrievers/hybrid-retriever.ts](packages/rag-engine/src/retrievers/hybrid-retriever.ts) | BM25 + 向量混合检索 |
| [rerankers/cross-encoder-reranker.ts](packages/rag-engine/src/rerankers/cross-encoder-reranker.ts) | Cross-Encoder 重排 |
| [llm/chat-service.ts](packages/rag-engine/src/llm/chat-service.ts) | ChatOpenAI 流式对话 |

**三个核心导出函数：**
- `ingestDocument(filePath, kbId, config)` — 文档摄入：加载 → 切片 → 向量化 → 存入 PGVector
- `retrieve(query, kbId, params, config)` — 纯检索：返回命中文本片段列表
- `retrieveAndChat(query, kbId, params, config, callbacks)` — 检索+问答：SSE 流式输出

### 2. Agent 编排 (`packages/agents`)

多 Agent 决策引擎，支持根据用户意图路由到不同 Agent 并行执行：

| 文件 | 作用 |
|------|------|
| [router/intent-router.ts](packages/agents/src/router/intent-router.ts) | 基于 YAML 的正则规则路由，支持 30s 热重载 |
| [dispatcher.ts](packages/agents/src/dispatcher.ts) | 并行/串行调度多个 Agent，支持三种合成策略（concat / llm-summarize / rerank-and-merge）|
| [orchestrator.ts](packages/agents/src/orchestrator.ts) | 编排入口：路由 → 调度 → 合成 |

**路由规则文件**：[config/router.rules.yml](config/router.rules.yml)

### 3. NestJS Server (`apps/server/src`)

| 模块 | 职责 | 关键文件 |
|------|------|---------|
| `knowledge-base/` | 知识库 CRUD | [knowledge-base.service.ts](apps/server/src/modules/knowledge-base/knowledge-base.service.ts) |
| `document/` | 文档上传 + 触发 RAG 摄入 | [document.service.ts](apps/server/src/modules/document/document.service.ts) |
| `chunk/` | 切片列表/编辑/删除 | [chunk.service.ts](apps/server/src/modules/chunk/chunk.service.ts) |
| `retrieval/` | 知识检索（非流式） | [retrieval.service.ts](apps/server/src/modules/retrieval/retrieval.service.ts) |
| `chat/` | SSE 流式问答（传统 RAG） | [chat.service.ts](apps/server/src/modules/chat/chat.service.ts) |
| `agents/` | SSE 流式问答（Agent 编排） | [agent-chat.service.ts](apps/server/src/modules/agents/agent-chat.service.ts) |
| `api-service/` | API Key 生成/校验/调用统计 | [api-key.service.ts](apps/server/src/modules/api-service/api-key.service.ts) |
| `dashboard/` | 数据统计面板 | [dashboard.service.ts](apps/server/src/modules/dashboard/dashboard.service.ts) |
| `usage/` | 调用日志记录 | [usage-log.service.ts](apps/server/src/modules/usage/usage-log.service.ts) |
| `config/rag-config.module.ts` | RAG 配置全局单例 | [rag-config.provider.ts](apps/server/src/config/rag-config.provider.ts) |

### 4. Frontend (`apps/frontend/src`)

| 文件 | 职责 |
|------|------|
| [App.tsx](apps/frontend/src/App.tsx) | 路由配置 |
| [stores/kb-store.ts](apps/frontend/src/stores/kb-store.ts) | 知识库列表/选中状态（localStorage 持久化当前和默认 KB）|
| [stores/chat-store.ts](apps/frontend/src/stores/chat-store.ts) | 对话状态 + SSE 流式消费 |
| [services/api.ts](apps/frontend/src/services/api.ts) | 所有 REST API 调用封装 |
| [services/sse.ts](apps/frontend/src/services/sse.ts) | SSE 客户端（fetch + ReadableStream） |
| [types/index.ts](apps/frontend/src/types/index.ts) | 前端所有类型定义 |

---

## 关键代码路径

### 入口文件
- 后端启动：[apps/server/src/main.ts](apps/server/src/main.ts)
- 前端入口：[apps/frontend/src/main.tsx](apps/frontend/src/main.tsx)

### 数据库连接
- TypeORM 配置：[apps/server/src/app.module.ts](apps/server/src/app.module.ts)（`TypeOrmModule.forRoot`）
- 表初始化 SQL：[db/init.sql](db/init.sql)（`CREATE EXTENSION IF NOT EXISTS vector;`）

### 全局配置
- RAG 配置注入：[apps/server/src/config/rag-config.provider.ts](apps/server/src/config/rag-config.provider.ts)
- 全局配置模块：[apps/server/src/config/rag-config.module.ts](apps/server/src/config/rag-config.module.ts)（`@Global()` 注解）

### API 前缀
- 全局前缀 `/api`：[main.ts:14](apps/server/src/main.ts#L14)
- 前端代理：[vite.config.ts](apps/frontend/vite.config.ts)（`/api` → `http://localhost:3000`）

---

## 数据流

### 完整业务链路 1：上传文档

```
前端 DocumentList → POST /api/knowledge-bases/:kbId/documents
    │
    ▼ (multer FileInterceptor)
后端 DocumentController.upload()
    │
    ▼
DocumentService.upload(kbId, file, strategy)
    │
    ├── saveFile() → 写入 apps/server/uploads/{kbId}/{timestamp}_{name}
    ├── docRepo.create({ status: "processing" }) → 插入 documents 表
    │
    ▼
ingestDocument(savedPath, kbId, ragConfig)   ← packages/rag-engine/src/pipeline.ts
    │
    ├── loadDocument(filePath)              ← loaders/index.ts
    │       └── detectFileType(filename)    ← 按扩展名选择 csv/pdf/word/xlsx loader
    ├── splitDocuments(documents, config)   ← splitters/recursive-splitter.ts
    ├── getEmbeddings(config.embedding)     ← embeddings/openai-embeddings.ts
    ├── createPGVectorStore(embeddings, config.pg) ← stores/pgvector-store.ts
    ├── addDocumentsToPG(store, chunks)     ← 写入 langchainjs 表的 embedding 列
    │
    ▼
chunkRepo.save(chunkEntities) → 插入 chunks 表
docRepo.update({ status: "success", chunkCount }) → 更新 documents 表
```

### 完整业务链路 2：知识问答（SSE 流式）

```
前端 ChatPage → POST /api/chat/stream  (或 POST /api/agents/routeStream)
    │
    ▼
ChatController.stream() → ChatService.stream()
    │
    ├── 构建 SearchParams（topK, minScore, useReranker, denseWeight）
    │
    ▼
AgentChatService.stream()   ← apps/server/src/modules/agents/agent-chat.service.ts
    │
    ├── if AGENTS_ENABLED === "true":
    │       IntentRouter.match(query) → 匹配路由规则
    │       if 有 Agent 命中: executeRagFlow() → 流式输出
    │       else: 降级到 streamViaRag()
    │   else:
    │       streamViaRag() → 直接调用 retrieveAndChat()
    │
    ▼
retrieveAndChat()   ← packages/rag-engine/src/pipeline.ts
    │
    ├── similaritySearch() / hybridSearch()   ← 向量检索
    ├── callbacks.onSources(sources)          ← 推送引用来源
    ├── rerank()（可选）
    ├── buildContext(results)                 ← 拼装 Prompt 上下文
    ▼
streamChat()   ← packages/rag-engine/src/llm/chat-service.ts
    │
    └── ChatOpenAI.stream([SystemMessage, HumanMessage])
            └── for await chunk: callbacks.onToken(content)
            └── callbacks.onDone()
    │
    ▼
UsageLogService.record({ type: "chat", ... })   ← 记录调用日志
```

### 完整业务链路 3：外部 API 调用

```
外部系统 → POST /api/service-calls/:svcId/chat/stream  (Header: Authorization: Bearer ek_xxx)
    │
    ▼
ServiceCallController  → ApiKeyGuard.validate()
    │
    ├── ApiKeyService.validateKey(plainKey)
    │       └── SHA-256 比对 keyHash
    │
    ▼
ChatService.stream() → retrieveAndChat() → LLM 流式输出
    │
    ▼
ApiKeyService.recordCall(svcId)   ← 累加 callCount + 记录 usage_log
```

---

## 开发指南

### 环境启动

```bash
# 1. 复制环境变量并编辑（填入 LLM_API_KEY 和 LLM_BASE_URL）
cp .env.example .env

# 2. 启动基础设施（PGVector + Redis）
pnpm infra:up
# 或：docker compose up -d

# 3. 安装依赖
pnpm install

# 4. 构建 RAG 引擎 + 启动后端（监听 :3000）
pnpm start:dev

# 5. 另开终端启动前端（监听 :5173，自动代理 /api → :3000）
pnpm start:frontend
```

访问 http://localhost:5173

### 常用脚本

| 命令 | 说明 |
|------|------|
| `pnpm start:dev` | 构建 rag-engine + 启动 server 开发模式 |
| `pnpm start:frontend` | 启动前端 Vite dev server |
| `pnpm build` | 全量构建（engine → server → frontend）|
| `pnpm infra:up` | docker compose up -d |
| `pnpm infra:down` | docker compose down |

### 关键环境变量

```bash
# LLM 配置（必须）
LLM_API_KEY=sk-xxxxxxx
LLM_BASE_URL=https://...  # OpenAI 兼容接口
LLM_MODEL=qwen3.7-plus
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIMENSIONS=1024

# Agent 编排（可选，AGENTS_ENABLED=true 时生效）
AGENTS_ENABLED=false
ROUTER_RULES_PATH=config/router.rules.yml

# 检索参数默认值
DEFAULT_TOP_K=10
DEFAULT_MIN_SCORE=0.70
DEFAULT_CHUNK_SIZE=1000
DEFAULT_CHUNK_OVERLAP=200
```

### 添加新 Agent

1. 在 `packages/agents/src/agents/` 实现新 Agent（实现 `Agent` 接口）
2. 在 [config/router.rules.yml](config/router.rules.yml) 中添加路由规则
3. 在 `packages/agents/src/agents/index.ts` 中注册新 Agent

### 添加新的文档格式

1. 在 `packages/rag-engine/src/loaders/` 实现新的 Loader
2. 在 `packages/rag-engine/src/loaders/index.ts` 导出
3. 在 [pipeline.ts](packages/rag-engine/src/pipeline.ts) 的 `ingestDocument` 中自动支持

---

## 新人学习路线

建议按以下顺序阅读，约 30 分钟可掌握全貌：

### 第一步：了解项目定位（5 分钟）
- 阅读 [README.md](README.md) — 了解技术栈和 API 列表
- 阅读 [docs/01-project-overview.md](docs/01-project-overview.md) — 了解架构设计和工作流

### 第二步：理解数据模型（5 分钟）
- [apps/server/src/modules/knowledge-base/entities/knowledge-base.entity.ts](apps/server/src/modules/knowledge-base/entities/knowledge-base.entity.ts) — 知识库
- [apps/server/src/modules/document/entities/document.entity.ts](apps/server/src/modules/document/entities/document.entity.ts) — 文档
- [apps/server/src/modules/chunk/entities/chunk.entity.ts](apps/server/src/modules/chunk/entities/chunk.entity.ts) — 切片
- [packages/rag-engine/src/types.ts](packages/rag-engine/src/types.ts) — RAG 引擎核心类型

### 第三步：理解核心流程（10 分钟）
- [packages/rag-engine/src/pipeline.ts](packages/rag-engine/src/pipeline.ts) — **最重要的文件**，理解三个核心函数
- [apps/server/src/modules/document/document.service.ts](apps/server/src/modules/document/document.service.ts) — 文档上传链路
- [apps/server/src/modules/chat/chat.service.ts](apps/server/src/modules/chat/chat.service.ts) — 问答链路
- [apps/frontend/src/services/sse.ts](apps/frontend/src/services/sse.ts) — 前端 SSE 消费

### 第四步：理解 Agent 编排（5 分钟）
- [packages/agents/src/orchestrator.ts](packages/agents/src/orchestrator.ts) — 编排入口
- [config/router.rules.yml](config/router.rules.yml) — 路由规则示例
- [apps/server/src/modules/agents/agent-chat.service.ts](apps/server/src/modules/agents/agent-chat.service.ts) — 服务层入口

### 第五步：理解前端架构（5 分钟）
- [apps/frontend/src/App.tsx](apps/frontend/src/App.tsx) — 路由
- [apps/frontend/src/stores/kb-store.ts](apps/frontend/src/stores/kb-store.ts) — 知识库状态
- [apps/frontend/src/stores/chat-store.ts](apps/frontend/src/stores/chat-store.ts) — 对话状态
- [apps/frontend/src/pages/Chat/ChatPage.tsx](apps/frontend/src/pages/Chat/ChatPage.tsx) — 问答页面（理解整体 UI 布局）

---

## 附录：API 速查

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/knowledge-bases` | 知识库列表/创建 |
| GET/POST/DELETE | `/api/knowledge-bases/:kbId/documents` | 文档列表/上传/删除 |
| GET | `/api/documents/:docId/chunks` | 按文档查切片 |
| GET | `/api/knowledge-bases/:kbId/chunks` | 按知识库查切片 |
| POST | `/api/documents/:docId/chunks` | 手动创建切片 |
| PUT/DELETE | `/api/chunks/:chunkId` | 更新/删除切片 |
| POST | `/api/retrieval/search` | 知识检索 |
| POST(SSE) | `/api/chat/stream` | 知识问答（传统 RAG）|
| POST(SSE) | `/api/agents/routeStream` | 知识问答（Agent 编排）|
| POST/GET/DELETE | `/api/api-services` | 服务调用管理 |
| POST(SSE) | `/api/service-calls/:svcId/chat/stream` | 外部 API 调用 |

> **SSE 事件类型**：`sources`（引用来源）/ `token`（文本片段）/ `done` / `error`
