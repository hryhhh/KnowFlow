# 异步文档摄入升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将文档上传后的解析、切片、embedding、PGVector 写入和 chunk 元数据落库迁移到可重试、可限流、可观测的 BullMQ Worker，使上传请求只承担文件落盘和任务入队。

**Architecture:** API 进程保存文件并创建 `processing` 文档记录，然后向 Redis 中的 `document-ingest` 队列提交 job，立即返回 `documentId` 和 `jobId`。独立 Worker 进程消费 job，按解析、切片、embedding、持久化阶段更新 DB 进度；job 失败时由 BullMQ 负责退避重试，只有最终失败才把文档标记为 `failed`。向量 metadata 必须包含 `docId`，Worker 在重试前清理本次文档的向量和 chunk 元数据，保证重复执行不会产生重复数据。

**Tech Stack:** NestJS 11、`@nestjs/bullmq`、BullMQ、Redis、TypeORM/PostgreSQL/pgvector、现有 `@knowbase-x/rag-engine`、React 19 + 现有文档列表轮询。

---

## 1. 现状与边界

当前 [document.service.ts](../apps/server/src/modules/document/document.service.ts) 在保存文档后直接调用 `ingestDocument()`，因此 HTTP 请求会持续占用到解析和 embedding 完成。`ingestDocument()` 又会在返回 chunks 前写入 PGVector，见 [pipeline.ts](../packages/rag-engine/src/pipeline.ts)。这两个事实决定了本次升级不能只把调用包进队列，还必须同时处理重试幂等和阶段进度。

本次范围：

- API/Worker 进程拆分与 Docker 部署
- BullMQ 队列、并发数、重试和 job 保留策略
- 文档状态、进度和处理阶段
- PGVector 与 `chunks` 表的幂等写入/清理
- 上传入队失败补偿
- 现有前端轮询中的进度展示
- 单元测试、集成测试和基础运维验证

明确不在本次范围：

- 不新增 SSE/WebSocket；现有 5 秒文档列表轮询足够承载第一版进度展示
- 不改动检索、聊天和知识库管理流程
- 不引入独立任务管理后台；BullMQ 的 failed job 保留和日志用于第一版排障

## 2. 目标状态机

文档状态保持兼容现有值：

```text
processing --job 完成--> success
processing --可重试错误--> processing
processing --达到最大重试次数/不可重试错误--> failed
```

进度字段与阶段字段单独表达处理进展：

| 阶段       | 建议进度 | 说明                             |
| ---------- | -------: | -------------------------------- |
| queued     |        0 | 已创建记录并入队                 |
| parsing    |    10-30 | MinerU/基础 Loader 完成          |
| chunking   |       40 | 切片完成                         |
| embedding  |    50-85 | embedding 分批写入向量库         |
| persisting |    90-99 | chunk 元数据写入并完成一致性检查 |
| completed  |      100 | 文档状态为 `success`             |

`failed` 文档保留最后一个有效进度和处理阶段，并写入最终 `errorMessage`。重试中的临时错误不能提前覆盖为 `failed`。

## 3. 文件变更总览

### 新增

- `apps/server/src/modules/ingestion/ingestion.constants.ts`：队列名、job 名、默认重试/保留配置
- `apps/server/src/modules/ingestion/ingestion.types.ts`：job payload、进度事件和阶段类型
- `apps/server/src/modules/ingestion/ingestion.module.ts`：仅注册 BullMQ 队列连接（API 进程用）
- `apps/server/src/modules/ingestion/ingestion.worker.module.ts`：仅注册 IngestionProcessor（Worker 进程用）
- `apps/server/src/modules/ingestion/ingestion.queue.ts`：入队封装和 jobId 生成
- `apps/server/src/modules/ingestion/ingestion.processor.ts`：Worker processor
- `apps/server/src/worker.main.ts`：只启动 Nest application context 的 Worker 入口
- `apps/server/src/database/data-source.ts`：TypeORM migration 数据源
- `apps/server/src/database/migrations/<timestamp>-add-document-processing-fields.ts`：生产数据库迁移
- `apps/server/src/worker.module.ts`：Worker 专用模块

### 修改

- `apps/server/package.json`：增加 BullMQ、migration 和 Worker 启动脚本
- `apps/server/src/app.module.ts`：注册 `IngestionQueueModule`（不含 processor）
- `apps/server/src/modules/document/document.service.ts`：移除同步摄入，改为保存记录并入队
- `apps/server/src/modules/document/document.controller.ts`：正确读取 multipart body 中的 `processStrategy`
- `apps/server/src/modules/document/entities/document.entity.ts`：增加 progress/stage/jobId 字段
- `apps/server/src/modules/document/document.module.ts`：注入入队依赖
- `apps/server/src/modules/document/document.service.test.ts`：覆盖立即返回、入队和补偿
- `packages/rag-engine/src/pipeline.ts`：接收 `docId` 和阶段回调，写入 docId metadata
- `packages/rag-engine/src/stores/pgvector-store.ts`：增加按 docId 清理向量的能力和批次进度回调
- `packages/rag-engine/src/types.ts`：增加摄入回调类型
- `packages/rag-engine/src/pipeline.test.ts`：覆盖 metadata 和阶段回调
- `apps/frontend/src/types/index.ts`：增加 progress/stage/jobId/errorMessage
- `apps/frontend/src/pages/Document/DocumentList.tsx`：显示处理阶段和进度
- `docker-compose.yml`：增加独立 Worker 服务，修改 Redis 淘汰策略
- `.env.example`：增加队列配置
- `docs/02-server-design.md`：更新异步文档处理架构说明

## 4. 实施任务

### Task 1: 建立队列配置和类型边界

**Files:**

- Create: `apps/server/src/modules/ingestion/ingestion.constants.ts`
- Create: `apps/server/src/modules/ingestion/ingestion.types.ts`
- Modify: `apps/server/package.json`
- Modify: `.env.example`

- [ ] 定义固定队列名 `document-ingest` 和固定 job 名 `process-document`，避免 API 与 Worker 使用字符串散落在多个文件中。
- [ ] 定义 payload，至少包含 `docId`、`kbId`、`filePath`、`fileType`、`parseStrategy` 和原始文件名；不要把文件 Buffer 放进 Redis。
- [ ] 定义进度类型，限制 stage 为 `queued | parsing | chunking | embedding | persisting | completed`，percent 为 `0..100`。
- [ ] 增加环境变量：`REDIS_HOST`、`REDIS_PORT`、`DOCUMENT_QUEUE_CONCURRENCY`、`DOCUMENT_QUEUE_ATTEMPTS`、`DOCUMENT_QUEUE_BACKOFF_MS`、`DOCUMENT_QUEUE_REMOVE_ON_COMPLETE`、`DOCUMENT_QUEUE_REMOVE_ON_FAIL`。
- [ ] 安装 `@nestjs/bullmq` 和 `bullmq`，不额外创建裸 Redis client；队列连接统一由 Nest BullMQ 配置管理。

验证：运行 `pnpm --filter @knowbase-x/server build`，预期 TypeScript 编译通过。

### Task 2: 注册 BullMQ 队列和 Worker 入口

**Files:**

- Create: `apps/server/src/modules/ingestion/ingestion.module.ts`
- Create: `apps/server/src/modules/ingestion/ingestion.queue.ts`
- Create: `apps/server/src/modules/ingestion/ingestion.worker.module.ts`
- Create: `apps/server/src/worker.module.ts`
- Create: `apps/server/src/worker.main.ts`
- Modify: `apps/server/src/app.module.ts`
- Modify: `apps/server/package.json`

- [ ] 创建两个独立模块，**严禁**在同一模块中同时注册 `BullModule.forRoot` 和 `BullModule.registerHandlers`：
  - `IngestionQueueModule`（API 进程导入）：仅包含 `BullModule.forRoot`（Redis 连接配置）和 `BullModule.registerQueue({ name })`，导出 `INJECTION_TOKEN_QUEUE` 供 `IngestionQueue.enqueue()` 使用。**不包含任何 processor**。
  - `IngestionWorkerModule`（Worker 进程导入）：导入 `IngestionQueueModule`，注册 `IngestionProcessor`。**不包含任何 Controller**。
  - API 的 `app.module.ts` 只导入 `IngestionQueueModule`；`worker.module.ts` 导入 `IngestionWorkerModule`。
- [ ] `IngestionQueue.enqueue()` 使用文档 UUID 生成稳定 jobId，例如 `document:${docId}`；这样同一文档不会被重复入队。
- [ ] job 配置 `attempts`、指数退避、`removeOnComplete` 数量上限和 `removeOnFail` 数量上限。
- [ ] `worker.main.ts` 使用 `NestFactory.createApplicationContext(WorkerModule)`，不能启动 HTTP listener。
- [ ] Worker 模块复用数据库、RAG_CONFIG、Document/Chunk repository 和 IngestionQueueModule，但不重复暴露 Controller。
- [ ] 增加 `start:worker` 脚本：`node dist/worker.main.js`；开发环境增加对应的 `tsx`/Nest watch 运行方式。

验证：Redis 可用时运行 API 与 Worker，提交一个测试 job；预期 job 被 Worker 消费一次。Redis 不可用时，API 入队失败并返回明确错误，不应伪装成成功。
**关键验证：** 确认 API 进程启动时不加载 `IngestionProcessor`（通过日志检查 processor 构造函数未被调用）。

### Task 3: 改造上传事务和 multipart 参数读取

**Files:**

- Modify: `apps/server/src/modules/document/document.service.ts`
- Modify: `apps/server/src/modules/document/document.controller.ts`
- Modify: `apps/server/src/modules/document/document.module.ts`
- Test: `apps/server/src/modules/document/document.service.test.ts`

- [ ] 保留文件校验、文件名解码、类型检测和落盘逻辑。
- [ ] 创建文档记录时设置 `status=processing`、`progress=0`、`processingStage=queued`。
- [ ] 删除 `upload()` 中对 `ingestDocument()` 的直接调用及 chunk 写入逻辑。
- [ ] 文档保存成功后调用 `IngestionQueue.enqueue()`，响应中返回 `documentId`、`jobId` 和初始文档数据。
- [ ] `processStrategy` 从 `@Query()` 读取（与现有 `UploadDocumentDto` 兼容），不额外改为 form-data field，避免前端改动；对非法策略在入队前返回 400。
- [ ] 如果保存文件、保存文档或入队任一步失败，执行已完成资源的补偿：删除文件、删除刚创建的文档记录；补偿失败时记录结构化错误日志。**补偿逻辑必须在独立 try/catch 中执行，且补偿本身的失败不能掩盖原始错误**，伪代码模式：
  ```ts
  try {
    /* 保存文件 → 保存文档 → 入队 */
  } catch (err) {
    try {
      await compensate(savedPath, doc.id);
    } catch (compErr) {
      logger.error({ compErr, docId: doc.id }, '补偿失败');
    }
    throw err; // 原始错误仍向上抛出
  }
  ```
- [ ] 使用 PG 事务包裹文档记录创建；Redis 入队**不能在同一个事务内**——两者之间没有两阶段提交，无法保证原子性。入队成功后将 `jobId` 写回文档记录；入队失败时，在补偿块中删除文档记录。这是"最终一致性补偿"，不是"事务原子性"，计划中需明确此概念差异，测试用例应覆盖"入队失败→文档记录被清理"的场景。

关键测试：

```ts
it('creates a processing document and enqueues without ingesting synchronously', async () => {
  const result = await service.upload('kb-1', file, 'basic');

  expect(queue.enqueue).toHaveBeenCalledWith(
    expect.objectContaining({
      kbId: 'kb-1',
      parseStrategy: 'basic',
    }),
  );
  expect(ingestDocument).not.toHaveBeenCalled();
  expect(result.data.status).toBe('processing');
});
```

验证：运行 `pnpm --filter @knowbase-x/server test -- document.service.test.ts`，预期上传相关测试通过。

### Task 4: 为文档状态增加迁移字段

**Files:**

- Modify: `apps/server/src/modules/document/entities/document.entity.ts`
- Modify: `apps/server/src/modules/document/document.service.ts`
- Create: `apps/server/src/database/data-source.ts`
- Create: `apps/server/src/database/migrations/<timestamp>-add-document-processing-fields.ts`
- Modify: `apps/server/package.json`

- [ ] 增加 `progress` integer 字段，默认 `0`，并在实体层限制写入范围为 `0..100`。
- [ ] 增加 nullable 的 `processingStage` 字段，保存当前阶段。
- [ ] 增加 nullable 的 `jobId` 字段（类型 `string | null`），记录 BullMQ job ID，用于删除时取消活跃 job；migration 默认 null。
- [ ] migration 为已有文档设置 `progress=100`（`success`）或 `progress=0`（其他状态），避免历史数据返回 null。
- [ ] 增加 `migration:run` 和 `migration:revert` 脚本；生产部署先运行 migration，再启动 API/Worker。**Worker 进程必须使用 `NODE_ENV=production`**，确保 typeorm data-source 走 migration 路径而非 `synchronize`，与 API 行为保持一致，防止 Worker 意外修改表结构。
- [ ] 更新 `DocListItem` 映射，返回 `progress`、`processingStage`、`jobId` 和可选 `errorMessage`。
- [ ] 开发环境可以继续使用 `synchronize`，但验收必须使用 migration 验证生产路径。

验证：对全新和已有数据库分别执行 migration，检查 `documents` 表字段、默认值和回滚结果。

### Task 5: 改造 RAG 摄入流程支持幂等和进度

**Files:**

- Modify: `packages/rag-engine/src/types.ts`
- Modify: `packages/rag-engine/src/pipeline.ts`
- Modify: `packages/rag-engine/src/stores/pgvector-store.ts`
- Test: `packages/rag-engine/src/pipeline.test.ts`

- [ ] 将 `docId` 作为 `ingestDocument()` 的必需参数，避免 Worker 忘记传入文档身份。
- [ ] 每个 chunk 的 metadata 写入 `docId`、`kbId` 和 source；metadata 中不能只依赖文件名识别文档。
- [ ] **PGVector 清理能力实现约束**：`langchainjs` 表结构为 `content text, metadata jsonb, vector vector(N)`（见 integration test）。`PGVectorStore` 不提供按 metadata 过滤删除的内置 API，需直接通过 `pg` 执行参数化 SQL：
  ```sql
  DELETE FROM <tableName> WHERE metadata @> '{"docId": $1}'
  ```
  - 使用 `pg` pool 执行，**不能**用 `PGVectorStore` 的内部连接（连接池隔离问题）
  - 删除前检查 metadata 列是否存在 `docId` 键（兼容无 docId 的历史数据）
  - 考虑对 `metadata->>'docId'` 创建 GIN 索引加速删除扫描
- [ ] 在 Worker 重试开始时删除该文档的 chunks，并在向量写入前删除旧向量；这样”向量已写入但 chunk 表失败”的重试不会累积重复数据。
- [ ] **并发保护**：稳定 jobId 只保证同一 job 不并发，但不同 docId 可能触发并发清理+写入。第一版至少规定”同一文档同时只能有一个活跃 job”——在 processor 入口处检查 `documents.status = 'processing'`，如果不是则 abort 并记录日志；更严格的方案是 PostgreSQL advisory lock，但第一版可用此轻量手段。
- [ ] 为 embedding 批次增加回调，在每批完成后上报 `embedding` 阶段的百分比；保持现有 batch size 10 和 100ms 间隔，除非基准测试证明需要调整。
- [ ] 保证 `ingestDocument()` 失败时向上抛出异常，不在 RAG 层吞掉异常。
- [ ] 明确空文档行为：无可解析内容应抛出可重试性为 false 的业务错误，不写入空的 success 文档。

关键一致性规则：PGVector 写入和 `chunks` 表写入不是同一个数据库事务，必须依靠 `docId` 清理 + 重试幂等来恢复，不能宣称两者具备原子性。

验证：运行 `pnpm --filter @knowbase-x/rag-engine test -- pipeline.test.ts`，覆盖 docId metadata、回调顺序和重复执行后的唯一结果。

### Task 6: 实现 Worker processor 和最终失败处理

**Files:**

- Create: `apps/server/src/modules/ingestion/ingestion.processor.ts`
- Create: `apps/server/src/modules/ingestion/ingestion.worker.module.ts`
- Test: `apps/server/src/modules/ingestion/ingestion.processor.test.ts`

- [ ] Processor 按以下顺序执行：读取 job payload、校验文档存在且属于 kbId、清理上次尝试数据、更新 parsing、调用 RAG 摄入、写入 chunks、更新 success。
- [ ] 每个阶段使用 `job.updateProgress({ percent, stage })`，同时更新 documents 表；**DB 是前端轮询的唯一进度来源**，processor 不得依赖 BullMQ `job.progress()` 的返回值作为进度依据。
- [ ] 重试时**重置进度为 `queued(0)`**并在日志中记录，不因上一轮部分进度残留导致前端显示不准确的中间值；job 失败后进度保留最后一次成功写入 DB 的值（不主动清零），确保前端始终能读到有意义的数据。
- [ ] 只捕获并记录上下文后重新抛出异常，让 BullMQ 执行重试。
- [ ] 对文件不存在、格式不支持、空文档等确定性错误定义为**不可重试**：抛出 BullMQ `UnrecoverableError`（或等效标记），立即结束重试，**不消耗 retry budget**；网络超时、MinerU 5xx、embedding 临时失败等可恢复错误允许重试。
- [ ] 通过 `@OnWorkerEvent('failed')` 统一处理最终失败：**仅当 `job.attemptsMade >= job.opts.attempts` 时才写 `failed`**；不可重试错误在第一次就结束重试，也会触发此事件，需在此分支内判断并重写 `errorMessage`。
- [ ] 成功写入 chunks 后再把文档设为 `success`，并把 progress 设为 `100`、stage 设为 `completed`。
- [ ] Worker 重启后由 BullMQ 重新领取 stalled job；processor 必须可重复执行，不能依赖进程内状态。

关键测试：

- 成功路径更新 `parsing -> chunking -> embedding -> persisting -> completed`。
- 第一次 embedding 失败时 processor 抛错，文档仍为 `processing`。
- 达到最大尝试次数后文档为 `failed` 且保存错误信息。
- 同一 `docId` 执行两次，向量和 chunks 不重复。

验证：运行 `pnpm --filter @knowbase-x/server test -- ingestion.processor.test.ts`，预期上述场景全部通过。

### Task 7: 调整 Docker、Redis 和运行命令

**Files:**

- Modify: `docker-compose.yml`
- Modify: `docker/Dockerfile.server`
- Modify: `.env.example`
- Modify: `docs/05-deployment.md`

- [ ] 新增 `worker` service，使用与 server 相同的镜像和环境变量，但 command 改为 `node dist/worker.main.js`。
- [ ] server 和 worker 共同挂载 `uploads_data:/app/apps/server/uploads`；两者必须看到相同的绝对 filePath。
- [ ] worker 依赖 PostgreSQL 和 Redis healthcheck，不暴露端口。
- [ ] **Worker 健康检查**：Worker 进程通过 `NestFactory.createApplicationContext()` 不启动 HTTP listener，需额外创建一个最小 health module（监听内部端口如 `3001`，仅在 Docker 网络内可达），提供 `/health` 端点返回 Redis 连接状态和队列活跃 job 数；或在 docker-compose 中对 worker service 配置 `healthcheck` 通过 `bullmq-cli info` 或同类工具检查队列状态。
- [ ] **MinerU 并发限制**：`DOCUMENT_QUEUE_CONCURRENCY` 初始值建议设为 2-3，需参考 MinerU 自托管服务的实际并发能力，观察后再逐步提高；若使用 mineru-agent（云端免登录），同样需考虑其 rate limit。
- [ ] Redis 将 `maxmemory-policy` 改为 `noeviction`；如果业务确实需要 LRU 缓存，另建 Redis 实例，不与 BullMQ 共用。
- [ ] **Redis 容量策略**（`noeviction` 下 Redis 满时入队会抛错，需配套处理）：
  - 设置 `DOCUMENT_QUEUE_REMOVE_ON_COMPLETE`（建议 1000）和 `DOCUMENT_QUEUE_REMOVE_ON_FAIL`（建议 100），控制已完成的 job 占用的内存
  - 增加 `REDIS_MAXMEMORY` 环境变量，默认 512mb；通过 `INFO memory` 定期监控
  - API 入队失败（`ERR maxmemory reached`）时返回 503 并附带说明，**不要伪装成成功**
  - 记录 AOF 文件增长趋势；如有条件，增加 Redis 内存告警（通过 healthcheck 或独立的 exporter）
- [ ] 明确队列 job 保留数量和日志保留策略，防止 Redis AOF 无限增长。
- [ ] 更新部署文档：先启动 infra，再运行 migration，再启动 server 和 worker；水平扩展只增加 worker 副本，不增加 API 内部 processor。

验证：执行 `docker compose config`；启动 API、Worker、Redis、PostgreSQL 后上传大文件，确认 API 在入队后返回，Worker 能读取共享 volume 并完成任务。

### Task 8: 接入前端轮询进度

**Files:**

- Modify: `apps/frontend/src/types/index.ts`
- Modify: `apps/frontend/src/pages/Document/DocumentList.tsx`

- [ ] `DocListItem` 增加 `progress: number`、可选 `processingStage` 和可选 `errorMessage`。
- [ ] processing 状态显示稳定宽度的进度条和阶段文字；success 显示完成，failed 显示错误状态并展示 `errorMessage` 前 200 字符（tooltip 展开完整内容）。
- [ ] 保留现有 5 秒轮询，不新增 SSE/WebSocket。
- [ ] 上传请求成功后立即刷新列表，不能等待解析完成；按钮的 `uploading` 只表示 multipart 上传，不表示整个摄入过程。
- [ ] 处理组件卸载、切换知识库和搜索条件变化时的轮询清理，避免旧请求覆盖新列表。

验证：运行前端类型检查/构建，并用浏览器测试 processing 文档从 0 到 100 的显示和 failed 状态。

### Task 9: 删除与恢复路径

**Files:**

- Modify: `apps/server/src/modules/document/document.service.ts`
- Modify: `apps/server/src/modules/ingestion/ingestion.queue.ts`
- Modify: `packages/rag-engine/src/stores/pgvector-store.ts`
- Test: `apps/server/src/modules/document/document.service.test.ts`

- [ ] 删除流程顺序：① 通过 `doc.jobId` 取消 BullMQ job（`queue.removeJob(jobId)`）；② 删除 PGVector 中该 docId 的向量；③ 删除数据库 chunks、文档记录；④ 删除上传文件。任一步骤失败继续执行后续步骤（独立 try/catch），最终返回结构化错误。
- [ ] 删除操作必须校验 docId 对应的 kbId，避免当前 Controller 忽略 `_kbId` 导致跨知识库删除（参考现有 `document.controller.ts:71` 的路由参数命名风险）。
- [ ] Worker 发现文档已删除时安全退出，不重新创建记录。

验证：删除 queued、processing、success、failed 四种状态文档，确认没有遗留文件、chunks、向量或活跃 job。

### Task 10: 集成验收和观测

**Files:**

- Modify: `apps/server/test/integration/` 下现有文档集成测试
- Modify: `tests/e2e/retrieval.spec.ts` 或新增文档上传 E2E 测试
- Modify: `docs/05-deployment.md`

- [ ] 集成测试覆盖上传接口立即返回，随后通过列表查询观察到 `processing -> success`。
- [ ] 覆盖 Redis 暂时不可用时的入队失败响应和数据库/文件补偿。
- [ ] 覆盖 Worker 重启后的 stalled job 恢复。
- [ ] 覆盖两个不同文档并发上传时 concurrency 生效，实际同时处理数不超过配置值。
- [ ] **覆盖不可重试错误**：上传一个无法解析的文件，确认状态变为 `failed` 且没有重试尝试（`attempts=1`）。
- [ ] **覆盖同一 docId 重复执行不产生重复数据**：手动触发两次相同的 job，确认向量和 chunks 各只有一条。
- [ ] **覆盖 processing 状态文档删除时 job 被取消**：上传一个文档等待 processing 状态，调用删除接口，确认 BullMQ job 被 `removeJob(jobId)` 取消，且没有残留文件、chunks、向量或活跃 job。
- [ ] 增加结构化日志字段：`jobId`、`docId`、`kbId`、`attempt`、`stage`、`durationMs`、`errorType`。
- [ ] 增加最小健康检查：Redis 可连接、队列可读；**Worker 的 healthcheck**（见 Task 7）；Redis 连接失败不能被误报为 API 健康。

验收命令：

```bash
pnpm --filter @knowbase-x/rag-engine build
pnpm --filter @knowbase-x/agents build
pnpm --filter @knowbase-x/server test
pnpm --filter @knowbase-x/server build
pnpm format:check
pnpm test:integration
```

预期结果：所有命令成功；上传接口响应时间不再包含 MinerU/embedding 耗时；重复 job 不增加向量和 chunks；最终失败文档可在列表中看到错误状态。

## 5. 发布顺序与回滚

1. 发布包含新字段兼容代码的版本，先运行数据库 migration。
2. 部署支持新队列但暂不开放大规模上传的 server 和 worker。
3. 用小文件验证基本、MinerU Agent 和 MinerU 三种策略。
4. 设置较低的 `DOCUMENT_QUEUE_CONCURRENCY`，观察 Redis、PG、embedding 服务和 Worker 内存。
5. 逐步提高并发，确认限流、重试和 job 保留符合资源上限。
6. 回滚应用时保留新增字段和队列数据；旧版本不能消费新 job，因此回滚前应暂停上传并清空/迁移未完成 job。

## 6. 完成标准

- API 上传请求只执行文件校验、落盘、文档建记录和入队，不调用 `ingestDocument()`。
- Worker 以独立进程运行，server/worker 共享上传 volume。
- 文档状态不会因中间重试提前变为 `failed`。
- 解析、切片、embedding、落库阶段可通过 DB 进度观察。
- 同一文档重复执行不会产生重复向量或重复 chunks。
- Redis 使用 `noeviction`，队列配置可通过环境变量调整。
- 生产数据库通过 migration 创建进度字段。
- 前端无需 SSE 即可显示处理进度。
- 单元、集成和构建验证全部通过。
