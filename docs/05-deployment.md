# 部署与基础设施设计文档

> Docker Compose 基础设施、环境变量管理、部署方案、开发环境搭建等。

## 一、基础设施架构

```
┌─────────────────────────────────────────────┐
│              Docker Compose                  │
│                                             │
│  ┌──────────────────┐  ┌────────────────┐  │
│  │  PostgreSQL 16   │  │    Redis 8      │  │
│  │  + pgvector 扩展 │  │                │  │
│  │                  │  │  缓存 / Queue   │  │
│  │  端口: 5432      │  │  端口: 6379     │  │
│  │  DB: rag         │  │                │  │
│  └────────┬─────────┘  └───────┬────────┘  │
│           │                    │            │
│           ▼                    ▼            │
│  ┌────────────────────────────────────┐    │
│  │        NestJS Server (apps/server)  │    │
│  │        Port: 3000                   │    │
│  └──────────────┬─────────────────────┘    │
│                 │                           │
│                 ▼                           │
│  ┌────────────────────────────────────┐    │
│  │  Frontend (apps/frontend)           │    │
│  │  Dev: Vite :5173 → Proxy → :3000    │    │
│  │  Prod: Nginx 静态服务               │    │
│  └────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

## 二、Docker Compose 配置

### 2.1 docker-compose.yml（完整版）

```yaml
# knowbase-x/docker-compose.yml
version: '3.8'

services:
  # ==================== 向量数据库 ====================
  postgres-vector:
    image: pgvector/pgvector:pg16
    container_name: kb-pgvector
    restart: unless-stopped
    ports:
      - '${POSTGRES_PORT:-5432}:5432'
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-123456}
      POSTGRES_DB: ${POSTGRES_DB:-rag}
    volumes:
      - pgvector_data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U postgres']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - kb-network

  # ==================== Redis 缓存 ====================
  redis:
    image: redis:8-alpine
    container_name: kb-redis
    restart: unless-stopped
    ports:
      - '${REDIS_PORT:-6379}:6379'
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - kb-network

  # ==================== 可选：Redis Insight 管理 UI ====================
  # redis-insight:
  #   image: redis/redisinsight:latest
  #   container_name: kb-redis-insight
  #   ports:
  #     - "5540:5540"
  #   networks:
  #     - kb-network

volumes:
  pgvector_data:
    driver: local
  redis_data:
    driver: local

networks:
  kb-network:
    driver: bridge
```

### 2.2 .env.example（环境变量模板）

```bash
# ============================================
# KnowBase X - 环境变量配置模板
# 复制为 .env 并修改实际值
# ============================================

# ---- PostgreSQL 向量数据库 ----
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=123456
POSTGRES_DB=rag

# ---- Redis 缓存 ----
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# ---- LLM 服务 (OpenAI 兼容接口) ----
LLM_API_KEY=sk-your-api-key-here
LLM_BASE_URL=https://your-maas-endpoint.com/compatible-mode/v1
LLM_MODEL=qwen3.7-plus
EMBEDDING_MODEL=text-embedding-v4

# ---- 应用端口 ----
SERVER_PORT=3000
FRONTEND_DEV_PORT=5173

# ---- 切片默认参数 ----
DEFAULT_CHUNK_SIZE=1000
DEFAULT_CHUNK_OVERLAY=200
DEFAULT_TOP_K=10
DEFAULT_MIN_SCORE=0.0
DEFAULT_DENSE_WEIGHT=0.50

# ---- API 安全 ----
API_KEY_PREFIX=ek_
JWT_SECRET=your-jwt-secret-change-in-production
```

## 三、开发环境搭建

### 3.1 前置依赖

| 工具                    | 版本要求 | 用途             |
| ----------------------- | -------- | ---------------- |
| Node.js                 | >= 18.x  | 运行时           |
| pnpm                    | >= 8.x   | 包管理器         |
| Docker & Docker Compose | 最新     | PGVector + Redis |
| Git                     | 最新     | 版本控制         |

### 3.2 快速启动步骤

```bash
# 1. 克隆项目
git clone <repo-url> knowbase-x
cd knowbase-x

# 2. 复制环境变量模板
cp .env.example .env
# 编辑 .env，填入实际的 LLM API Key 和端点

# 3. 启动基础设施数据库
docker compose up -d

# 4. 安装所有 workspace 依赖
pnpm install

# 5. 启动后端开发服务器
cd apps/server && pnpm run start:dev
# → 监听 http://localhost:3000

# 6. 新开终端，启动前端开发服务器
cd apps/frontend && pnpm run dev
# → 监听 http://localhost:5173 (自动代理到 :3000)
```

### 3.3 验证启动成功

```bash
# 检查 PostgreSQL + pgvector 是否就绪
docker exec kb-pgvector psql -U postgres -d rag -c "SELECT extname FROM pg_extension WHERE extname = 'vector';"
# 输出应包含: vector

# 检查 Redis 是否可用
docker exec kb-redis redis-cli ping
# 输出: PONG

# 检查 NestJS 后端
curl http://localhost:3000/api/knowledge-bases

# 检查前端页面
open http://localhost:5173
```

## 四、生产环境部署方案

### 4.1 方案 A：Docker Compose 全栈容器化

```yaml
# docker-compose.prod.yml (扩展生产配置)
version: '3.8'

services:
  postgres-vector: { ... 同上 ... }
  redis: { ... 同上 ... }

  server:
    build:
      context: .
      dockerfile: apps/server/Dockerfile
    container_name: kb-server
    ports:
      - '3000:3000'
    environment:
      NODE_ENV: production
      DATABASE_HOST: postgres-vector
      REDIS_HOST: redis
      LLM_API_KEY: ${LLM_API_KEY}
      LLM_BASE_URL: ${LLM_BASE_URL}
    depends_on:
      postgres-vector:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - kb-network
    restart: unless-stopped

  frontend:
    build:
      context: .
      dockerfile: apps/frontend/Dockerfile
    container_name: kb-frontend
    ports:
      - '80:80'
    depends_on:
      - server
    networks:
      - kb-network
    restart: unless-stopped

networks:
  kb-network:
    driver: bridge
```

**Nginx 前端 Dockerfile：**

```dockerfile
# apps/frontend/Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**Nginx 配置：**

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # SPA 路由 fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 反向代理到后端
    location /api/ {
        proxy_pass http://server:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # SSE 支持
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        chunked_transfer_encoding on;
    }
}
```

### 4.2 方案 B：传统服务器部署

```
服务器
├── PM2 管理 Node.js 进程 (apps/server)
│   ├── pm2 start dist/main.js --name "kb-api"
│   └── pm2 startup (开机自启)
├── Nginx 反向代理
│   ├── / → 前端静态文件 (apps/frontend/dist)
│   └── /api/ → proxy_pass localhost:3000
├── PostgreSQL + pgvector (系统安装或 Docker)
└── Redis (系统安装或 Docker)
```

## 五、PGVector 数据库初始化

首次部署时需要启用 pgvector 扩展并创建表结构：

```sql
-- 连接数据库后执行

-- 启用 pgvector 扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- LangChain.js 默认的向量存储表
-- (由 PGVectorStore.initialize() 自动创建，以下供参考)

CREATE TABLE IF NOT EXISTS langchainjs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT,
    metadata JSONB,
    vector vector(1024)  -- 维度需与 Embedding 模型输出一致
);

-- 创建向量索引（加速相似度搜索）
CREATE INDEX IF NOT EXISTS langchainjs_vector_idx
    ON langchainjs
    USING ivfflat (vector vector_cosine_ops)
    WITH (lists = 100);
```

> **注意：** `vector(1024)` 的维度必须与你使用的 Embedding 模型输出维度匹配。
>
> - `text-embedding-v4` (阿里云) → 通常为 **1024** 或 **1536** 维
> - 实际使用前请确认模型文档

## 六、API Key 管理方案

### 6.1 生成策略

```typescript
// API Key 格式: ek_ + 随机32位十六进制字符串
// 示例: ek_gtjg10ggCM-OkSfLbg88v9ZeXkd6HD1

import { randomBytes } from 'node:crypto';

function generateApiKey(prefix: string = 'ek_'): string {
  const bytes = randomBytes(24); // 48 hex chars
  const key = bytes.toString('base64url').replace(/=/g, '').slice(0, 32); // 取32位
  return `${prefix}${key}`;
}

// 存储: 数据库存的是 SHA-256 哈希值，不是明文
import { createHash } from 'node:crypto';

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
```

### 6.2 校验流程

```
[外部请求携带 Header]
  Authorization: Bearer ek_gtjg10ggCM-OkSfLbg88v9ZeXkd6HD1
       ↓
[NestJS Guard 拦截]
       ↓
[提取 Bearer Token] → 查询 api_keys 表的 key_hash 字段
       ↓
[SHA-256(token) == stored_hash?]
  ✅ 匹配 → 放行，记录调用统计
  ❌ 不匹配 → 返回 401 Unauthorized
```

## 七、运维命令速查

```bash
# === 基础设施 ===
docker compose up -d              # 启动所有服务
docker compose down              # 停止所有服务
docker compose logs -f postgres  # 查看 PG 日志
docker compose logs -f redis     # 查看 Redis 日志

# === 数据库备份 ===
docker exec kb-pgvector pg_dump -U postgres -d rag > backup_$(date +%Y%m%d).sql
# 恢复
cat backup_20260709.sql | docker exec -i kb-pgvector psql -U postgres -d rag

# === Redis 缓存清理 ===
docker exec kb-redis redis-cli FLUSHDB

# === 应用日志 ===
# PM2 方式
pm2 logs kb-api --lines 100
pm2 restart kb-api

# Docker 方式
docker compose logs -f server
```

## 八、安全建议

| 项目        | 建议                                      |
| ----------- | ----------------------------------------- |
| 数据库密码  | 生产环境使用强密码，不使用默认的 `123456` |
| API Key     | 使用 HTTPS 传输；定期轮换；设置过期时间   |
| 文件上传    | 校验文件类型和大小限制；防止路径穿越攻击  |
| LLM API Key | 存储在服务端环境变量中，不暴露给前端      |
| CORS        | 仅允许信任的域名访问 API                  |
| 速率限制    | 对 API 调用实施 QPM/QPS 限制              |
