# KnowBase X — 智能知识库系统

> 基于 LangChain.js 的企业级 RAG 知识库平台，支持文档上传、智能切片、向量检索、对话问答与 API 服务化。
> 最后更新：2026-08-28

## 一、项目概述

KnowBase X 是一个**检索增强生成（RAG）**驱动的智能知识库系统，允许用户上传业务文档（CSV / PDF / Word / XLSX），经过自动切片、向量化后存入向量数据库，再通过语义检索 + 大语言模型生成精准回答。系统同时提供 **SSE 流式 API** 供外部业务系统调用。

### 核心工作流（4 步）

| 步骤    | 名称       | 说明                                                              |
| ------- | ---------- | ----------------------------------------------------------------- |
| 第 1 步 | 创建知识库 | 按业务场景组织知识库，沉淀可检索资料                              |
| 第 2 步 | 上传文档   | CSV / XLSX / PDF / Word → Loader 解析 → Splitter 切片 → 异步摄入  |
| 第 3 步 | 检索问答   | vector / keyword / hybrid 三模式检索 + RRF/Linear 融合 + 流式输出 |
| 第 4 步 | API 调用   | 通过 SSE 接口集成到真实业务流程                                   |

### 扩展能力

- **多 Agent 编排**：IntentRouter + Orchestrator + Dispatcher，支持 DbQueryAgent / WebSearchAgent / RagFlowAgent 并行执行，rag-priority 合成策略
- **混合检索**：BM25(tsvector) + Vector 双路召回，RRF / Linear 融合，支持中文 N-gram 分词
- **异步摄入**：BullMQ Worker 架构，进度追踪，重试与幂等
- **会话管理**：对话历史持久化，多会话切换
- **仪表盘**：KPI 卡片、调用趋势图、最近活动
- **API 限流**：Redis 滑动窗口，三模式（apikey / ip / user）

## 二、技术栈

| 层级       | 技术                          | 版本/说明                                     |
| ---------- | ----------------------------- | --------------------------------------------- |
| 前端框架   | React 19 + Vite 8             | SPA 单页应用                                  |
| 后端框架   | NestJS 11                     | Express 平台，模块化架构                      |
| RAG 引擎   | LangChain.js (@langchain/*)   | 文档加载 → 切片 → Embedding → 向量存储 → 检索 |
| 向量数据库 | PostgreSQL + pgvector (pg16)  | 持久化向量存储                                |
| 缓存层     | Redis 8                       | 会话缓存 / 任务队列 / 限流                    |
| LLM 服务   | OpenAI 兼容接口 (阿里云 MaaS) | qwen3.7-plus / text-embedding-v4              |
| 任务队列   | BullMQ (Redis backend)        | 异步文档摄入 Worker                           |
| 包管理     | pnpm workspace                | Monorepo 管理                                 |
| 语言       | TypeScript 5+                 | 全栈 TS                                       |

## 三、系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser (用户端)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  知识库管理   │  │  文档/切片管理 │  │   检索问答 / API    │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬──────────┘  │
└─────────┼────────────────┼───────────────────┼──────────────┘
          │ HTTP/SSE       │ HTTP              │ HTTP/SSE
          ▼                ▼                   ▼
┌─────────────────────────────────────────────────────────────┐
│                  NestJS Server (apps/server)                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
│  │KB 模块    │ │Doc 模块   │ │Chunk模块  │ │Chat / API     │   │
│  │CRUD      │ │上传/解析   │ │列表/详情  │ │SSE 流式问答    │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘   │
│       └────────────┼────────────┼──────────────┘             │
│                    ▼            ▼                            │
│           ┌──────────────────────────────┐                  │
│           │      RAG Engine (packages)    │                  │
│           │  Loaders → Splitters → Embeds │                  │
│           │         ↓        ↓           │                  │
│           │  PGVectorStore ← Retriever    │                  │
│           └──────────────┬───────────────┘                  │
└──────────────────────────┼───────────────────────────────────┘
                           │ pg protocol
              ┌────────────┴────────────┐
              │   PostgreSQL (pgvector)  │
              │   langchainjs 表        │
              └─────────────────────────┘
```

## 四、项目目录结构

```
knowbase-x/
├── package.json                  # 根 package.json (workspace)
├── pnpm-workspace.yaml           # workspace 配置: apps/*, packages/*
├── tsconfig.json                 # 根 TS 配置
├── docker-compose.yml            # PGVector + Redis
│
├── apps/
│   ├── frontend/                 # React 前端应用
│   │   ├── src/
│   │   │   ├── pages/            # 页面组件
│   │   │   │   ├── Dashboard/        # 仪表盘
│   │   │   │   ├── KnowledgeBase/    # 知识库管理页
│   │   │   │   ├── Document/         # 文档管理页
│   │   │   │   ├── Chunk/            # 切片管理页
│   │   │   │   ├── Retrieval/        # 知识检索页
│   │   │   │   ├── Chat/             # 知识问答页
│   │   │   │   └── ApiTest/          # API 测试页
│   │   │   ├── components/       # 公共组件
│   │   │   ├── services/         # API 调用封装
│   │   │   ├── stores/           # 状态管理
│   │   │   └── types/            # 类型定义
│   │   └── ...
│   │
│   └── server/                   # NestJS 后端服务
│       ├── src/
│       │   ├── modules/
│       │   │   ├── knowledge-base/   # 知识库模块 (Controller/Service)
│       │   │   ├── document/         # 文档管理模块
│       │   │   ├── chunk/            # 切片管理模块
│       │   │   ├── retrieval/        # 检索模块（混合检索）
│       │   │   ├── chat/             # 对话问答模块
│       │   │   ├── session/          # 会话管理模块
│       │   │   ├── agents/           # 多 Agent 编排模块
│       │   │   ├── api-service/      # 外部服务调用模块
│       │   │   ├── dashboard/        # 仪表盘统计模块
│       │   │   ├── usage/            # 调用日志模块
│       │   │   └── ingestion/        # BullMQ 异步摄入模块
│       │   ├── common/               # 公共：限流、Outbox 校验、Redis
│       │   ├── config/               # 配置模块 (RAG Pipeline)
│       │   └── database/             # TypeORM 数据源 + Migrations
│       └── worker.main.ts          # Worker 进程入口
│
├── packages/
│   └── rag-engine/               # RAG 核心引擎
│       ├── src/
│       │   ├── loaders/          # 文档加载器
│       │   │   ├── csv-loader.ts     # CSV 加载
│       │   │   ├── xlsx-loader.ts    # Excel 加载
│       │   │   ├── pdf-loader.ts     # PDF 加载
│       │   │   ├── agent-pdf-loader.ts  # MinerU Agent PDF 加载
│       │   │   └── word-loader.ts    # Word 加载
│       │   ├── splitters/        # 文本切片策略
│       │   │   ├── recursive-splitter.ts   # 递归字符切片
│       │   │   ├── markdown-splitter.ts    # Markdown 切片
│       │   │   └── semantic-splitter.ts    # 语义切片 (可选)
│       │   ├── tokenizer.ts      # 应用层分词器（N-gram fallback）
│       │   ├── embeddings/       # 向量化嵌入
│       │   │   └── openai-embeddings.ts
│       │   ├── stores/           # 存储层
│       │   │   ├── pgvector-store.ts       # PGVector 持久存储
│       │   │   ├── sparse-store.ts         # tsvector 稀疏存储
│       │   │   └── memory-store.ts         # 内存存储 (开发用)
│       │   ├── retrievers/       # 检索器
│       │   │   ├── similarity-retriever.ts # 相似度检索
│       │   │   ├── sparse-retriever.ts     # tsvector 稀疏检索
│       │   │   └── hybrid-retriever.ts     # 混合检索 (BM25+Vector+RRF)
│       │   ├── fusion/           # 融合层
│       │   │   ├── rrf.ts                # Reciprocal Rank Fusion
│       │   │   └── linear.ts             # 线性加权融合
│       │   ├── rerankers/        # 重排序
│       │   │   ├── bi-encoder-reranker.ts
│       │   │   └── cross-encoder-reranker.ts  # TODO: stub
│       │   ├── llm/              # LLM 集成
│       │   │   └── chat-service.ts         # 对话生成 (SSE)
│       │   ├── cache/            # 检索结果缓存
│       │   │   └── search-cache.ts
│       │   └── index.ts          # 统一导出
│       └── __tests__/
│           └── fixtures/
│               └── eval-queries.json     # 评测集（~25 条查询）
│
└── packages/
    └── agents/                   # 多 Agent 编排包
        ├── src/
        │   ├── router/           # IntentRouter（YAML 规则 + LLM 仲裁）
        │   ├── orchestrator.ts   # Orchestrator（编排调度）
        │   ├── dispatcher.ts     # Dispatcher（并行执行）
        │   └── agents/           # Agent 实现
        │       ├── db-query-agent.ts
        │       ├── web-search-agent.ts
        │       └── ragflow-agent.ts
│
└── docs/                         # 本套设计文档
    ├── 01-project-overview.md    # 项目总览 (本文件)
    ├── 02-server-design.md       # 后端设计
    ├── 03-frontend-design.md     # 前端设计
    ├── 04-rag-engine-design.md   # RAG 引擎设计
    ├── 05-deployment.md          # 部署方案
    ├── 06-hybrid-retrieval.md       # 混合检索 PRD + 设计文档
    ├── 08-self-hosted-mineru.md  # MinerU 自托管指南
    ├── 09-agent-orchestration-v2.md # 多 Agent 编排 PRD
    ├── 10-async-document-ingestion-upgrade-plan.md # 异步摄入计划(已完成)
    ├── 11-hybrid-retrieval-impl-plan.md     # 混合检索实施计划(已完成)
    └── 12-remaining-tasks-plan.md   # 剩余任务(已全部完成)
```

## 五、功能模块一览

### 5.1 知识库管理 (Step 1)

- CRUD 操作：创建 / 查看 / 编辑 / 删除知识库
- 元信息：名称、描述、类型（免费版）、创建时间
- 关联统计：文档数量、切片数量

### 5.2 文档管理 (Step 2)

- 支持格式：CSV、XLSX、PDF、Word
- 上传流程：文件上传 → 格式检测 → 选择处理策略 → Loader 加载 → Splitter 切片
- 状态追踪：待处理 / 处理中 / 处理成功 / 处理失败
- 切片详情入口

### 5.3 切片管理 (Step 3 - 子功能)

- 支持按知识库或文档查看切片列表
- 切片内容预览与来源文件追溯
- 手动新增切片（选择文档、输入标题和内容）
- 编辑切片内容和标题
- 删除切片

### 5.4 知识检索 (Step 3)

- **三模式检索**：
  - `vector`：纯向量相似度（cosine）
  - `keyword`：BM25-like tsvector 全文检索
  - `hybrid`：双路并行召回 + RRF/Linear 融合
- 参数配置：
  - 结果返回数量 (topK，默认 10)
  - 最低相似度阈值 (minScore，模式化语义)
  - Min Dense Score (仅 hybrid，过滤 dense 候选)
  - RRF K 值 / 候选倍数 / Linear 权重
  - Debug 模式（返回 rankDense/rankSparse/scoreDense/scoreSparse/scoreFused）
- 检索结果展示：内容片段 + 相似度分数 + 来源文件
- 进程内缓存（TTL 可配置）

### 5.5 知识问答 (Step 3)

- 对话界面：消息列表 + 输入框 + 发送按钮
- 会话管理：历史会话侧边栏、新建/删除会话、标题自动更新
- RAG 回答：引用来源标注在右侧面板（含相似度分数）
- 多 Agent 编排（`AGENTS_ENABLED=true`）：IntentRouter 路由 → Dispatcher 并行 → rag-priority 合成
- 模型回答参数配置区（同检索参数，含检索模式选择）
- 流式输出 (SSE)，支持 trace/agent_start/agent_done/meta 可观测事件

### 5.6 服务调用 / API (Step 4)

- 创建外部服务调用：名称、描述、API Key（创建时自动生成）
- API Key 管理：`ek_` 前缀，SHA-256 存储，调用计数
- API 使用说明面板：
  - 请求地址（SSE endpoint）
  - Authorization Header 配置
  - curl 调用示例
  - 返回格式说明（text/event-stream）
- API 测试页：选择服务、粘贴完整 Key、实时 SSE 日志查看

## 六、开发计划

| 阶段    | 内容            | 产物                                        |
| ------- | --------------- | ------------------------------------------- |
| Phase 0 | 设计文档        | `docs/*.md`                                 |
| Phase 1 | 项目脚手架      | monorepo 结构、依赖安装、基础配置           |
| Phase 2 | RAG Engine 核心 | 文档加载、切片、向量化、向量存储、检索      |
| Phase 3 | 后端 API        | NestJS 模块、数据库表、RESTful 接口、SSE    |
| Phase 4 | 前端 UI         | 页面路由、组件、交互逻辑、状态管理          |
| Phase 5 | 集联调 & 部署   | 前后端联调、Docker 部署、API 文档           |
| Phase 6 | 混合检索升级    | BM25 + Vector + RRF/Linear 融合 ✅          |
| Phase 7 | 异步摄入升级    | BullMQ Worker 架构 ✅                       |
| Phase 8 | 多 Agent 编排   | IntentRouter + Orchestrator + Dispatcher ✅ |

## 七、参考资料

- [LangChain.js 文档](https://js.langchain.com/)
- [NestJS 文档](https://nestjs.com/)
- [pgvector 文档](https://github.com/pgvector/pgvector)
- [Vite 文档](https://vitejs.dev/)
