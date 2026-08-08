# Knowledge AI — 智能知识库系统

> 基于 LangChain.js 的企业级 RAG 知识库平台：文档上传 → 智能切片 → 向量检索 → 对话问答 → API 服务化。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + Vite + React Router + Zustand |
| 后端 | NestJS 11 (Express) + TypeORM + PostgreSQL/pgvector |
| RAG 引擎 | LangChain.js（加载 / 切片 / Embedding / 向量存储 / 检索 / LLM） |
| 基础设施 | Docker Compose: PostgreSQL 16 + pgvector, Redis 8 |

## 目录结构

```
knowledge-ai/
├── package.json / pnpm-workspace.yaml / tsconfig.base.json
├── docker-compose.yml          # PGVector + Redis
├── db/init.sql                 # 启用 vector 扩展
├── docs/                       # 设计文档 (Phase 0)
├── packages/rag-engine/        # RAG 核心引擎（被后端依赖）
├── apps/server/                # NestJS 后端 API
└── apps/frontend/              # React 前端
```

## 环境要求

- Node.js >= 18（推荐 22）
- pnpm >= 8
- Docker & Docker Compose

## 快速开始

```bash
# 1. 复制环境变量
cp .env.example .env
# 编辑 .env，填入 LLM_API_KEY 与 LLM_BASE_URL

# 2. 启动基础设施（PGVector + Redis）
docker compose up -d

# 3. 安装依赖
pnpm install

# 4. 构建 RAG 引擎 + 启动后端（监听 :3000）
pnpm start:dev

# 5. 另开终端启动前端（监听 :5173，代理 /api → :3000）
pnpm start:frontend
```

访问 http://localhost:5173 即可使用。

## 构建生产镜像

```bash
# 后端
docker build -f docker/Dockerfile.server -t knowledge-ai-server .

# 前端
docker build -f docker/Dockerfile.frontend -t knowledge-ai-frontend .
```

前端镜像内含 Nginx，已配置 `/api` 反向代理与 SSE 支持（见 `apps/frontend/nginx.conf`）。

## 核心 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/knowledge-bases` | 知识库列表 / 创建 |
| GET/POST/DELETE | `/api/knowledge-bases/:kbId/documents` | 文档上传 / 列表 / 删除 |
| GET | `/api/documents/:docId/chunks` | 按文档查询切片列表 |
| GET | `/api/knowledge-bases/:kbId/chunks` | 按知识库查询切片列表 |
| POST | `/api/documents/:docId/chunks` | 创建切片 |
| PUT/DELETE | `/api/chunks/:chunkId` | 更新/删除切片 |
| POST | `/api/retrieval/search` | 知识检索 |
| POST(SSE) | `/api/chat/stream` | 知识问答（流式） |
| POST/GET/DELETE | `/api/api-services` | 服务调用管理 |
| POST(SSE) | `/api/service-calls/:svcId/chat/stream` | 外部 API 调用（Bearer Key 校验） |

> SSE 事件类型：`sources`(引用来源) / `token`(文本片段) / `done` / `error`

## 文档

设计细节见 `docs/`：
- [01-project-overview.md](docs/01-project-overview.md)
- [02-server-design.md](docs/02-server-design.md)
- [03-frontend-design.md](docs/03-frontend-design.md)
- [04-rag-engine-design.md](docs/04-rag-engine-design.md)
- [05-deployment.md](docs/05-deployment.md)
