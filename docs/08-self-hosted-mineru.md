# 自托管 MinerU 部署指南

> MinerU 是本项目 PDF 文档解析引擎，提供两种接入方式：**云端 Agent API**（默认，免部署）和 **自托管服务**（本地 Docker，适合大文件 / 隐私敏感场景）。

---

## 一、架构概览

```
前端上传 PDF
    ↓ processStrategy = "mineru"
NestJS Server (apps/server)
    ↓ loadDocument(parseStrategy="mineru")
rag-engine → pdf-loader.ts
    ↓ POST http://localhost:8000/file_parse
┌─────────────────────────────────────────┐
│  kb-mineru-api (Docker)                │
│  ┌─────────────────────────────────┐   │
│  │  PDF-Extract-Kit-1.0            │   │  ← 模型缓存（HuggingFace volume）
│  │  MinerU2.5-Pro-2605-1.2B        │   │
│  └─────────────────────────────────┘   │
│  mineru-api --host 0.0.0.0 --port 8000 │
│  backend=pipeline, effort=medium       │
└─────────────────────────────────────────┘
    ↓ 返回 Markdown ZIP
rag-engine → AdmZip 解压 → Markdown
    ↓ splitMarkdownDocuments()
标题层级切片 → Embedding → PGVector
```

---

## 二、三种解析策略对比

| 策略值 | 说明 | 文件大小 | 页数 | 隐私 | 依赖 |
|--------|------|----------|------|------|------|
| `mineru-agent`（默认）| 云端 MinerU Agent API | ≤10 MB | ≤20 页 | 上传到外部服务 | 无需额外服务 |
| `mineru` | 本地自托管 MinerU API | 无限制 | 无限制 | 完全本地 | 需启动 Docker 服务 |
| `basic` | pdf-parse 纯文本兜底 | 无限制 | 无限制 | 完全本地 | 无依赖 |

---

## 三、前置条件

### 3.1 硬件要求（CPU 模式）

| 资源 | 最低 | 推荐 |
|------|------|------|
| CPU 核数 | 2 | 4+ |
| 内存 | 8 GB | 16 GB+ |
| 磁盘 | 10 GB（模型 + 解析中间文件） | 20 GB+ |
| GPU | 不需要 | 不需要 |

> 有 NVIDIA GPU 时使用 GPU 模式可获得更快的解析速度，参见 [附录：GPU 模式](#附录-gpu-模式)。

### 3.2 软件要求

- Docker ≥ 20.10
- Docker Compose V2（`docker compose` 命令，不是 `docker-compose`）
- 项目已构建的 `kb-mineru` 镜像

---

## 四、快速启动（CPU 模式）

### 步骤 1：确认或构建镜像

```bash
cd /home/hhhry/projects/knowledge-ai-main

# 检查已有镜像
docker images kb-mineru

# 如果不存在，从本地 Dockerfile 构建（首次约 15-30 分钟）：
docker build -t kb-mineru:cpu -f Dockerfile .
```

### 步骤 2：启动基础服务（PostgreSQL + Redis）

```bash
pnpm infra:up
# 等价于：docker compose up -d
# 启动 kb-pgvector 和 kb-redis
```

### 步骤 3：启动 MinerU 服务

```bash
docker compose --profile mineru-cpu up -d
```

> ⚠️ 注意：MinerU 服务在 `profiles: ["mineru-cpu"]` 下，**不会**被 `pnpm infra:up` 自动启动，必须显式带上 `--profile`。

### 步骤 4：等待模型下载（首次必须）

模型缓存在 Docker volume `mineru_models` 中，首次启动自动从 HuggingFace 下载（约 3 GB）：

```bash
# 实时查看日志，等待 "starting mineru-api..." 出现
docker logs -f kb-mineru-api
```

预期日志：
```
Models not found in cache, downloading...
[大量下载输出...]
Models downloaded successfully.
Models already cached, starting mineru-api...
```

下载完成后容器会自动启动 API 服务。

### 步骤 5：验证健康状态

```bash
curl http://localhost:8000/health
# 期望返回：{"status":"ok"}
```

### 步骤 6：上传文档选择策略

在文档管理页面工具栏的下拉框中选择 **`mineru（自托管）`**，然后上传 PDF。

或通过 API 直接指定：

```bash
curl -X POST "http://localhost:3000/api/knowledge-bases/{kbId}/documents?processStrategy=mineru" \
  -F "file=@document.pdf"
```

---

## 五、镜像构建详解

### 5.1 Dockerfile 说明

```dockerfile
FROM python:3.12-slim          # 基础镜像（CPU-only，无 CUDA）

# 系统依赖：字体 + OpenGL（PDF 渲染必需）
RUN apt-get install -y \
    fonts-noto-core \
    fonts-noto-cjk \           # 中文字体
    fontconfig \
    libgl1

# 安装 MinerU（CPU-only 版本，不装 torch CUDA 包）
RUN python3 -m pip install \
    --no-cache-dir \
    'mineru[core]>=3.4.0'

# 预配置模型路径（指向 volume 挂载点）
COPY mineru.json /root/mineru.json

# 懒加载启动脚本
COPY scripts/start-mineru.sh /usr/local/bin/start-mineru.sh
RUN chmod +x /usr/local/bin/start-mineru.sh

ENTRYPOINT ["/usr/local/bin/start-mineru.sh"]
```

### 5.2 启动脚本流程

```bash
# scripts/start-mineru.sh
HF_CACHE="/root/.cache/huggingface/hub"

# 检查模型是否已缓存
if [ -d "$HF_CACHE/models--opendatalab--PDF-Extract-Kit-1.0" ] && \
   [ -d "$HF_CACHE/models--opendatalab--MinerU2.5-Pro-2605-1.2B" ]; then
    echo "Models already cached, starting mineru-api..."
else
    echo "Models not found in cache, downloading..."
    export MINERU_MODEL_SOURCE=huggingface
    mineru-models-download -s huggingface -m all
    echo "Models downloaded successfully."
fi

export MINERU_MODEL_SOURCE=local
exec mineru-api --host 0.0.0.0 --port 8000
```

### 5.3 模型配置（mineru.json）

```json
{
  "model-source": "huggingface",
  "models-dir": {
    "pipeline": "/root/.cache/huggingface/hub/models--opendatalab--PDF-Extract-Kit-1.0/...",
    "vlm":      "/root/.cache/huggingface/hub/models--opendatalab--MinerU2.5-Pro-2605-1.2B/..."
  }
}
```

两个核心模型：
- **PDF-Extract-Kit-1.0**：版面分析（检测标题、表格、图片区域）
- **MinerU2.5-Pro-2605-1.2B**：视觉语言模型（理解文档结构、提取公式）

---

## 六、Docker Compose 配置

### 6.1 服务定义

```yaml
mineru-api:
  image: ${MINERU_IMAGE:-kb-mineru:local}
  container_name: kb-mineru-api
  restart: unless-stopped
  profiles: ["mineru-cpu"]        # 需要 --profile mineru-cpu 才能启动
  ports:
    - "${MINERU_PORT:-8000}:8000"
  environment:
    MINERU_MODEL_SOURCE: local
    MINERU_BACKEND: pipeline    # pipeline = CPU 后端
    MINERU_EFFORT: medium       # low / medium / high
  volumes:
    - mineru_models:/root/.cache/huggingface/hub   # 模型持久化
  healthcheck:
    test: ["CMD-SHELL", "curl -f http://localhost:8000/health || exit 1"]
    interval: 10s
    timeout: 5s
    retries: 5
  networks:
    - kb-network

volumes:
  mineru_models:                 # 模型缓存卷，重启不丢失
    driver: local
```

### 6.2 网络连通性

MinerU 和主应用在同一个 `kb-network` 网络中，互访方式：

| 访问方式 | URL |
|----------|-----|
| 容器内互访（server → mineru）| `http://kb-mineru-api:8000` |
| 宿主机访问（前端开发） | `http://localhost:8000` |

> **注意**：当前 `.env` 中 `MINERU_API_URL=http://localhost:8000` 适用于 server 运行在宿主机（本地开发）的场景。如果 server 也容器化，需改为 `http://kb-mineru-api:8000`。

---

## 七、运维命令速查

```bash
# === 启动 ===
docker compose --profile mineru-cpu up -d              # 启动 MinerU
pnpm infra:up                                          # 启动 PG + Redis
docker compose --profile mineru-cpu up -d              # 一步到位（含 MinerU）

# === 停止 ===
docker compose --profile mineru-cpu down               # 停止 MinerU
pnpm infra:down                                        # 停止所有

# === 查看状态 ===
docker ps | grep kb-mineru
curl http://localhost:8000/health

# === 日志 ===
docker logs -f kb-mineru-api            # 实时日志
docker logs kb-mineru-api --tail 50     # 最近 50 行

# === 重启（模型不会重新下载）===
docker restart kb-mineru-api

# === 模型缓存位置 ===
docker exec kb-mineru-api du -sh /root/.cache/huggingface/hub

# === 清理重建（会重新下载模型）===
docker compose --profile mineru-cpu down
docker volume rm kb-main_mineru_models   # 删除 volume
docker compose --profile mineru-cpu up -d
```

---

## 八、常见问题排查

### 8.1 模型下载失败 / 网络慢

HuggingFace 国内访问不稳定，可配置镜像源：

```bash
# 在 start-mineru.sh 中下载前设置镜像
export HF_ENDPOINT=https://hf-mirror.com
mineru-models-download -s huggingface -m all
```

或在 Dockerfile 构建时设置：

```dockerfile
ENV HF_ENDPOINT=https://hf-mirror.com
```

### 8.2 启动后 `curl :8000/health` 一直超时

```bash
# 查看容器日志，确认模型是否下载完成
docker logs kb-mineru-api

# 如果卡在下载，检查网络
docker exec kb-mineru-api curl -I https://huggingface.co

# 检查 volume 是否挂载
docker volume inspect kb-main_mineru_models
```

### 8.3 API 返回 500 / 解析失败

```bash
# 查看 MinerU 内部错误
docker logs kb-mineru-api | tail -50

# 测试 file_parse 端点
curl -X POST http://localhost:8000/file_parse \
  -F "files=@test.pdf" \
  -F "return_md=true" \
  -F "backend=pipeline" \
  -F "effort=medium" \
  -F "response_format_zip=true" \
  -F "lang_list=ch"

# 检查内存是否充足（解析大 PDF 需要 2-4GB）
docker stats kb-mineru-api
```

### 8.4 解析结果质量不佳

调整 `MINERU_EFFORT` 环境变量（`low` / `medium` / `high`），在 `docker-compose.yml` 中修改：

```yaml
environment:
  MINERU_EFFORT: ${MINERU_EFFORT:-high}  # 提高质量，速度会慢一些
```

### 8.5 内存不足 OOM

MinerU pipeline 后端解析大 PDF 时内存峰值约 3-4GB。如果容器频繁被 kill：

```bash
# 增加内存限制
docker compose --profile mineru-cpu up -d

# 或在 docker-compose.yml 中为 mineru-api 添加 mem_limit：
# deploy:
#   resources:
#     limits:
#       memory: 8G
```

---

## 附录：GPU 模式

仅在有 NVIDIA GPU 且已安装 NVIDIA Container Toolkit 的机器上使用。

```bash
# 构建 GPU 镜像（需要 CUDA 基础镜像，Dockerfile 需调整）
# 当前 Dockerfile 为 CPU-only，如需 GPU 版本需更换基础镜像为包含 CUDA 的版本

# 启动 GPU 服务
docker compose --profile mineru-gpu up -d

# 验证 GPU 是否可用
docker exec kb-mineru-api-gpu nvidia-smi
```

> 当前项目 `Dockerfile` 基于 `python:3.12-slim`（无 CUDA），GPU 模式需要另行构建包含 CUDA 的基础镜像。建议先以 CPU 模式运行，待验证流程稳定后再评估是否需要 GPU 加速。
