# 实施计划：混合检索升级（BM25 + Vector + RRF）

> 配套 [06-prd.md](06-prd.md) 和 [07-hybrid-retrieval-design.md](07-hybrid-retrieval-design.md)

---

## 拍板结论速查

| #   | 决策                                                                |
| --- | ------------------------------------------------------------------- |
| Q1  | 稀疏索引挂 `chunks` 表（加 `tsv tsvector` 列 + GIN 索引）           |
| Q2  | `langchainjs.id ≠ chunks.id`，sparse-store 用 `chunks.id` 直接读写  |
| Q3  | 应用层 jieba 分词 + `to_tsvector('simple', ...)` 写 tsvector        |
| Q4  | 引入 `minDenseScore`（可选，仅 hybrid 模式，默认 null）             |
| Q5  | 评测集放 `packages/rag-engine/__tests__/fixtures/eval-queries.json` |

---

## 阶段划分

| 阶段 | 内容                                       | 完成标准                                                         |
| ---- | ------------------------------------------ | ---------------------------------------------------------------- |
| M1   | 稀疏索引模型 + 摄入/删除同步               | `sparse-store.ts` 可通过单元测试；DB migration 可执行            |
| M2   | 重写 hybridSearch：并行双路 + RRF + linear | `fusion/*.test.ts` 全绿；`hybrid-retriever.test.ts` 重写         |
| M3   | pipeline / Server DTO / 默认配置 / 兼容层  | `retrieve()` 和 `retrieveAndChat()` 接受新参数；旧客户端行为不变 |
| M4   | 前端调试参数（独立 task，本计划不覆盖）    | —                                                                |
| M5   | 可观测字段 + 旧 boost 下线                 | deprecation 日志不再输出                                         |

---

## Step 清单（按执行顺序）

### S1 — DB Migration：给 `chunks` 表加 `tsv` 列

**文件：** `apps/server/src/database/migrations/XXXXX-add-chunks-tsv-column.ts`

```sql
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS tsv tsvector;
CREATE INDEX IF NOT EXISTS idx_chunks_tsv ON chunks USING GIN (tsv);
```

**验收：** migration 执行后 `chunks` 表有 `tsv` 列和 GIN 索引。

---

### S2 — 新增 `tokenizer.ts`（应用层分词工具）

**文件：** `packages/rag-engine/src/tokenizer.ts`（新建）

```typescript
/**
 * 应用层分词器：
 * 1. 中文用 jieba（如可用），英文/数字/错误码保留原样
 * 2. 兜底：按字符边界拆分（无空格中文也能命中）
 * 返回 lowercase token 数组，供 tsvector/tsquery 使用
 */
export function tokenize(query: string): string[];

/**
 * 将 token 数组转为 simple 配置的 tsvector 字符串
 * 例：['如何', '重置', '密码'] → '如何 重置 密码'
 */
export function tokensToTsvString(tokens: string[]): string;

/**
 * 将 token 数组转为 PostgreSQL tsquery 字符串（AND 连接）
 * 例：['怎么', '重置', '密码'] → '怎么' & '重置' & '密码'
 */
export function tokensToTsQuery(tokens: string[]): string;
```

**依赖：** 优先尝试 `require('node-jieba')`，失败则降级为字符级切分。

**测试：** `tokenizer.test.ts` — 中文无空格、英文空格、中英混合、数字/错误码。

---

### S3 — 新增 `stores/sparse-store.ts`

**文件：** `packages/rag-engine/src/stores/sparse-store.ts`（新建）

封装对 `chunks.tsv` 列的读写，使用独立 `pg.Pool`（与 pgvector-store 相同模式）。

```typescript
/**
 * 批量写入/更新 chunks.tsv（摄入时调用）
 * @param dbConfig PG 连接配置
 * @param tableName chunks 表名（默认 'chunks'）
 * @param updates [{ id, content }] 数组
 */
export async function writeSparseIndex(
  dbConfig: PGConfig,
  tableName: string,
  updates: { id: string; content: string }[],
): Promise<void>;

/**
 * 按 docId 批量删除 chunks.tsv（删除文档时调用）
 */
export async function deleteSparseByDocId(
  dbConfig: PGConfig,
  tableName: string,
  docId: string,
): Promise<{ deleted: number }>;

/**
 * 按 kbId 批量删除 chunks.tsv（删除知识库时调用）
 */
export async function deleteSparseByKbId(
  dbConfig: PGConfig,
  tableName: string,
  kbId: string,
): Promise<{ deleted: number }>;
```

**测试：** `sparse-store.test.ts` — mock `pg.Pool`，验证 SQL 正确性。

---

### S4 — 新增 `fusion/rrf.ts` + `fusion/linear.ts`

**文件：**

- `packages/rag-engine/src/fusion/rrf.ts`（新建）
- `packages/rag-engine/src/fusion/linear.ts`（新建）
- `packages/rag-engine/src/fusion/rrf.test.ts`（新建）
- `packages/rag-engine/src/fusion/linear.test.ts`（新建）

**rrfFuse：**

```typescript
export function rrfFuse(
  dense: RetrievalResult[],
  sparse: RetrievalResult[],
  k: number,
): RetrievalResult[];
```

按 chunkId 聚合 RRF 分，降序取 topK。

**linearFuse：**

```typescript
export function linearFuse(
  dense: RetrievalResult[],
  sparse: RetrievalResult[],
  weight: number,
): RetrievalResult[];
```

min-max 归一化到 [0,1]，线性加权，单路文档另一路计 0。

**测试重点：**

- 空列表、单路输入、双路完全重叠、双路无交集
- linear 权重边界（0 / 0.5 / 1）
- RRF k 值敏感性

---

### S5 — 新增 `retrievers/sparse-retriever.ts`

**文件：** `packages/rag-engine/src/retrievers/sparse-retriever.ts`（新建）

```typescript
export interface SparseSearchParams {
  query: string;
  filter: { kbId: string };
  topK: number;
}

export async function sparseSearch(
  params: SparseSearchParams,
  dbConfig: PGConfig,
  tableName: string,
): Promise<RetrievalResult[]>;
```

**逻辑：** tokenize → buildTsQuery → `SELECT id, content, ts_rank(tsv, q) AS rank FROM chunks WHERE tsv @@ $1 AND kb_id = $2 ORDER BY rank DESC LIMIT $3` → 映射为 RetrievalResult。

**测试：** `sparse-retriever.test.ts` — mock pg.Pool。

---

### S6 — 重写 `retrievers/hybrid-retriever.ts`

**文件：** `packages/rag-engine/src/retrievers/hybrid-retriever.ts`（重写）

替换原 keyword-boost 逻辑，改为并行双路 + fusion：

```typescript
export interface HybridSearchParams extends SearchParams {
  query: string;
  filter?: Record<string, unknown>;
  /** 每路候选数（调用方已乘 candidateMultiplier） */
  candidatesPerRoute: number;
  fusionMethod: 'rrf' | 'linear';
  fusionParam: number; // rrfK 或 denseWeight
  dbConfig: PGConfig;
  sparseTableName: string;
}

export async function hybridSearch(
  params: HybridSearchParams,
  vectorStore: VectorStoreLike,
  embeddingConfig: EmbeddingConfig,
): Promise<RetrievalResult[]>;
```

**逻辑：** `Promise.all([similaritySearch(..., candidatesPerRoute), sparseSearch(...)])` → fuse → sort → slice(topK)。

**旧逻辑处理：** 原 `hybridSearch` 签名不变（保持向后兼容），内部调用新 `hybridSearch`；同时保留一个 `legacyKeywordBoost` 入口供兼容路径使用（M3 之前默认关）。

**测试：** 重写 `hybrid-retriever.test.ts`，移除 keyword-boost 断言，改为验证双路并行 + fusion 结果。

---

### S7 — 更新 `types.ts`：SearchParams 增加新字段

**文件：** `packages/rag-engine/src/types.ts`

```typescript
export interface SearchParams {
  topK: number;
  minScore: number;
  useReranker: boolean;
  denseWeight: number;
  /** 新增 */
  retrievalMode?: 'vector' | 'keyword' | 'hybrid';
  fusionMethod?: 'rrf' | 'linear';
  rrfK?: number;
  candidateMultiplier?: number;
  minDenseScore?: number | null;
}
```

旧调用方不传这些字段时，`pipeline.ts` 自动补全（见 S9）。

---

### S8 — 更新 `cache/search-cache.ts`：缓存 key 包含 mode 参数

**文件：** `packages/rag-engine/src/cache/search-cache.ts`

新增参数参与 hash：`retrievalMode`、`fusionMethod`、`rrfK`、`minDenseScore`。

```typescript
function makeCacheKey(
  query: string,
  kbId: string,
  topK: number,
  minScore: number | undefined,
  retrievalMode: string,
  fusionMethod: string,
  rrfK: number,
  minDenseScore: number | undefined,
): string;
```

---

### S9 — 重写 `pipeline.ts` 的 `performSearch`

**文件：** `packages/rag-engine/src/pipeline.ts`

```typescript
// 向后兼容桥接
function resolveSearchParams(params: Partial<SearchParams>): SearchParams {
  if (params.retrievalMode) return params as SearchParams;
  // deprecation 路径
  logger.warn('[DEPRECATED] retrievalMode not provided; auto-resolved');
  return {
    retrievalMode: params.useReranker ? 'hybrid' : 'vector',
    fusionMethod: 'linear',
    denseWeight: params.denseWeight ?? 0.5,
    rrfK: 60,
    candidateMultiplier: 3,
    minDenseScore: null,
    ...params,
  };
}
```

主逻辑：

1. `resolveSearchParams(params)` → 补全默认值
2. `candidatesPerRoute = ceil(topK * min(candidateMultiplier, 10))`
3. 按 `retrievalMode` switch：
   - `'vector'` → `similaritySearch`，过滤 `minScore`
   - `'keyword'` → `sparseSearch`，不过滤（minScore 对稀疏分无意义）
   - `'hybrid'` → 并行双路 → fuse → 过滤 `minScore`（linear）或不过滤（rrf）→ 过滤 `minDenseScore`（rrf/linear 都在 dense 候选阶段）
4. 可选 rerank
5. 写缓存（新 key 签名）

**摄入时同步写 sparse：** 在 `ingestDocument` 里，`addDocumentsToPG` 成功后追加 `writeSparseIndex` 调用。

---

### S10 — 更新 `index.ts` 导出

**文件：** `packages/rag-engine/src/index.ts`

新增导出：`sparseSearch`、`rrfFuse`、`linearFuse`、`writeSparseIndex`、`deleteSparseByDocId`、`deleteSparseByKbId`、`tokenize`。

---

### S11 — 更新 Server DTO 和 Service

**文件：**

- `apps/server/src/modules/retrieval/dto/search.dto.ts` — 新增 `retrievalMode`、`fusionMethod`、`rrfK`、`candidateMultiplier`、`minDenseScore`
- `apps/server/src/modules/retrieval/retrieval.service.ts` — 透传新参数到 `retrieve()`
- `apps/server/src/modules/chat/chat.service.ts` — `ChatStreamBody.params` 新增字段，`normalizedParams` 透传
- `apps/server/src/modules/agents/agent-chat.service.ts` — `normalizeParams` 透传新字段

---

### S12 — 更新现有测试

**需要改写的测试：**

- `packages/rag-engine/src/pipeline.test.ts` — mock `sparseStore`，验证新模式分支
- `packages/rag-engine/src/retrievers/hybrid-retriever.test.ts` — 重写为双路 + fusion 测试
- `apps/server/src/modules/retrieval/retrieval.service.test.ts` — 新增 hybrid 模式用例
- `apps/server/src/modules/chat/chat.service.test.ts` — 新增新参数透传用例

**不要改动：** `similarity-retriever.test.ts`（无变更）、`bi-encoder-reranker.test.ts`（无变更）。

---

### S13 — 新增评测集 fixture

**文件：** `packages/rag-engine/__tests__/fixtures/eval-queries.json`

≥ 20 条中英混合查询，每条附带期望命中的 chunkId 列表（用于 M5 离线评测）。

---

## 执行顺序依赖图

```
S1 (migration) ──┐
                 ├──→ S3 (sparse-store) ──→ S5 (sparse-retriever)
S2 (tokenizer) ──┘                          │
                                            ▼
S4 (fusion) ────────────────────────────────┼──→ S6 (hybrid-retriever)
                                            │        │
S7 (types.ts) ──────────────────────────────┼──→ S8 (cache) ──→ S9 (pipeline)
                                            │                     │
S10 (index.ts) ←───────────────────────────┴─────────────────────┘
         │
         ▼
S11 (server DTOs/services)
         │
         ▼
S12 (tests) + S13 (eval fixture)
```

**建议先 S1+S2+S3+S4 并行（无依赖），再 S5+S6+S7+S8 并行，最后 S9+S10+S11+S12+S13 顺序执行。**

---

## 风险点提醒

1. **jieba 不可用时兜底**：`tokenizer.ts` 必须优雅降级，不能抛异常
2. **chunks 表 tsv 列为 null 时的查询**：`WHERE tsv @@ $1` 在 tsv 为 null 时自动跳过，无需额外过滤
3. **缓存 key 变更**：旧缓存条目的 key 不含 mode，变更后立即失效，不影响功能，但短期命中率下降
4. **向后兼容**：M3 之前不传 `retrievalMode` 时走兼容桥接，确保旧客户端不受影响
