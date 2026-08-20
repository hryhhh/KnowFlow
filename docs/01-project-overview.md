# KnowBase X — 智能知识库系统

> 基于 LangChain.js 的企业级 RAG 知识库平台，支持文档上传、智能切片、向量检索、对话问答与 API 服务化。

## 一、项目概述

KnowBase X 是一个**检索增强生成（RAG）**驱动的智能知识库系统，允许用户上传业务文档（CSV / PDF / Word / XLSX），经过自动切片、向量化后存入向量数据库，再通过语义检索 + 大语言模型生成精准回答。系统同时提供 **SSE 流式 API** 供外部业务系统调用。

### 核心工作流（4 步）

| 步骤    | 名称       | 说明                                                  |
| ------- | ---------- | ----------------------------------------------------- |
| 第 1 步 | 创建知识库 | 按业务场景组织知识库，沉淀可检索资料                  |
| 第 2 步 | 上传文档   | CSV / XLSX / PDF / Word → Loader 解析 → Splitter 切片 |
| 第 3 步 | 检索问答   | 调试 topK、阈值、切片命中与答案引用，支持流式输出     |
| 第 4 步 | API 调用   | 通过 SSE 接口集成到真实业务流程                       |

## 二、技术栈

| 层级       | 技术                          | 版本/说明                                     |
| ---------- | ----------------------------- | --------------------------------------------- |
| 前端框架   | React 19 + Vite 8             | SPA 单页应用                                  |
| 后端框架   | NestJS 11                     | Express 平台，模块化架构                      |
| RAG 引擎   | LangChain.js (@langchain/*)   | 文档加载 → 切片 → Embedding → 向量存储 → 检索 |
| 向量数据库 | PostgreSQL + pgvector (pg16)  | 持久化向量存储                                |
| 缓存层     | Redis 8                       | 会话缓存 / 任务队列                           |
| LLM 服务   | OpenAI 兼容接口 (阿里云 MaaS) | qwen3.7-plus / text-embedding-v4              |
| 包管理     | pnpm workspace                | Monorepo 管理                                 |
| 语言       | TypeScript 6+                 | 全栈 TS                                       |

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
│   │   │   │   ├── KnowledgeBase/    # 知识库管理页
│   │   │   │   ├── Document/         # 文档管理页
│   │   │   │   ├── Chunk/            # 切片管理页
│   │   │   │   ├── Retrieval/        # 知识检索页
│   │   │   │   └── Chat/             # 知识问答页
│   │   │   ├── components/       # 公共组件
│   │   │   ├── hooks/            # 自定义 Hooks
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
│       │   │   ├── retrieval/        # 检索模块
│       │   │   ├── chat/             # 对话问答模块
│       │   │   └── api-service/      # 外部服务调用模块
│       │   ├── common/               # 公共装饰器 / 过滤器 / 守卫
│       │   └── config/               # 配置模块 (DB, LLM, Redis)
│       └── ...
│
├── packages/
│   └── rag-engine/               # RAG 核心引擎
│       ├── src/
│       │   ├── loaders/          # 文档加载器
│       │   │   ├── csv-loader.ts     # CSV 加载
│       │   │   ├── xlsx-loader.ts    # Excel 加载
│       │   │   ├── pdf-loader.ts     # PDF 加载
│       │   │   └── word-loader.ts    # Word 加载
│       │   ├── splitters/        # 文本切片策略
│       │   │   ├── recursive-splitter.ts   # 递归字符切片
│       │   │   └── semantic-splitter.ts    # 语义切片 (可选)
│       │   ├── embeddings/       # 向量化嵌入
│       │   │   └── openai-embeddings.ts
│       │   ├── stores/           # 向量存储
│       │   │   ├── pgvector-store.ts       # PGVector 持久存储
│       │   │   └── memory-store.ts         # 内存存储 (开发用)
│       │   ├── retrievers/       # 检索器
│       │   │   ├── similarity-retriever.ts # 相似度检索
│       │   │   └── hybrid-retriever.ts     # 混合检索 (BM25 + Vector)
│       │   ├── rerankers/        # 重排序
│       │   │   └── cross-encoder-reranker.ts
│       │   ├── llm/              # LLM 集成
│       │   │   └── chat-service.ts         # 对话生成 (SSE)
│       │   └── index.ts          # 统一导出
│       └── rag-documents/        # 示例文档数据
│
└── docs/                         # 本套设计文档
    ├── 01-project-overview.md    # 项目总览 (本文件)
    ├── 02-server-design.md       # 后端设计
    ├── 03-frontend-design.md     # 前端设计
    ├── 04-rag-engine-design.md   # RAG 引擎设计
    └── 05-deployment.md          # 部署方案
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

- 参数配置：
  - 结果返回数量 (topK，默认 10)
  - 最低相似度阈值 (默认 0.00)
  - 重排模型开关
  - Dense Weight 权重调整
- 检索结果展示：内容片段 + 相似度分数 + 来源文件

### 5.5 知识问答 (Step 3)

- 对话界面：消息列表 + 输入框 + 发送按钮
- RAG 回答：引用来源标注在右侧面板（含相似度分数）
- 模型回答参数配置区（同检索参数）
- 流式输出 (SSE)

### 5.6 服务调用 / API (Step 4)

- 创建外部服务调用：名称、描述、API Key
- 已创建的 API Key 管理
- API 使用说明面板：
  - 请求地址（SSE endpoint）
  - Authorization Header 配置
  - curl 调用示例
  - 返回格式说明（text/event-stream）

## 六、开发计划

| 阶段    | 内容            | 产物                                     |
| ------- | --------------- | ---------------------------------------- |
| Phase 0 | 设计文档        | `docs/*.md` (当前阶段)                   |
| Phase 1 | 项目脚手架      | monorepo 结构、依赖安装、基础配置        |
| Phase 2 | RAG Engine 核心 | 文档加载、切片、向量化、向量存储、检索   |
| Phase 3 | 后端 API        | NestJS 模块、数据库表、RESTful 接口、SSE |
| Phase 4 | 前端 UI         | 页面路由、组件、交互逻辑、状态管理       |
| Phase 5 | 集联调 & 部署   | 前后端联调、Docker 部署、API 文档        |

## 七、参考资料

- [LangChain.js 文档](https://js.langchain.com/)
- [NestJS 文档](https://nestjs.com/)
- [pgvector 文档](https://github.com/pgvector/pgvector)
- [Vite 文档](https://vitejs.dev/)
