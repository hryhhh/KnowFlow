# 后端 Server 设计文档

> NestJS 11 后端 API 服务设计，涵盖模块划分、接口定义、数据库表结构、SSE 流式响应等。

## 一、技术选型

| 组件          | 选型                   | 说明                         |
| ------------- | ---------------------- | ---------------------------- |
| 框架          | NestJS 11 + Express    | 模块化、依赖注入、装饰器驱动 |
| ORM / DB 驱动 | TypeORM 或 Prisma + pg | PostgreSQL 操作              |
| 向量扩展      | pgvector (pg16)        | 相似度检索                   |
| 缓存          | Redis (ioredis)        | 会话 & 任务状态              |
| LLM 客户端    | @langchain/openai      | 兼容 OpenAI 接口的 LLM       |
| 认证          | API Key Bearer Token   | 简单的 API Key 校验          |
| 文件上传      | multer                 | 多格式文件上传               |

## 二、模块设计

```
apps/server/src/
├── main.ts                          # 应用入口
├── app.module.ts                    # 根模块
│
├── config/
│   ├── database.config.ts           # 数据库配置
│   ├── redis.config.ts              # Redis 配置
│   └── llm.config.ts                # LLM 配置
│
├── common/
│   ├── decorators/
│   │   └── api-key.decorator.ts     # API Key 装饰器
│   ├── guards/
│   │   └── api-key.guard.ts         # API Key 守卫
│   ├── filters/
│   │   └── http-exception.filter.ts # 全局异常过滤器
│   └── interceptors/
│       └── response.interceptor.ts  # 响应格式化拦截器
│
└── modules/
    ├── knowledge-base/               # 知识库模块
    │   ├── knowledge-base.module.ts
    │   ├── knowledge-base.controller.ts
    │   ├── knowledge-base.service.ts
    │   ├── dto/
    │   │   ├── create-kb.dto.ts
    │   │   └── update-kb.dto.ts
    │   └── entities/
    │       └── knowledge-base.entity.ts
    │
    ├── document/                     # 文档管理模块
    │   ├── document.module.ts
    │   ├── document.controller.ts
    │   ├── document.service.ts
    │   ├── dto/
    │   │   └── upload-document.dto.ts
    │   └── entities/
    │       └── document.entity.ts
    │
    ├── chunk/                        # 切片管理模块
    │   ├── chunk.module.ts
    │   ├── chunk.controller.ts
    │   ├── chunk.service.ts
    │   └── entities/
    │       └── chunk.entity.ts
    │
    ├── retrieval/                    # 知识检索模块
    │   ├── retrieval.module.ts
    │   ├── retrieval.controller.ts
    │   ├── retrieval.service.ts
    │   └── dto/
    │       └── search.dto.ts
    │
    ├── chat/                         # 对话问答模块
    │   ├── chat.module.ts
    │   ├── chat.controller.ts        # SSE 端点
    │   └── chat.service.ts
    │
    └── api-service/                  # 外部服务调用模块
        ├── api-service.module.ts
        ├── api-service.controller.ts
        ├── api-service.service.ts
        └── entities/
            └── api-key.entity.ts
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

| 字段             | 类型         | 约束                    | 说明                                    |
| ---------------- | ------------ | ----------------------- | --------------------------------------- |
| id               | UUID         | PK                      | 主键                                    |
| kb_id            | UUID         | FK → knowledge_bases.id | 所属知识库                              |
| name             | VARCHAR(256) | NOT NULL                | 文件名 / 标识                           |
| file_type        | VARCHAR(16)  | NOT NULL                | 格式: csv / xlsx / pdf / word           |
| file_size        | BIGINT       |                         | 文件大小 (bytes)                        |
| file_path        | VARCHAR(512) |                         | 存储路径                                |
| process_strategy | VARCHAR(64)  |                         | 处理策略名 (如 miaoma_init_version)     |
| status           | VARCHAR(32)  | DEFAULT 'pending'       | pending / processing / success / failed |
| chunk_count      | INT          | DEFAULT 0               | 切片数量                                |
| import_method    | VARCHAR(16)  | DEFAULT 'upload'        | 上传方式: upload / url                  |
| error_message    | TEXT         |                         | 错误信息                                |
| created_at       | TIMESTAMP    | DEFAULT NOW()           | 创建时间                                |
| updated_at       | TIMESTAMP    |                         | 更新时间                                |

### 3.3 chunks（切片表）

> 注：实际向量存储在 PGVector 的 `langchainjs` 表中，此表为关系型元数据。

| 字段        | 类型         | 约束                    | 说明               |
| ----------- | ------------ | ----------------------- | ------------------ |
| id          | UUID         | PK                      | 主键               |
| kb_id       | UUID         | FK → knowledge_bases.id | 所属知识库         |
| doc_id      | UUID         | FK → documents.id       | 所属文档           |
| chunk_index | INT          | NOT NULL                | 切片序号           |
| content     | TEXT         | NOT NULL                | 切片文本内容       |
| title       | VARCHAR(256) |                         | 切片标题           |
| token_count | INT          |                         | Token 数量         |
| vector_id   | VARCHAR(64)  |                         | PGVector 表中的 ID |
| metadata    | JSONB        |                         | 扩展元数据         |
| created_at  | TIMESTAMP    | DEFAULT NOW()           | 创建时间           |

### 3.4 api_keys（API 密钥表）

| 字段           | 类型         | 约束                    | 说明                             |
| -------------- | ------------ | ----------------------- | -------------------------------- |
| id             | UUID         | PK                      | 主键                             |
| service_name   | VARCHAR(128) | NOT NULL                | 服务名称 (如 "学生成绩问答 API") |
| description    | TEXT         |                         | 描述                             |
| key_hash       | VARCHAR(128) | NOT NULL                | API Key 的哈希值                 |
| key_prefix     | VARCHAR(12)  | NOT NULL                | Key 前缀 (用于显示，如 "ek_...") |
| kb_id          | UUID         | FK → knowledge_bases.id | 关联知识库                       |
| creator        | VARCHAR(64)  |                         | 创建人                           |
| is_active      | BOOLEAN      | DEFAULT true            | 是否启用                         |
| call_count     | BIGINT       | DEFAULT 0               | 调用次数                         |
| last_called_at | TIMESTAMP    |                         | 最后调用时间                     |
| expires_at     | TIMESTAMP    |                         | 过期时间 (可选)                  |
| created_at     | TIMESTAMP    | DEFAULT NOW()           | 创建时间                         |

### 3.5 chat_sessions（会话记录表 - 可选）

| 字段       | 类型        | 约束          | 说明       |
| ---------- | ----------- | ------------- | ---------- |
| id         | UUID        | PK            | 主键       |
| kb_id      | UUID        | FK            | 关联知识库 |
| session_id | VARCHAR(64) | UNIQUE        | 会话标识   |
| messages   | JSONB       |               | 消息历史   |
| created_at | TIMESTAMP   | DEFAULT NOW() | 创建时间   |

## 四、API 接口定义

### 4.1 知识库模块

```
POST   /api/knowledge-bases          # 创建知识库
GET    /api/knowledge-bases          # 列表查询 (支持搜索)
GET    /api/knowledge-bases/:id      # 详情
PUT    /api/knowledge-bases/:id      # 更新
DELETE /api/knowledge-bases/:id      # 删除
```

**创建请求体：**

```json
{
  "name": "miaoma",
  "description": "学生成绩知识库",
  "type": "free"
}
```

**响应示例：**

```json
{
  "code": 0,
  "data": {
    "id": "kb_55f6c7069-e673-4bfd-b73c-a1226e23565b",
    "name": "miaoma",
    "description": "学生成绩知识库",
    "type": "free",
    "documentCount": 0,
    "chunkCount": 0,
    "createdAt": "2026/07/02 21:42"
  }
}
```

### 4.2 文档管理模块

```
POST   /api/knowledge-bases/:kbId/documents        # 上传文档 (multipart/form-data)
GET    /api/knowledge-bases/:kbId/documents        # 文档列表
DELETE /api/knowledge-bases/:kbId/documents/:docId # 删除文档
GET    /api/knowledge-bases/:kbId/documents/:docId/chunks  # 文档切片列表
```

**上传参数：**

- `file`: 文件 (multipart)
- `processStrategy`: 处理策略名 (可选)

**文档列表响应：**

```json
{
  "code": 0,
  "data": [
    {
      "id": "doc_xxx",
      "name": "11gbk.csv",
      "status": "处理失败",
      "strategy": "miaoma_init_version",
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

**创建切片请求体：**

```json
{
  "content": "切片内容",
  "title": "切片标题（可选）"
}
```

**更新切片请求体：**

```json
{
  "content": "更新后的切片内容",
  "title": "更新后的切片标题（可选）"
}
```

**切片卡片数据结构：**

```json
{
  "id": "chunk_xxx",
  "index": 1,
  "title": "切片标题",
  "contentPreview": "日期sheet:2019/8/21\n销售人:小小米\n手机型号:小米8\n数量:1\n单价:2799\n订单金额:\n订单状态:发货中",
  "sourceFile": "11gbk.csv",
  "tokenCount": 75,
  "updatedAt": "2026/07/02 21:44"
}
```

### 4.4 检索模块

```
POST  /api/retrieval/search    # 知识检索
```

**请求体：**

```json
{
  "kbId": "kb_xxx",
  "query": "番茄",
  "topK": 10,
  "minScore": 0.0,
  "useReranker": false,
  "denseWeight": 0.5
}
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "results": [
      {
        "chunkId": "chunk_xxx",
        "content": "日期sheet:2019/8/15\n销售人:小王...",
        "sourceFile": "11gbk.csv",
        "score": 0.7900624
      },
      {
        "chunkId": "chunk_yyy",
        "content": "日期sheet:2019/8/18\n销售人:小王...",
        "sourceFile": "11gbk.csv",
        "score": 0.799415
      }
    ],
    "searchHistory": [...]
  }
}
```

### 4.5 对话问答模块 (SSE)

```
POST  /api/chat/stream          # SSE 流式问答 (前端使用)
POST  /api/service-calls/:svcId/chat/stream  # SSE 外部服务调用
```

**请求体：**

```json
{
  "query": "您未明确关于小王的具体需求（例如小王的销售业绩、对应订单情况等具体问题）",
  "kbId": "kb_xxx",
  "params": {
    "topK": 10,
    "minScore": 0.0,
    "useReranker": false,
    "denseWeight": 0.5
  }
}
```

**SSE 响应格式 (text/event-stream)：**

每个事件类型：

```
data: {"type":"sources","value":[{"content":"...","sourceFile":"11gbk.csv","score":0.636677}]}

data: {"type":"token","value":"您"}

data: {"type":"token","value":"未"}

data: {"type":"token","value":"明确"}

...

data: {"type":"done"}
```

事件类型说明：

| type    | 说明                                 |
| ------- | ------------------------------------ |
| sources | 引用来源列表（含文件名和相似度分数） |
| token   | 流式输出的文本片段                   |
| done    | 回答完成                             |

### 4.6 API 服务模块

```
POST  /api/api-services                  # 创建服务调用
GET   /api/api-services                  # 列表
DELETE /api/api-services/:serviceId      # 删除服务
POST  /api/api-services/:serviceId/keys  # 创建 API Key
```

**创建服务请求：**

```json
{
  "serviceName": "学生成绩问答 API",
  "description": "给业务系统调用",
  "kbId": "kb_xxx"
}
```

**API 使用说明面板数据：**

```json
{
  "endpoint": "/api/service-calls/svc_f7818db-e967-43f4-a3bd-bcbecdff0fd4/chat/stream",
  "headerAuth": "Authorization: Bearer ek_gtjg10ggCM-OkSfLbg88v9ZeXkd6HD1",
  "apiKey": "ek_gtjg10ggCM-OkSfLbg88v9ZeXkd6HD1",
  "curlExample": "curl -N -X POST 'https://xxx/api/service-calls/svc_.../chat/stream' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Authorization: Bearer ek_...' \\\n  -d '{\"message\":\"hey 成绩多少\"}'",
  "responseFormat": "返回类型为 text/event-stream，事件类型与页面问答一致：metadata, sources, delta, done, error"
}
```

## 五、核心业务流程

### 5.1 文档上传与处理流程

```
[用户上传文件]
    ↓
[文件校验] → 格式/大小检查
    ↓
[选择处理策略]
    ↓
[Loader 加载] → CSVLoader / PDFLoader / XLSXLoader ...
    ↓ → 输出 Document[]
[Splitter 切片] → RecursiveCharacterTextSplitter
    ↓ → 输出 text chunks[]
[Embedding 向量化] → OpenAIEmbeddings.embedDocuments()
    ↓ → 输出 float[][]
[PGVector 存储] → vectorStore.addDocuments()
    ↓
[更新文档状态] → success + chunk_count
```

### 5.2 RAG 问答流程

```
[用户提问 query]
    ↓
[Query Embedding] → embeddings.embedQuery(query)
    ↓
[向量检索] → vectorStore.similaritySearchVectorWithScore(vector, topK)
    ↓
[过滤] → score >= minScore
    ↓ [可选]
[重排序 Reranker] → CrossEncoder 重排
    ↓
[Prompt 构建] → 将检索到的上下文 + 问题拼装成 Prompt
    ↓
[SSE 流式生成] → llm.stream(prompt) → 逐 token 推送到客户端
    ↓
[引用标注] → 右侧面板展示来源 + 分数
```

### 5.3 外部 API 调用流程

```
[外部系统发起 SSE POST]
    ↓
[API Key Guard 校验] → Bearer Token 验证
    ↓
[复用 Chat Service] → 同内部问答逻辑
    ↓
[SSE 响应] → text/event-stream 格式
    ↓
[记录调用统计] → call_count++, last_called_at
```

## 六、关键实现要点

### 6.1 SSE 流式响应实现

使用 NestJS 的 `@Sse()` 装饰器 + RxJS `Observable`：

```typescript
@Sse('chat/stream')
streamChat(@Body() dto: ChatStreamDto): Observable<MessageEvent> {
  return new Observable((subscriber) => {
    // 1. 检索上下文
    // 2. 发送 sources 事件
    // 3. llm.stream() 逐 token 推送
    // 4. 完成
  });
}
```

### 6.2 异步文档处理

文档上传后应异步处理（避免阻塞 HTTP 响应），推荐方案：

- 方案 A：NestJS `@nestjs/bull` + Redis Queue
- 方案 B：简单场景直接用 `setTimeout` / 后台任务
- 方案 C：独立 Worker 进程处理

### 6.3 PGVector 连接池

使用 TypeORM 或原生 `pg` 连接池，确保与 Docker 中的 PGVector 实例正确连接。

## 七、环境变量配置

```env
# 数据库
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=123456
DATABASE_NAME=rag

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# LLM (OpenAI 兼容接口)
LLM_API_KEY=sk-xxxxx
LLM_BASE_URL=https://your-maas-endpoint.com/compatible-mode/v1
LLM_MODEL=qwen3.7-plus
EMBEDDING_MODEL=text-embedding-v4

# 服务端口
PORT=3000

# 前端开发服务器代理
FRONTEND_PORT=5173
```
