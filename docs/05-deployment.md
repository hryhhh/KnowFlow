# 部署与基础设施设计文档

> Docker Compose 基础设施、环境变量管理、部署方案、开发环境搭建等。
> 最后更新：2026-09-06（对齐现行 docker-compose.yml / .env.example / package.json scripts）

## 一、基础设施架构

```
┌──────────────────────────────────────────────────────────────┐
│                       Docker Compose                          │
│                                                              │
│  ┌──────────────────┐  ┌────────────────┐                    │
│  │  PostgreSQL 16   │  │    Redis 8      │   ← 常驻（无 profile）│
│  │  + pgvector 扩展 │  │  缓存 / Queue   │                    │
│  │  kb-pgvector     │  │  kb-redis       │                    │
│  │  宿主机: 5433     │  │  宿主机: 6379   │                    │
│  └────────┬─────────┘  └───────┬────────┘                    │
│           │   profile: app     │                             │
│  ┌────────┴────────────────────┴─────────────────────┐      │
│  │  NestJS Server (kb-server, :3000)                  │      │
│  │  NestJS Worker (kb-worker, 无 HTTP 端口)           │      │
│  │  Frontend   (kb-frontend, Nginx :80 → 宿主机 5173) │      │
│  └───────────────────────────────────────────────────┘      │
│                                                              │
│  ┌───────────────────────────────────────────────────┐      │
│  │  MinerU 解析服务（可选，profile: mineru-cpu/gpu）   │      │
│  │  kb-mineru-api(:8000) / kb-mineru-api-gpu          │      │
│  └───────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────┘
```

> 注意：PostgreSQL 宿主机端口默认 **5433**（`POSTGRES_PORT`），避免与本机 PG 冲突；容器内仍是 5432。

## 二、Docker Compose 服务一览

完整定义见仓库根目录 [docker-compose.yml](../docker-compose.yml)，服务分组：

| 服务              | profile      | 镜像 / Dockerfile                                               | 端口（宿主机）               | 说明                                 |
| ----------------- | ------------ | --------------------------------------------------------------- | ---------------------------- | ------------------------------------ |
| `postgres-vector` | （常驻）     | `pgvector/pgvector:pg16`                                        | 5433                         | 向量库，volume `pgvector_data`       |
| `redis`           | （常驻）     | `redis:8-alpine`                                                | 6379                         | 缓存/队列/限流，volume `redis_data`  |
| `server`          | `app`        | `docker/Dockerfile.server`                                      | `SERVER_PORT`（默认 3000）   | API 进程，volume `uploads_data`      |
| `worker`          | `app`        | 同 server 镜像，`command: node apps/server/dist/worker.main.js` | 无                           | BullMQ 消费进程，共享 `uploads_data` |
| `frontend`        | `app`        | `docker/Dockerfile.frontend`（构建 + Nginx 托管）               | `FRONTEND_PORT`（默认 5173） | SPA 静态服务 + `/api` 反代           |
| `mineru-api`      | `mineru-cpu` | `${MINERU_IMAGE:-kb-mineru:local}`                              | 8000                         | CPU 解析后端（pipeline）             |
| `mineru-api-gpu`  | `mineru-gpu` | 同上，GPU（hybrid-engine + `ipc: host`）                        | 8000                         | 需 NVIDIA Container Toolkit          |

所有服务在 `kb-network` 网络内互访（如 `DATABASE_HOST=postgres-vector`、`REDIS_HOST=redis`）。MinerU 模型缓存持久化在 volume `mineru_models`。

## 三、环境变量管理

复制模板并填写：`cp .env.example .env`。启动时由 `apps/server/src/config/env.ts` 统一读取与校验（`LLM_API_KEY` 等缺失会 fail-fast）。完整分组清单见 `.env.example`，概要：

| 分组       | 变量（节选）                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL | `POSTGRES_PORT/USER/PASSWORD/DB`、`DATABASE_HOST/PORT/USER/PASSWORD/NAME/SSL`                                                   |
| Redis      | `REDIS_HOST/PORT`                                                                                                               |
| LLM        | `LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`EMBEDDING_MODEL`、`EMBEDDING_DIMENSIONS`                                           |
| 应用端口   | `SERVER_PORT`（3000）、`FRONTEND_DEV_PORT`（5173）、`CORS_ALLOWED_ORIGINS`                                                      |
| 检索默认值 | `DEFAULT_MIN_SCORE`、`DEFAULT_MIN_DENSE_SCORE`、`DEFAULT_CANDIDATE_MULTIPLIER`、`RAG_RESULT_CACHE_TTL_MS`                       |
| API 安全   | `API_RATE_LIMIT`、`MAX_UPLOAD_SIZE_MB`                                                                                          |
| 会话       | `SESSION_CACHE_TTL_SECONDS`                                                                                                     |
| 摄入队列   | `DOCUMENT_QUEUE_ATTEMPTS/BACKOFF_MS/REMOVE_ON_COMPLETE/REMOVE_ON_FAIL`                                                          |
| DB Query   | `DB_READONLY_URL`、`DB_QUERIES_TEMPLATE_PATH`                                                                                   |
| Web Search | `WEB_SEARCH_PROVIDER`（tavily\|serper）、`WEB_SEARCH_API_KEY`、`WEB_SEARCH_CACHE_TTL_SECONDS`、`WEB_SEARCH_PROVIDER_TIMEOUT_MS` |
| MinerU     | `MINERU_API_URL`、`MINERU_BACKEND`、`MINERU_EFFORT`、`MINERU_IMAGE`、`MINERU_AGENT_API_BASE_URL`                                |
| Agent      | `AGENTS_ENABLED`、`AGENT_RUNTIME_*`、`AGENT_TRACE_ENABLED` 等（见 12 号文档）                                                   |

## 四、开发环境搭建

### 4.1 前置依赖

| 工具                    | 版本要求 | 用途             |
| ----------------------- | -------- | ---------------- |
| Node.js                 | >= 18.x  | 运行时           |
| pnpm                    | >= 8.x   | 包管理器         |
| Docker & Docker Compose | 最新     | PGVector + Redis |
| Git                     | 最新     | 版本控制         |

### 4.2 快速启动步骤

```bash
# 1. 克隆项目
git clone <repo-url> knowbase-x
cd knowbase-x

# 2. 复制环境变量模板，填入 LLM_API_KEY 等
cp .env.example .env

# 3. 启动基础设施数据库（postgres-vector + redis）
pnpm infra:up

# 4. 安装所有 workspace 依赖
pnpm install

# 5. 启动后端（构建 rag-engine + nest watch，端口 SERVER_PORT=3000）
pnpm start:dev

# 6. 新开终端，启动前端开发服务器（默认 5173，/api 代理到 :3000）
pnpm start:frontend

# 7.（可选）启动异步摄入 Worker（独立进程）
pnpm --filter @knowbase-x/server start:worker:dev
```

> 注意：`pnpm start:dev` 通过 `pnpm --filter` 进入 `apps/server` 执行，进程 cwd 为 `apps/server`。`config/router.rules.yml` 等仓库根目录配置文件由代码内的多级候选路径解析（`resolveRouterRulesPath()`），无需手动切换目录。

### 4.3 验证启动成功

```bash
# 检查 PostgreSQL + pgvector 是否就绪
docker exec kb-pgvector psql -U postgres -d knowledge_rag -c "SELECT extname FROM pg_extension WHERE extname = 'vector';"
# 输出应包含: vector

# 检查 Redis 是否可用
docker exec kb-redis redis-cli ping
# 输出: PONG

# 检查 NestJS 后端
curl http://localhost:3000/api/health

# 检查前端页面
open http://localhost:5173
```

## 五、生产环境部署方案

### 5.1 方案 A：Docker Compose 全栈容器化（推荐）

应用服务在 `app` profile 下，与基础设施一键启动：

```bash
# 构建并启动 server + worker + frontend（postgres/redis 常驻会自动带起）
docker compose --profile app up -d --build
```

构建细节：

- **server / worker**：`docker/Dockerfile.server`（pnpm monorepo 构建 → `apps/server/dist`）；worker 复用同一镜像，仅覆盖 `command`
- **frontend**：`docker/Dockerfile.frontend`（多阶段：node:22-alpine 构建 → nginx:alpine 托管），Nginx 内做 SPA fallback 与 `/api/` 反向代理（SSE 已关闭缓冲：`proxy_buffering off`）

生产前检查：

```bash
# 1. .env 中更换默认密码（POSTGRES_PASSWORD 等）
# 2. CORS_ALLOWED_ORIGINS 填写真实前端域名
# 3. 运行数据库迁移（生产 worker 侧 synchronize=false）
pnpm --filter @knowbase-x/server migration:run
```

### 5.2 方案 B：传统服务器部署

```
服务器
├── PM2 管理 Node.js 进程
│   ├── API:   pm2 start apps/server/dist/main.js --name "kb-api"
│   └── Worker: pm2 start apps/server/dist/worker.main.js --name "kb-worker"
├── Nginx 反向代理
│   ├── / → 前端静态文件 (apps/frontend/dist)
│   └── /api/ → proxy_pass localhost:3000（SSE 需关闭缓冲）
├── PostgreSQL + pgvector (系统安装或 Docker)
└── Redis (系统安装或 Docker)
```

## 六、PGVector 数据库初始化

- **pgvector 扩展**：[db/init.sql](../db/init.sql) 在容器首次初始化时自动执行 `CREATE EXTENSION IF NOT EXISTS vector;`
- **`langchainjs` 向量表**：由 LangChain `PGVectorStore.initialize()` 自动创建，无需手工建表
- **`chunks` 表的 `tsv` / `chunk_id` 列**：由迁移脚本创建（稀疏检索索引，见 07 号文档）

如需手工验证：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
-- 向量表维度需与 EMBEDDING_DIMENSIONS 一致（启动时校验合法值：
-- 384/512/768/1024/1536/2048/3072）
```

## 七、API Key 管理方案

### 7.1 生成策略

```typescript
// API Key 格式: ek_ + 随机32位字符串
// 示例: ek_gtjg10ggCM-OkSfLbg88v9ZeXkd6HD1
// 前缀与生成逻辑在 apps/server/src/modules/api-service/api-key.service.ts（代码常量，非环境变量）

import { randomBytes } from 'node:crypto';

function genKey(prefix = 'ek_'): string {
  return prefix + randomBytes(18).toString('base64url').replace(/[-_]/g, '').slice(0, 32);
}

// 存储: 数据库存的是 SHA-256 哈希值，不是明文
import { createHash } from 'node:crypto';

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
```

### 7.2 校验流程

```
[外部请求携带 Header]
  Authorization: Bearer ek_gtjg10ggCM-OkSfLbg88v9ZeXkd6HD1
       ↓
[ApiKeyGuard 拦截]
       ↓
[提取 Bearer Token] → 查询 api_keys 表的 key_hash 字段
       ↓
[SHA-256(token) == stored_hash?]
  ✅ 匹配 → 放行，记录调用统计（usage_logs）
  ❌ 不匹配 → 返回 401 Unauthorized
```

## 八、运维命令速查

```bash
# === 基础设施 ===
pnpm infra:up                     # 启动 postgres-vector + redis
pnpm infra:down                   # 停止
docker compose --profile app up -d --build   # 全栈启动（含 server/worker/frontend）
docker compose --profile app down

# === 数据库备份 ===
docker exec kb-pgvector pg_dump -U postgres -d knowledge_rag > backup_$(date +%Y%m%d).sql
# 恢复
cat backup_20260906.sql | docker exec -i kb-pgvector psql -U postgres -d knowledge_rag

# === Redis 缓存清理 ===
docker exec kb-redis redis-cli FLUSHDB

# === 应用日志 ===
docker compose logs -f server     # API 日志
docker compose logs -f worker     # Worker 日志
pm2 logs kb-api --lines 100       # PM2 方式
```

## 九、安全建议

| 项目        | 建议                                                         |
| ----------- | ------------------------------------------------------------ |
| 数据库密码  | 生产环境使用强密码，不使用默认值                             |
| API Key     | 使用 HTTPS 传输；定期轮换；设置过期时间                      |
| 文件上传    | 校验文件类型和大小限制（`MAX_UPLOAD_SIZE_MB`）；防止路径穿越 |
| LLM API Key | 存储在服务端环境变量中，不暴露给前端                         |
| CORS        | `CORS_ALLOWED_ORIGINS` 仅允许信任的域名                      |
| 速率限制    | `API_RATE_LIMIT` 对 API 调用实施 QPM 限制                    |

## 十、异步文档摄入（BullMQ Worker）

### 10.1 架构概述

```
┌─────────────────────────────────────────────────────┐
│  API 进程 (server)          Worker 进程 (worker)     │
│  Port: 3000                 无 HTTP 端口             │
│  ┌──────────┐           ┌──────────────┐            │
│  │ POST /    │──入队──▶ │ BullMQ Queue │            │
│  │ upload   │           │ (document-   │            │
│  │          │◀──返回   │ ingest)      │            │
│  └──────────┘  jobId   └──────┬───────┘            │
│                                │                    │
│                         ┌──────▼───────┐            │
│                         │ Ingestion    │            │
│                         │ Processor    │            │
│                         └──────┬───────┘            │
│                                │                    │
│                   ┌────────────▼────────┐           │
│                   │ PG + PGVector       │           │
│                   │ + chunks 表         │           │
│                   └─────────────────────┘           │
└─────────────────────────────────────────────────────┘
```

### 10.2 部署顺序

```bash
# 1. 启动基础设施
pnpm infra:up

# 2. 运行数据库迁移（生产环境）
pnpm --filter @knowbase-x/server migration:run

# 3. 启动 API 和 Worker
docker compose --profile app up -d
```

### 10.3 环境变量

| 变量                                | 默认值 | 说明              |
| ----------------------------------- | ------ | ----------------- |
| `DOCUMENT_QUEUE_CONCURRENCY`        | `2`    | Worker 并发度     |
| `DOCUMENT_QUEUE_ATTEMPTS`           | `3`    | 最大重试次数      |
| `DOCUMENT_QUEUE_BACKOFF_MS`         | `2000` | 退避起始延迟      |
| `DOCUMENT_QUEUE_REMOVE_ON_COMPLETE` | `1000` | 保留已完成 job 数 |
| `DOCUMENT_QUEUE_REMOVE_ON_FAIL`     | `100`  | 保留失败 job 数   |

### 10.4 运维命令

```bash
# 启动 Worker（开发环境，tsx watch）
pnpm --filter @knowbase-x/server start:worker:dev

# 启动 Worker（生产）
pnpm --filter @knowbase-x/server start:worker

# 查看 Worker 日志
docker compose logs -f worker
```

### 10.5 水平扩展

- 增加 Worker 副本：`docker compose --profile app up -d --scale worker=3`
- 不影响 API 进程，API 只需确保 Redis 可达
- 队列由 BullMQ 自动管理，多 Worker 自动负载均衡

### 10.6 故障处理

- **Redis 不可用**：API 上传返回 400（`队列服务暂不可用`），文件已落盘但文档记录会被补偿删除
- **Worker 崩溃**：BullMQ 自动 requeue stalled job，重新处理后重试
- **不可重试错误**（文件不存在、格式不支持）：立即标记 `failed`，不消耗重试 budget
- **可重试错误**（网络超时、embedding 失败、MinerU 5xx）：指数退避重试，最多 `DOCUMENT_QUEUE_ATTEMPTS` 次
