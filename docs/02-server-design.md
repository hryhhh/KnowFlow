# 后端 Server 设计文档

> NestJS 11 后端 API 服务设计，涵盖模块划分、接口定义、数据库表结构、SSE 流式响应等。
> 最后更新：2026-09-06

## 一、技术选型

| 组件          | 选型                   | 说明                         |
| ------------- | ---------------------- | ---------------------------- |
| 框架          | NestJS 11 + Express    | 模块化、依赖注入、装饰器驱动 |
| ORM / DB 驱动 | TypeORM + pg           | PostgreSQL 操作              |
| 向量扩展      | pgvector (pg16)        | 相似度检索                   |
| 缓存          | Redis (ioredis)        | 会话 & 任务状态 & 限流       |
| LLM 客户端    | @langchain/openai      | 兼容 OpenAI 接口的 LLM       |
| 认证          | API Key Bearer Token   | 简单的 API Key 校验          |
| 文件上传      | multer                 | 多格式文件上传               |
| 任务队列      | BullMQ (Redis backend) | 异步文档摄入 Worker          |
| 限流          | Redis 滑动窗口         | 三模式：apikey / ip / user   |
| 可观测        | TraceId + UsageLog     | 全链路追踪 + 调用统计        |

## 二、模块设计

```
apps/server/src/
├── main.ts                          # 应用入口（API 进程）
├── app.module.ts                    # 根模块
├── worker.main.ts                   # Worker 进程入口（独立启动）
├── worker.module.ts                 # Worker 根模块
│
├── config/
│   ├── rag-config.module.ts         # RAG 配置注入
│   └── rag-config.provider.ts       # RAG_CONFIG 令牌
│
├── common/
│   ├── decorators/
│   │   └── current-api-key.decorator.ts  # 提取当前 API Key
│   ├── filters/
│   │   └── http-exception.filter.ts    # 全局异常过滤器
│   ├── health/
│   │   ├── health.controller.ts        # /health 端点
│   │   └── health.module.ts
│   ├── outbox-check/
│   │   ├── outbox-check.module.ts      # 启动期一致性校验
│   │   └── outbox-compliance.service.ts
│   ├── rate-limiter/
│   │   ├── rate-limit.guard.ts         # 三模式限流守卫（apikey/ip/user）
│   │   ├── rate-limiter.module.ts
│   │   └── rate-limiter.service.ts     # Redis 滑动窗口计数
│   └── redis/
│       ├── redis-client.service.ts     # 统一 Redis 客户端
│       └── redis.module.ts
│
├── modules/
│   ├── knowledge-base/               # 知识库 CRUD
│   │   ├── knowledge-base.module.ts
│   │   ├── knowledge-base.controller.ts
│   │   ├── knowledge-base.service.ts
│   │   ├── dto/
│   │   │   ├── create-kb.dto.ts
│   │   │   └── update-kb.dto.ts
│   │   └── entities/
│   │       └── knowledge-base.entity.ts
│   │
│   ├── document/                     # 文档管理 + 入队
│   │   ├── document.module.ts
│   │   ├── document.controller.ts
│   │   ├── document.service.ts
│   │   ├── dto/
│   │   │   └── upload-document.dto.ts
│   │   └── entities/
│   │       └── document.entity.ts
│   │
│   ├── chunk/                        # 切片 CRUD
│   │   ├── chunk.module.ts
│   │   ├── chunk.controller.ts
│   │   ├── chunk.service.ts
│   │   └── entities/
│   │       └── chunk.entity.ts
│   │
│   ├── retrieval/                    # 混合检索
│   │   ├── retrieval.module.ts
│   │   ├── retrieval.controller.ts
│   │   ├── retrieval.service.ts
│   │   ├── retrieval-cache.service.ts  # 进程内 Map 缓存（TTL configurable）
│   │   └── dto/
│   │       └── search.dto.ts
│   │
│   ├── chat/                         # SSE 流式问答（传统 RAG）
│   │   ├── chat.module.ts
│   │   ├── chat.controller.ts
│   │   └── chat.service.ts
│   │
│   ├── session/                      # 会话管理
│   │   ├── session.module.ts
│   │   ├── session.controller.ts
│   │   ├── session.service.ts
│   │   ├── session-cache.module.ts
│   │   ├── session-cache.service.ts
│   │   └── entities/
│   │       ├── conversation-session.entity.ts
│   │       └── session-message.entity.ts
│   │
│   ├── agents/                       # 多 Agent 编排（AGENTS_ENABLED=true 时启用）
│   │   ├── agent.module.ts
│   │   ├── agent.controller.ts       # /api/agents/*
│   │   ├── agent-chat.service.ts     # 双链路：AgentRuntime(ReAct) / IntentRouter+Orchestrator
│   │   ├── db-query.service.ts       # 参数化 SQL 执行
│   │   ├── trace/                    # Agent Trace 可观测（AGENT_TRACE_ENABLED=true 时落库）
│   │   │   ├── trace.controller.ts   # GET /api/agents/traces/:id、GET /api/agents/traces
│   │   │   ├── trace.service.ts
│   │   │   └── entities/
│   │   │       └── agent-trace.entity.ts
│   │   ├── cache/
│   │   │   ├── cache.module.ts
│   │   │   └── redis-cache.provider.ts  # Web Search 结果缓存
│   │   ├── interceptor/
│   │   │   └── trace-id.interceptor.ts  # X-Trace-Id 传播（全局注册）
│   │   └── providers/
│   │       └── index.ts              # Tavily / Serper (Google) Search Provider
│   │
│   ├── api-service/                  # 外部 API 服务 & Key 管理
│   │   ├── api-service.module.ts
│   │   ├── api-service.controller.ts
│   │   ├── api-key.service.ts
│   │   ├── api-key.guard.ts          # ek_ 前缀 Bearer Token 校验
│   │   ├── dto/
│   │   │   └── create-api-service.dto.ts
│   │   ├── entities/
│   │   │   └── api-key.entity.ts
│   │   └── service-call.controller.ts  # /api/service-calls/:svcId/chat/stream
│   │
│   ├── dashboard/                    # 仪表盘统计
│   │   ├── dashboard.module.ts
│   │   ├── dashboard.controller.ts   # summary / usage-trends / recent-activities
│   │   └── dashboard.service.ts
│   │
│   ├── usage/                        # 调用日志
│   │   ├── usage-log.module.ts
│   │   ├── usage-log.service.ts      # record() / getTrends() / getRecentActivities()
│   │   └── entities/
│   │       └── usage-log.entity.ts
│   │
│   └── ingestion/                    # BullMQ 异步摄入（Worker 侧）
│       ├── ingestion.module.ts
│       ├── ingestion.worker.module.ts
│       ├── ingestion.queue.ts
│       ├── ingestion.constants.ts
│       ├── ingestion.types.ts
│       └── ingestion.processor.ts    # 消费 job，更新 DB 进度
│
└── worker-health/                    # Worker 内部状态汇总（Worker 无 HTTP 端口）
    ├── worker-health.module.ts
    ├── worker-health.controller.ts   # GET /health（仅注册，进程不监听 HTTP）
    └── worker-health.service.ts
```

## 三、数据库表设计

### 3.1 knowledge_bases（知识库表）

| 字段        | 类型         | 约束             | 说明                    |
| ----------- | ------------ | ---------------- | ----------------------- |
| id          | UUID         | PK               | 主键                    |
| name        | VARCHAR(128) | NOT NULL, UNIQUE | 知识库名称              |
| description | TEXT         |                  | 描述                    |
| type        | VARCHAR(32)  | DEFAULT 'free'   | 类型: free / premium    |
| status      | VARCHAR(32)  | DEFAULT 'active' | 状态: active / archived |
| created_by  | VARCHAR(64)  |                  | 创建者                  |
| created_at  | TIMESTAMP    | DEFAULT NOW()    | 创建时间                |
| updated_at  | TIMESTAMP    |                  | 更新时间                |

### 3.2 documents（文档表）

| 字段             | 类型         | 约束                    | 说明                                                             |
| ---------------- | ------------ | ----------------------- | ---------------------------------------------------------------- |
| id               | UUID         | PK                      | 主键                                                             |
| kb_id            | UUID         | FK → knowledge_bases.id | 所属知识库                                                       |
| name             | VARCHAR(256) | NOT NULL                | 文件名 / 标识                                                    |
| file_type        | VARCHAR(16)  | NOT NULL                | 格式: csv / xlsx / pdf / word                                    |
| file_size        | BIGINT       |                         | 文件大小 (bytes)                                                 |
| file_path        | VARCHAR(512) |                         | 存储路径                                                         |
| process_strategy | VARCHAR(64)  |                         | 处理策略: basic / mineru / mineru-agent                          |
| status           | VARCHAR(32)  | DEFAULT 'pending'       | pending / processing / success / failed                          |
| chunk_count      | INT          | DEFAULT 0               | 切片数量                                                         |
| import_method    | VARCHAR(16)  | DEFAULT 'upload'        | 上传方式: upload / url                                           |
| progress         | INT          | DEFAULT 0               | 处理进度（0-100）                                                |
| processing_stage | VARCHAR(32)  |                         | 当前阶段: queued/parsing/chunking/embedding/persisting/completed |
| error_message    | TEXT         |                         | 错误信息                                                         |
| job_id           | VARCHAR(128) |                         | BullMQ Job ID（用于取消/追踪）                                   |
| created_at       | TIMESTAMP    | DEFAULT NOW()           | 创建时间                                                         |
| updated_at       | TIMESTAMP    |                         | 更新时间                                                         |

### 3.3 chunks（切片表）

> 注：实际向量存储在 PGVector 的 `langchainjs` 表中，此表为关系型元数据。

| 字段        | 类型         | 约束                    | 说明                                        |
| ----------- | ------------ | ----------------------- | ------------------------------------------- |
| id          | UUID         | PK                      | 主键                                        |
| kb_id       | UUID         | FK → knowledge_bases.id | 所属知识库                                  |
| doc_id      | UUID         | FK → documents.id       | 所属文档                                    |
| chunk_index | INT          | NOT NULL                | 切片序号                                    |
| content     | TEXT         | NOT NULL                | 切片文本内容                                |
| title       | VARCHAR(256) |                         | 切片标题                                    |
| token_count | INT          |                         | Token 数量                                  |
| vector_id   | VARCHAR(64)  |                         | PGVector 表中的 ID                          |
| chunk_id    | TEXT         | INDEX                   | 跨 dense/sparse 两路关联的唯一 ID           |
| tsv         | TSVECTOR     | GIN INDEX               | 稀疏检索全文索引（`to_tsvector('simple')`） |
| metadata    | JSONB        |                         | 扩展元数据                                  |
| created_at  | TIMESTAMP    | DEFAULT NOW()           | 创建时间                                    |

### 3.4 conversation_sessions（会话表）

| 字段       | 类型         | 约束          | 说明       |
| ---------- | ------------ | ------------- | ---------- |
| id         | UUID         | PK            | 主键       |
| kb_id      | UUID         | FK → KB       | 所属知识库 |
| title      | VARCHAR(256) |               | 会话标题   |
| created_at | TIMESTAMP    | DEFAULT NOW() | 创建时间   |
| updated_at | TIMESTAMP    |               | 更新时间   |

### 3.5 session_messages（消息表）

| 字段       | 类型        | 约束                       | 说明                    |
| ---------- | ----------- | -------------------------- | ----------------------- |
| id         | UUID        | PK                         | 主键                    |
| session_id | UUID        | FK → conversation_sessions | 所属会话                |
| role       | VARCHAR(16) | CHECK ('user'/'assistant') | 消息角色                |
| content    | TEXT        | NOT NULL                   | 消息内容                |
| sources    | JSONB       | nullable                   | 引用来源（SourceRef[]） |
| created_at | TIMESTAMP   | DEFAULT NOW()              | 创建时间                |

### 3.6 api_keys（API 密钥表）

| 字段           | 类型         | 约束                    | 说明                             |
| -------------- | ------------ | ----------------------- | -------------------------------- |
| id             | UUID         | PK                      | 主键                             |
| service_name   | VARCHAR(128) | NOT NULL                | 服务名称 (如 "学生成绩问答 API") |
| description    | TEXT         |                         | 描述                             |
| key_hash       | VARCHAR(128) | NOT NULL                | API Key 的 SHA-256 哈希值        |
| key_prefix     | VARCHAR(12)  | NOT NULL                | Key 前缀 (用于显示，如 "ek_...") |
| kb_id          | UUID         | FK → knowledge_bases.id | 关联知识库                       |
| creator        | VARCHAR(64)  |                         | 创建人                           |
| is_active      | BOOLEAN      | DEFAULT true            | 是否启用                         |
| call_count     | BIGINT       | DEFAULT 0               | 调用次数                         |
| last_called_at | TIMESTAMP    |                         | 最后调用时间                     |
| expires_at     | TIMESTAMP    |                         | 过期时间 (可选)                  |
| created_at     | TIMESTAMP    | DEFAULT NOW()           | 创建时间                         |

### 3.7 usage_logs（调用日志表）

| 字段                      | 类型        | 说明                           |
| ------------------------- | ----------- | ------------------------------ |
| id                        | UUID        | 主键                           |
| type                      | VARCHAR(16) | chat / retrieval / api / agent |
| kb_id                     | UUID        | 所属知识库                     |
| api_key_id                | UUID        | 关联 API Key（外部调用时）     |
| trace_id                  | VARCHAR(64) | 全链路追踪 ID                  |
| duration                  | INT         | 耗时（ms）                     |
| status                    | VARCHAR(16) | success / error                |
| triggered_llm_arbitration | BOOLEAN     | Agent 编排是否触发了 LLM 仲裁  |
| rag_included_by           | VARCHAR(32) | RAGFlow 被包含的原因           |
| compose_used_rag_priority | BOOLEAN     | 是否使用 rag-priority 合成策略 |
| llm_arbitration_agent     | VARCHAR(32) | 仲裁选定的 Agent               |
| created_at                | TIMESTAMP   | 创建时间                       |

### 3.8 agent_traces（Agent 执行 Trace 表）

> `AGENT_TRACE_ENABLED=true` 时由 TraceService 在 SSE `done` 之前写入；与 `usage_logs` 职责分离（本表存执行详情，后者存调用统计）。

| 字段         | 类型        | 说明                                                      |
| ------------ | ----------- | --------------------------------------------------------- |
| id           | VARCHAR(64) | PK，即运行 ID（runId / 外部 x-trace-id）                  |
| session_id   | VARCHAR(64) | 会话 ID                                                   |
| kb_id        | VARCHAR(64) | 知识库 ID                                                 |
| query        | TEXT        | 用户问题                                                  |
| status       | VARCHAR(16) | running / completed / failed / truncated / aborted→failed |
| started_at   | TIMESTAMPTZ | 开始时间                                                  |
| completed_at | TIMESTAMPTZ | 结束时间                                                  |
| steps        | JSONB       | 步骤列表：`llm_call` / `tool_call` / `final_answer` 等    |
| summary      | JSONB       | 汇总（轮数、工具调用数、耗时等）                          |
| tokens_used  | JSONB       | token 用量（prompt / completion / total）                 |
| error_msg    | TEXT        | 错误信息                                                  |

## 四、API 接口定义

### 4.1 知识库模块

```
POST   /api/knowledge-bases          # 创建知识库
GET    /api/knowledge-bases          # 列表查询 (支持搜索)
GET    /api/knowledge-bases/:id      # 详情
PUT    /api/knowledge-bases/:id      # 更新
DELETE /api/knowledge-bases/:id      # 删除
```

### 4.2 文档管理模块

```
POST   /api/knowledge-bases/:kbId/documents        # 上传文档 (multipart/form-data)
GET    /api/knowledge-bases/:kbId/documents        # 文档列表（含进度/阶段）
DELETE /api/knowledge-bases/:kbId/documents/:docId # 删除文档（取消 job + 清理向量）
GET    /api/knowledge-bases/:kbId/documents/:docId/chunks  # 文档切片列表
```

**上传参数：**

- `file`: 文件 (multipart)
- `processStrategy`: 处理策略名 (`basic` / `mineru` / `mineru-agent`)

**文档列表响应（含进度信息）：**

```json
{
  "code": 0,
  "data": [
    {
      "id": "doc_xxx",
      "name": "11gbk.csv",
      "status": "processing",
      "progress": 50,
      "processingStage": "embedding",
      "strategy": "basic",
      "chunkCount": 0,
      "importMethod": "本地上传",
      "updatedAt": "2026/07/02 21:43",
      "actions": ["切片详情"]
    }
  ]
}
```

### 4.3 切片管理模块

```
GET    /api/documents/:docId/chunks?pageSize=10&page=1      # 按文档查询切片列表
GET    /api/knowledge-bases/:kbId/chunks?pageSize=10&page=1 # 按知识库查询切片列表
GET    /api/chunks/:chunkId                                 # 切片详情
POST   /api/documents/:docId/chunks                         # 创建切片
PUT    /api/chunks/:chunkId                                 # 更新切片
DELETE /api/chunks/:chunkId                                 # 删除切片
```

### 4.4 检索模块

```
POST  /api/retrieval/search    # 知识检索
```

**请求体（SearchParamsV2）：**

```json
{
  "kbId": "kb_xxx",
  "query": "番茄",
  "topK": 10,
  "minScore": 0.0,
  "useReranker": false,
  "denseWeight": 0.5,
  "retrievalMode": "hybrid",
  "fusionMethod": "rrf",
  "rrfK": 60,
  "candidateMultiplier": 3,
  "minDenseScore": null,
  "debug": false
}
```

**请求头覆盖：**

- `X-Debug: true` — 无需修改 body 即可开启调试模式

**响应：**

```json
{
  "code": 0,
  "data": {
    "results": [
      {
        "chunkId": "chunk_xxx",
        "content": "...",
        "sourceFile": "11gbk.csv",
        "score": 0.7900624
      }
    ],
    "searchHistory": [...],
    "debug": {
      "mode": "hybrid",
      "fusion": "rrf",
      "denseCandidates": 30,
      "sparseCandidates": 30,
      "fusedTopK": 10,
      "items": [
        {
          "chunkId": "uuid",
          "rankDense": 2,
          "rankSparse": 5,
          "scoreDense": 0.82,
          "scoreSparse": 0.41,
          "scoreFused": 0.031,
          "sourceFile": "..."
        }
      ]
    }
  }
}
```

### 4.5 对话问答模块 (SSE)

```
POST  /api/chat/stream                    # SSE 流式问答（传统 RAG）
POST  /api/service-calls/:svcId/chat/stream  # 外部服务 SSE 调用
```

**请求体：**

```json
{
  "query": "您未明确关于小王的具体需求...",
  "kbId": "kb_xxx",
  "sessionId": "session_xxx",
  "params": {
    "topK": 10,
    "minScore": 0.0,
    "useReranker": false,
    "denseWeight": 0.5,
    "retrievalMode": "vector",
    "fusionMethod": "rrf"
  }
}
```

**SSE 事件类型：**

| type    | 说明                                 |
| ------- | ------------------------------------ |
| sources | 引用来源列表（含文件名和相似度分数） |
| token   | 流式输出的文本片段                   |
| done    | 回答完成                             |
| error   | 错误信息                             |

> 当 `AGENTS_ENABLED=true` 时，通过 `/api/agents/routeStream` 路由，额外包含：
>
> - `trace_id` — 全链路 trace ID `{ traceId: string }`
> - `process` — 过程指示 `{ stage: 'retrieving' | 'generating' | 'rag_fallback', label }`
> - `agent_start` — Agent 开始执行 `{ agent: string, traceId }`
> - `agent_done` — Agent 完成执行 `{ agent: string, status, elapsedMs }`
> - `agent_error` — 编排出错 `{ error, traceId }`
> - `llm_arbitration` / `rag_included` / `compose_strategy` — 可观测元数据事件
>
> 当 `AGENT_RUNTIME_ENABLED=true` 时走 AgentRuntime 链路，额外包含 `trace` / `tool_call` / `tool_result` / `agent_completed` 等事件，详见 [12-agent-upgrade-overview.md](12-agent-upgrade-overview.md)。

### 4.6 Agent 编排模块（AGENTS_ENABLED=true）

```
POST  /api/agents/routeStream   # SSE 流式多 Agent 路由
POST  /api/agents/route         # 同步多 Agent 路由（非流式）
POST  /api/agents/rules/reload  # 热重载路由规则（YAML 文件）
GET   /api/agents/traces/:id    # 查询单次 Agent 执行 trace
GET   /api/agents/traces?kbId=&limit=  # Trace 列表（limit 1..100）
```

**路由规则文件：** `config/router.rules.yml`（仓库根目录，支持热重载；路径解析见 `resolveRouterRulesPath()`）

**Web Search Provider：**

- `TavilySearchProvider` — Tavily API
- `SerperSearchProvider` — Google Serper API
- 缓存：`RedisCacheProvider`（TTL 由 `WEB_SEARCH_CACHE_TTL_SECONDS` 控制）

### 4.7 Dashboard 模块

```
GET  /api/dashboard/summary         # KPI 汇总（KB数、文档数、切片数、存储估算）
GET  /api/dashboard/usage-trends    # 近7天调用趋势（api/retrieval/chat）
GET  /api/dashboard/recent-activities  # 最近活动（创建KB、上传文档）
```

### 4.8 会话管理模块

```
GET    /api/chat/sessions?kbId=xxx        # 会话列表
POST   /api/chat/sessions                 # 创建会话（携带首条消息）
GET    /api/chat/sessions/:id/messages    # 会话消息历史
PATCH  /api/chat/sessions/:id/title       # 更新会话标题（空白标题兜底"新会话"）
DELETE /api/chat/sessions/:id             # 删除会话
DELETE /api/chat/sessions?kbId=xxx        # 清空知识库下所有会话
```

### 4.9 API 服务模块

```
POST   /api/api-services                  # 创建服务（含 API Key 生成）
GET    /api/api-services                  # 列表
DELETE /api/api-services/:serviceId       # 删除服务
```

> 注：API Key 在服务创建时同步生成，无需单独创建接口。Key 前缀 `ek_`，存储为 SHA-256 哈希。

### 4.10 Worker 进程

Worker 以 `createApplicationContext()` 启动，**不监听任何 HTTP 端口**，仅消费 BullMQ 队列；`worker-health/` 模块提供服务内部的状态汇总逻辑，但不对外暴露 HTTP 健康端点。观测 Worker 状态的方式：

```bash
docker compose logs -f worker     # 容器日志（"Worker 进程已启动，等待队列任务..."）
docker inspect kb-worker          # 容器运行状态
```

## 五、核心业务流程

### 5.1 异步文档摄入流程

```
[用户上传文件]
    ↓
[API 进程]
  ├── 文件校验 + 落盘
  ├── 创建 document 记录 (status=processing, progress=0)
  ├── 入队 BullMQ job (document-ingest 队列)
  └── 返回 documentId + jobId

[Worker 进程]
  ├── 消费 job
  ├── 校验 doc.status === 'processing'（防并发重入）
  ├── parsing (progress 10-30)：Loader 解析
  ├── chunking (progress 40)：Splitter 切片
  ├── embedding (progress 50-85)：Embedding + PGVector
  ├── persisting (progress 90-99)：写入 chunks 表 + sparse tsv 索引
  ├── 更新 document.status = 'success', progress = 100
  └── 失败时：
        ├── 可重试错误 → BullMQ 退避重试
        └── UnrecoverableError（格式错误/文件缺失）→ 直接标记 failed
```

**幂等性：** Worker 重试时，先清理本次 docId 的两路数据（PGVector + chunks），再重跑。

### 5.2 Outbox 一致性校验（启动期）

API 进程启动时运行 `OutboxComplianceService.checkAndReport()`：

1. 查询所有 `status='success'` 且 `chunkCount > 0` 的文档
2. 检查 `langchainjs` 表中是否存在对应 docId 的向量记录
3. 检查 `chunks` 表中 `tsv IS NOT NULL AND chunk_id IS NULL` 的记录
4. 输出告警日志，不自动修复（需人工介入重新摄入）

### 5.3 RAG 问答流程（传统模式）

```
[用户提问 query]
    ↓
[Query Embedding] → embeddings.embedQuery(query)
    ↓
[检索] → 根据 retrievalMode 分支：
  ├── vector: PGVector similaritySearch
  ├── keyword: tsvector sparseSearch
  └── hybrid: Promise.all([vector, sparse]) → fusion(rrf/linear)
    ↓
[minScore 过滤] → 仅 hybrid+linear 和 vector 模式生效
    ↓ [可选]
[Reranker] → Bi-Encoder 重排（useReranker=true 时；Cross-Encoder 仍为 stub）
    ↓
[Prompt 构建] → 上下文 + 问题
    ↓
[SSE 流式生成] → llm.stream(prompt)
    ↓
[记录 UsageLog + 保存 SessionMessage]
```

### 5.4 多 Agent 编排流程（AGENTS_ENABLED=true）

`AgentChatService.stream()` 为双链路设计（详见 [12-agent-upgrade-overview.md](12-agent-upgrade-overview.md)）：

**链路 A — AgentRuntime（`AGENT_RUNTIME_ENABLED=true`）**

```
[加载对话记忆 ConversationMemory]
    ↓
[AgentRuntime.run()] → ReAct 循环：
    LLM 推理（绑定 5 个内置工具）→ tool_calls → ToolExecutor 执行
    → 追加消息 → 重复，直到产出最终答案或达到 AGENT_REACT_MAX_ROUNDS
    ↓
[流式输出 answer_delta + sources]
    ↓
[AGENT_TRACE_ENABLED=true → 保存 agent_traces] → [记录 UsageLog]
    ↓
[失败且 AGENT_RUNTIME_FALLBACK=true → 回退链路 B]
```

**链路 B — Orchestrator（Legacy 路由，默认）**

```
[用户提问 query]
    ↓
[IntentRouter] → YAML 规则匹配（优先级 + minScore）
    ├── 最高命中 priority ≥ 阈值(70) → 直接路由
    └── 最高命中 priority < 阈值 → LLM 仲裁
    ↓
[alwaysInclude 注入] → 强制包含 ragflow
    ↓
[Dispatcher] → 并行执行所有命中 Agent（per-agent 超时）
    ├── DbQueryAgent: 执行参数化 SQL
    ├── WebSearchAgent: Tavily / Serper 搜索
    └── RagFlowAgent: RAG 检索
    ↓
[Compose] → rag-priority 策略（优先采信 RAGFlow）
    ↓
[降级] → 若编排结果为空，回退到传统 RAG
    ↓
[SSE 流式输出] → 同时推送 trace_id/agent_start/agent_done/meta 事件
```

### 5.5 限流机制

```
[请求进入]
    ↓
[RateLimitGuard] → 按 kind 提取 key：
  ├── apikey: 从 x-api-key / req.user.apiKeyId 取
  ├── ip: 从 req.ip / x-forwarded-for 取
  └── user: 从 req.user.id 取
    ↓
[Redis 滑动窗口计数] → INCR + EXPIRE
    ↓
  ├── 未超限 → 放行，设置 X-RateLimit-* 响应头
  └── 超限 → 返回 429，含 retryAfter 秒数
      （Redis 不可用时 fail-open，放行请求）
```

## 六、关键实现要点

### 6.1 SSE 流式响应

使用 NestJS `@Sse()` 装饰器 + RxJS `Observable`：

```typescript
@Sse('chat/stream')
streamChat(@Body() dto: ChatStreamDto): Observable<MessageEvent> {
  return new Observable((subscriber) => {
    // 1. 检索上下文
    // 2. 发送 sources 事件
    // 3. llm.stream() 逐 token 推送
    // 4. done 事件 + complete
  });
}
```

### 6.2 异步文档处理（BullMQ Worker）

- **API 进程**：仅负责文件落盘、创建记录、入队，立即返回
- **Worker 进程**：独立 Node 进程（`worker.main.ts`），消费 `document-ingest` 队列，不监听 HTTP 端口
- **队列配置**：并发数、重试次数、退避策略均可通过环境变量配置
- **优雅退出**：监听 SIGTERM/SIGINT，等待在途任务完成后关闭

### 6.3 PGVector 连接

使用 TypeORM 或原生 `pg` 连接池，与 Docker 中的 PostgreSQL + pgvector 实例连接。

### 6.4 检索缓存

进程内 `Map` 缓存（`retrieval-cache.service.ts`），TTL 由 `RAG_RESULT_CACHE_TTL_MS` 控制（默认 5 分钟）。缓存 key 包含 `retrievalMode`、`fusionMethod`、`rrfK`、`minDenseScore` 以确保不同模式的结果独立缓存。

## 七、环境变量配置

完整环境变量清单见项目根目录 `.env.example`（统一校验入口 `apps/server/src/config/env.ts`），关键字段：

| 变量                                                                    | 默认值                                          | 说明                                       |
| ----------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------ |
| `DATABASE_HOST/PORT/USER/PASSWORD/NAME`                                 | —                                               | PostgreSQL 连接                            |
| `DATABASE_SSL`                                                          | `false`                                         | 生产环境设为 `true`                        |
| `REDIS_HOST/PORT`                                                       | —                                               | Redis 连接                                 |
| `LLM_API_KEY/BASE_URL/MODEL`                                            | —（必填，缺失启动失败）                         | LLM 配置                                   |
| `EMBEDDING_MODEL/DIMENSIONS`                                            | `text-embedding-v4` / `1024`                    | 嵌入模型（维度启动时校验）                 |
| `SERVER_PORT`                                                           | `3000`                                          | API 端口                                   |
| `FRONTEND_DEV_PORT`                                                     | `5173`                                          | 前端开发端口                               |
| `DEFAULT_MIN_SCORE`                                                     | `0.7`                                           | 相似度阈值（仅 vector/hybrid+linear 生效） |
| `DEFAULT_MIN_DENSE_SCORE`                                               | `0.3`                                           | hybrid 模式 dense 候选过滤阈值             |
| `DEFAULT_CANDIDATE_MULTIPLIER`                                          | `3`                                             | 每路候选倍数（上限 10）                    |
| `RAG_RESULT_CACHE_TTL_MS`                                               | `300000`                                        | 检索结果缓存 TTL（毫秒），0 禁用           |
| `CORS_ALLOWED_ORIGINS`                                                  | （空=`*`）                                      | 生产环境填写前端域名                       |
| `MAX_UPLOAD_SIZE_MB`                                                    | `100`                                           | 上传大小限制                               |
| `SESSION_CACHE_TTL_SECONDS`                                             | `60`                                            | 会话 Redis 缓存 TTL                        |
| `DOCUMENT_QUEUE_CONCURRENCY`                                            | `2`                                             | Worker 并发数                              |
| `DOCUMENT_QUEUE_ATTEMPTS`                                               | `3`                                             | 最大重试次数                               |
| `DOCUMENT_QUEUE_BACKOFF_MS`                                             | `2000`                                          | 退避间隔                                   |
| `DOCUMENT_QUEUE_REMOVE_ON_COMPLETE`                                     | `1000`                                          | 完成后保留条数                             |
| `DOCUMENT_QUEUE_REMOVE_ON_FAIL`                                         | `100`                                           | 失败后保留条数                             |
| `DB_READONLY_URL` / `DB_QUERIES_TEMPLATE_PATH`                          | —                                               | db-query 只读连接 / SQL 模板文件路径       |
| `WEB_SEARCH_PROVIDER`                                                   | `tavily`                                        | `tavily` \| `serper`                       |
| `WEB_SEARCH_API_KEY`                                                    | —                                               | 搜索服务 Key                               |
| `WEB_SEARCH_CACHE_TTL_SECONDS` / `WEB_SEARCH_PROVIDER_TIMEOUT_MS`       | —                                               | 搜索缓存 TTL / 超时                        |
| `MINERU_API_URL/BACKEND/EFFORT`                                         | `http://localhost:8000` / `pipeline` / `medium` | 自托管 MinerU（见 06 号文档）              |
| `MINERU_AGENT_API_BASE_URL`                                             | MinerU 云端 Agent API                           | `mineru-agent` 解析策略使用                |
| `AGENTS_ENABLED`                                                        | `false`                                         | 启用多 Agent 编排（总开关）                |
| `AGENT_ALWAYS_INCLUDE_AGENTS`                                           | `ragflow`                                       | 强制包含的 Agent（逗号分隔）               |
| `AGENT_ROUTER_CONFIDENCE_THRESHOLD`                                     | `70`                                            | LLM 仲裁触发阈值（百分制）                 |
| `AGENT_COMPOSE_STRATEGY`                                                | `rag-priority`                                  | 合成策略                                   |
| `AGENT_ROUTER_ALLOW_PARALLEL`                                           | `true`                                          | 允许并行执行                               |
| `AGENT_RUNTIME_*` / `AGENT_TRACE_ENABLED` / `AGENT_MEMORY_MAX_MESSAGES` | 见 12 号文档                                    | AgentRuntime 链路配置                      |
| `API_RATE_LIMIT`                                                        | `60`                                            | 限流默认 QPM                               |

> 注：切片参数（chunkSize=1000 / chunkOverlap=200）与 API Key 前缀（`ek_`）为代码内常量（`rag-config.provider.ts`、`api-key.service.ts`），不通过环境变量配置；topK=10、denseWeight=0.5 在 `normalizeSearchParams()` 中硬编码为默认值。
