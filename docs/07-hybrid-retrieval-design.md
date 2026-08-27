# 设计文档：混合检索升级（BM25 + Vector + RRF）

> 配套 [06-prd.md](06-prd.md)，承载实现层面的详细设计。PRD 讲「为什么 / 做什么」，本文档讲「怎么做」。

---

## ✅ 阻塞问题拍板记录

| 编号                                       | 结论                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1** 稀疏索引挂哪张表                    | ✅ **挂 `chunks` 表**（不在 `langchainjs` 上加列），方案 B                                                                            |
| **Q2** `langchainjs.id` vs `chunks.id`     | ✅ **不是同一 UUID**。sparse-store 写入时通过 `metadata.docId` 反向查找 `langchainjs.id`；删除时用 `chunk_id = chunks.id` 直接 DELETE |
| **Q3** 中文分词策略                        | ✅ **应用层分词 + simple 配置写 tsvector**，不依赖 zhparser/pg_jieba 扩展                                                             |
| **Q4** hybrid+RRF 是否引入 `minDenseScore` | ✅ **要**，只过滤 dense 候选阶段，默认较松（推荐 env `DEFAULT_MIN_DENSE_SCORE=0.3`）                                                  |
| **Q5** 评测集维护人与 CI                   | ✅ **仓库内 golden set**（`packages/rag-engine/__tests__/fixtures/eval-queries.json`）+ CI 跑冒烟；人工评测集外置，由产品/算法维护    |

---

## 1. 模块边界

```
packages/rag-engine/
├── retrievers/
│   ├── similarity-retriever.ts    # dense（已有，保留）
│   ├── sparse-retriever.ts        # 新增：tsvector 稀疏检索
│   └── hybrid-retriever.ts        # 重写：双路并行 + fusion
├── fusion/
│   ├── rrf.ts                     # 新增：Reciprocal Rank Fusion
│   └── linear.ts                  # 新增：线性加权融合
├── stores/
│   ├── pgvector-store.ts          # dense（已有，扩展 deleteByKbId/docId）
│   └── sparse-store.ts            # 新增：全文索引读写
└── pipeline.ts
    └── performSearch              # 按 retrievalMode 分支调度
```

### 1.1 新增文件职责

| 文件                     | 职责                                                     |
| ------------------------ | -------------------------------------------------------- |
| `sparse-retriever.ts`    | 对 query 分词/规范化 → 查询 tsvector → 返回带排名的切片  |
| `fusion/rrf.ts`          | 接收 dense/sparse 两路有序列表，输出 RRF 加权排序结果    |
| `fusion/linear.ts`       | 接收两路结果，归一化后线性加权合并                       |
| `stores/sparse-store.ts` | 封装 tsvector 列的读写、GIN 索引、按 kbId/docId 批量删除 |

### 1.2 修改文件清单

| 文件                                               | 改动点                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `types.ts`                                         | `SearchParams` 增加 `retrievalMode`、`fusionMethod`、`rrfK`、`candidateMultiplier` |
| `pipeline.ts`                                      | `performSearch` 按模式分支；`retrievalMode=vector` 时保持原逻辑不变                |
| `retrievers/hybrid-retriever.ts`                   | 重写：并行双路 + fusion，替换原 keyword-boost 逻辑                                 |
| `stores/pgvector-store.ts`                         | 补充 `deleteByKbId` / `deleteByDocId`；摄入时同步写 sparse-store                   |
| `retrievers/similarity-retriever.ts`               | 无功能变更，仅适配新 `SearchParams` 接口                                           |
| Server `dto/search.dto.ts`                         | 新增字段 + class-validator 装饰器                                                  |
| Server `retrieval.service.ts`                      | 透传新参数                                                                         |
| Server `chat.service.ts` / `agent-chat.service.ts` | 透传新参数到 rag-engine                                                            |

---

## 2. 检索参数接口（SearchParamsV2）

```typescript
interface SearchParamsV2 {
  /** 最终返回条数 */
  topK: number;
  /** 最低分阈值，语义依赖模式，见 §8.2 */
  minScore?: number;
  /** 检索模式：vector | keyword | hybrid */
  retrievalMode: 'vector' | 'keyword' | 'hybrid';
  /** 仅 linear 融合时有效，0~1，默认 0.5 */
  denseWeight?: number;
  /** 融合方式，默认 'rrf' */
  fusionMethod?: 'rrf' | 'linear';
  /** RRF 公式中的 K 值，默认 60 */
  rrfK?: number;
  /** 每路候选数 = topK × multiplier，默认 3 */
  candidateMultiplier?: number;
  /** 与 retrievalMode 独立，仅控制是否触发重排 */
  useReranker?: boolean;
}
```

### 2.1 向后兼容映射

`SearchParams`（旧）→ `SearchParamsV2`（新）自动映射：

```
retrievalMode = useReranker ? 'hybrid' : 'vector'  // deprecation 路径
fusionMethod  = 'linear'
denseWeight   = 原值（保持不变）
rrfK          = 60
candidateMultiplier = 3
```

映射期间在 `performSearch` 入口处打 deprecation 日志（走 NestJS `Logger.warn`，不用 `console.warn`），下个主版本移除。

---

## 3. 稀疏检索实现

### 3.1 表结构（已定：挂 `chunks` 表）

**决策：Q1=chunks 表，Q2=`langchainjs.id` ≠ `chunks.id`（非同一 UUID）**

```sql
ALTER TABLE chunks ADD COLUMN tsv tsvector;
CREATE INDEX idx_chunks_tsv ON chunks USING GIN (tsv);
-- 可选：partial index 仅在 tsvector 非空时生效
-- CREATE INDEX idx_chunks_tsv_active ON chunks USING GIN (tsv) WHERE tsv IS NOT NULL;
```

**为什么选 `chunks` 而非 `langchainjs`：**

- `langchainjs` 由 LangChain `PGVectorStore` 内部管理，加列有被覆盖的风险
- `chunks` 是业务层 TypeORM 实体，有 `kbId`、`docId` 等直接字段，查询和删除更直观
- `langchainjs.id` 是 PGVector 内部生成，与 `chunks.id` 不是同一值，关联靠摄入时写入 `langchainjs.metadata.docId`

**写入时序（修改 §6.1）：**

```
ingestDocument()
  ├── splitDocuments()            → chunks[]
  ├── embedDocuments()            → vectors[]
  ├── addDocumentsToPG()          → langchainjs（向量行）
  ├── addDocumentsToChunks()      → chunks 表（content_tsv 同批次写）
  └── writeSparseIndex()          → UPDATE chunks SET tsv = to_tsvector('simple', content)
```

**删除时序：**

```
deleteByDocId(docId)
  ├── DELETE FROM langchainjs WHERE metadata @> '{"docId": $1}'  // 已有
  └── DELETE FROM chunks WHERE doc_id = $1                       // 新增：连带清除 tsv

deleteByKbId(kbId)  // 新增
  ├── DELETE FROM langchainjs WHERE metadata->>'kbId' = $1
  └── DELETE FROM chunks WHERE kb_id = $1
```

**查询 SQL（见 §3.3）：**

```sql
SELECT id, content, ts_rank(tsv, q) AS rank
FROM chunks
WHERE tsv @@ $1 AND kb_id = $2
ORDER BY rank DESC
LIMIT $3;
```

### 3.2 中文分词策略（已定：应用层分词 + simple 配置）

**决策：Q3 = 应用层分词，写入 `to_tsvector('simple', ...)`**

不依赖 `zhparser` / `pg_jieba` PG 扩展，降低部署复杂度。

**摄入侧（写入 tsv）：**

```typescript
// 使用 node-jieba 或类似库对 content 分词
const tokens = jieba.cut(content); // ['如何', '重置', '密码']
// 用 simple 配置单元：简单按空格分隔，数字/错误码保留原样
const tsv = toTsVectorSimple(tokens); // to_tsvector('simple', '如何 重置 密码')
await db.query('UPDATE chunks SET tsv = $1 WHERE id = $2', [tsv, chunk.id]);
```

**查询侧（构造 tsquery）：**

```typescript
// 同分词器处理 query，保证查询与文档侧一致
const tokens = jieba.cut(query); // '怎么重置密码' → ['怎么', '重置', '密码']
const tsquery = buildTsQuery(tokens); // '怎么' & '重置' & '密码'
```

**无空格中文处理：**
jieba 本身支持无空格输入，切分结果自然按词边界分割，无需额外 N-gram。

**降级路径：**
若 node-jieba 不可用，兜底为字符级 N-gram（unigram/bigram），质量次之但可运行。

**后续升级：**
部署环境支持时，可切换为 `zhparser` 扩展 + `Chinese` 配置单元，查询 SQL 不变，仅改配置单元名。

### 3.3 sparse-retriever.ts 核心逻辑

```typescript
async function sparseSearch(
  query: string,
  filter: { kbId: string },
  topK: number,
): Promise<RetrievalResult[]> {
  // 1. 分词/规范化 query（与摄入侧使用同一 jieba 实例）
  const tokens = tokenize(query);
  // 2. 构造 tsquery（AND 组合，覆盖无空格中文）
  const tsquery = buildTsQuery(tokens);
  // 3. 执行检索，按 ts_rank 排序，取 topK × candidateMultiplier
  const results = await db.query(
    `SELECT id, content, ts_rank(tsv, q) AS rank
     FROM chunks
     WHERE tsv @@ $1 AND kb_id = $2
     ORDER BY rank DESC
     LIMIT $3`,
    [tsquery, filter.kbId, topK * CANDIDATE_MULTIPLIER],
  );
  // 4. 返回，score = rank（不参与归一化，由 fusion 层处理）
  return results.map((row) => ({
    content: row.content,
    score: row.rank,
    sourceFile: 'unknown', // chunks 表无 sourceFile，由上层回填
    metadata: { chunkId: row.id, kbId: filter.kbId },
  }));
}
```

---

## 4. 融合算法

### 4.1 RRF（默认）

**公式：**

$$\mathrm{RRF}(d) = \sum_{r \in \{\text{dense},\ \text{sparse}\}} \frac{1}{k + \mathrm{rank}_r(d)}$$

- `rank` 从 1 开始
- 未出现在某路的文档，该项为 0
- `k` 默认 60，可配置 `rrfK`
- 最终按 RRF 分降序取 topK

**实现：`fusion/rrf.ts`**

```typescript
export function rrfFuse(
  dense: RetrievalResult[],
  sparse: RetrievalResult[],
  k: number = 60,
): RetrievalResult[] {
  const scoreMap = new Map<string, number>();
  for (let i = 0; i < dense.length; i++) {
    const id = dense[i].metadata?.chunkId as string;
    scoreMap.set(id, (scoreMap.get(id) ?? 0) + 1 / (k + i + 1));
  }
  for (let i = 0; i < sparse.length; i++) {
    const id = sparse[i].metadata?.chunkId as string;
    scoreMap.set(id, (scoreMap.get(id) ?? 0) + 1 / (k + i + 1));
  }
  return Object.entries(scoreMap)
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);
}
```

### 4.2 Linear（可选）

```
s_dense_norm = min-max(z-score) 归一化到 [0, 1]   ← 选定一种，全工程统一
s_sparse_norm = min-max(z-score) 归一化到 [0, 1]
s = w × s_dense_norm + (1 - w) × s_sparse_norm
```

仅出现在一路的文档：另一路视为 0（不施加存在惩罚）。

**实现：`fusion/linear.ts`**

```typescript
export function linearFuse(
  dense: RetrievalResult[],
  sparse: RetrievalResult[],
  weight: number = 0.5,
): RetrievalResult[] {
  const all = [...dense, ...sparse];
  const denseScores = dense.map((r) => r.score);
  const sparseScores = sparse.map((r) => r.score);
  const dRange = max(denseScores) - min(denseScores) || 1;
  const sRange = max(sparseScores) - min(sparseScores) || 1;

  return all
    .map((r) => {
      const inDense = dense.find((d) => d.metadata?.chunkId === r.metadata?.chunkId);
      const inSparse = sparse.find((s) => s.metadata?.chunkId === r.metadata?.chunkId);
      const normDense = inDense ? (inDense.score - min(denseScores)) / dRange : 0;
      const normSparse = inSparse ? (inSparse.score - min(sparseScores)) / sRange : 0;
      return { ...r, score: weight * normDense + (1 - weight) * normSparse };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);
}
```

---

## 5. Pipeline 改造

### 5.1 `performSearch` 调度逻辑

```typescript
async function performSearch(
  query: string,
  filter: { kbId: string },
  params: SearchParamsV2,
  config: RAGPipelineConfig,
): Promise<RetrievalResult[]> {
  const { retrievalMode, fusionMethod, rrfK, candidateMultiplier, useReranker, ...rest } = params;
  const candidatesPerRoute = Math.ceil(rest.topK * (candidateMultiplier ?? 3));

  // candidateMultiplier 硬上限，防止极端参数导致 OOM
  const CAPPED_MULTIPLIER = Math.min(candidatesPerRoute / rest.topK, 10);
  const candidatesPerRouteFinal = Math.ceil(rest.topK * CAPPED_MULTIPLIER);

  // 缓存 key 必须包含 retrievalMode / fusionMethod / rrfK；
  // ⚠️ 当前 search-cache.ts 的签名不含这三个参数，需要一并改造。
  // 旧签名：getCachedResults(query, kbId, topK, minScore, denseWeight)
  // 新签名：getCachedResults(query, kbId, topK, minScore, retrievalMode, fusionMethod, rrfK)
  const cached = await getCachedResults(
    query,
    filter.kbId,
    rest.topK,
    rest.minScore,
    retrievalMode,
    fusionMethod,
    rrfK,
  );
  if (cached !== null) return cached;

  let results: RetrievalResult[];

  switch (retrievalMode) {
    case 'vector':
      results = await similaritySearch({ ...rest, query, filter }, store, embeddingConfig);
      break;

    case 'keyword':
      results = await sparseSearch({ query, filter, topK: rest.topK }, sparseStore);
      break;

    case 'hybrid': {
      const [dense, sparse] = await Promise.all([
        similaritySearch(
          { ...rest, query, filter, topK: candidatesPerRouteFinal },
          store,
          embeddingConfig,
        ),
        sparseSearch({ query, filter, topK: candidatesPerRouteFinal }, sparseStore),
      ]);
      const fuseFn = fusionMethod === 'linear' ? linearFuse : rrfFuse;
      results = fuseFn(
        dense,
        sparse,
        fusionMethod === 'linear' ? (params.denseWeight ?? 0.5) : (rrfK ?? 60),
      );
      break;
    }
  }

  // minScore 过滤语义依赖模式（见 §8.2）
  results = applyMinScore(results, params, retrievalMode);

  if (useReranker && results.length > 0) {
    results = await rerank(query, results, config.embedding, { topK: rest.topK });
  }

  setCachedResults(
    query,
    filter.kbId,
    rest.topK,
    rest.minScore,
    retrievalMode,
    fusionMethod,
    rrfK,
    results,
  );
  return results;
}
```

### 5.2 向后兼容桥接（deprecation 期）

当请求不含 `retrievalMode` 时，按以下规则补全：

```typescript
function resolveMode(params: Partial<SearchParamsV2>): SearchParamsV2 {
  if (params.retrievalMode) return params as SearchParamsV2;
  // 旧参数走兼容路径
  console.warn(
    '[DEPRECATED] retrievalMode not provided; inferred from useReranker. ' +
      'Migrate to explicit retrievalMode=vector|hybrid.',
  );
  return {
    retrievalMode: params.useReranker ? 'hybrid' : 'vector',
    fusionMethod: 'linear',
    denseWeight: params.denseWeight ?? 0.5,
    rrfK: 60,
    candidateMultiplier: 3,
    ...params,
  };
}
```

---

## 6. 摄入一致性

### 6.1 写入时序

```
ingestDocument()
  ├── splitDocuments()             → chunks[]
  ├── embedDocuments()             → vectors[]
  ├── addDocumentsToPG()           → langchainjs（向量行）
  └── writeSparseToChunks()        → UPDATE chunks SET tsv = to_tsvector('simple', content)
                                     与 addDocumentsToPG 同 worker，顺序写入
```

**事务策略：** `addDocumentsToPG` 与 `writeSparseToChunks` **不在同一事务**（PGVectorStore 内部事务不可控）。改为 outbox 模式：先写 `chunks`（含 tsv），再写 `langchainjs`；若 `langchainjs` 写入失败，启动期校验任务对比两表记录数，对缺失的 `docId` 触发补写。

### 6.2 失败处理

| 失败点                     | 处理                                                                 |
| -------------------------- | -------------------------------------------------------------------- |
| `addDocumentsToPG` 失败    | `chunks` 行已写入，启动期校验任务发现 langchainjs 无对应行时触发补写 |
| `writeSparseToChunks` 失败 | `langchainjs` 已写入，`chunks` 补写 job 由同一 worker 重试           |
| Worker 重试                | 按 `docId` 幂等：先清理本次 `docId` 的两路数据，再重跑               |

### 6.3 删除一致性

```
deleteByDocId(docId: string)      // 现有 + 补充 chunks 清理
  ├── DELETE FROM langchainjs WHERE metadata @> '{"docId": $1}'
  └── DELETE FROM chunks WHERE doc_id = $1                  // 新增

deleteByKbId(kbId: string)        // 新增
  ├── DELETE FROM langchainjs WHERE metadata->>'kbId' = $1
  └── DELETE FROM chunks WHERE kb_id = $1
```

---

## 7. 可观测字段

debug 模式（`debug=true` header 或内部管理端）下，每次检索返回：

```json
{
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
```

生产环境不返回 `rankDense`、`rankSparse` 等明细字段，仅返回最终 `score`。

---

## 8. API / 配置

### 8.1 HTTP 参数（SearchDto）

| 参数                  | 类型                            | 必填 | 默认值   | 说明                            |
| --------------------- | ------------------------------- | ---- | -------- | ------------------------------- |
| `retrievalMode`       | `'vector'\|'keyword'\|'hybrid'` | 否   | `vector` | 检索模式                        |
| `fusionMethod`        | `'rrf'\|'linear'`               | 否   | `rrf`    | 融合方式                        |
| `rrfK`                | `number`                        | 否   | `60`     | RRF 常数                        |
| `candidateMultiplier` | `number`                        | 否   | `3`      | 每路候选倍数（硬上限 10）       |
| `denseWeight`         | `number`                        | 否   | `0.5`    | linear 权重，0~1                |
| `topK`                | `number`                        | 否   | `10`     | 返回条数                        |
| `minScore`            | `number`                        | 否   | 见 §8.2  | 模式化阈值                      |
| `minDenseScore`       | `number`                        | 否   | null     | 仅 hybrid 模式，过滤 dense 候选 |
| `useReranker`         | `boolean`                       | 否   | `false`  | 是否重排                        |

### 8.2 `minScore` / `minDenseScore` 语义分化

| 参数            | 适用模式               | 行为                                                                                                     |
| --------------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `minScore`      | `vector`               | 过滤最终结果，默认 0.7                                                                                   |
| `minScore`      | `keyword`              | **默认不启用**（稀疏分无固定上限，阈值业务意义不明确）                                                   |
| `minScore`      | `hybrid + rrf`         | **默认不启用**（RRF 分无固定范围，0.7 会误杀）                                                           |
| `minScore`      | `hybrid + linear`      | 过滤融合后最终结果（归一化后 0~1），语义同 `vector`                                                      |
| `minDenseScore` | `hybrid`（rrf/linear） | **新增可选参数**，只在 dense 候选阶段过滤，默认 `null`（不施加）；建议 env `DEFAULT_MIN_DENSE_SCORE=0.3` |

> `minDenseScore` 仅在 `retrievalMode=hybrid` 时生效，对 `vector` / `keyword` 无效。

### 8.3 环境变量

```bash
DEFAULT_RETRIEVAL_MODE=vector
DEFAULT_FUSION_METHOD=rrf
DEFAULT_RRF_K=60
DEFAULT_CANDIDATE_MULTIPLIER=3
DEFAULT_DENSE_WEIGHT=0.5
DEFAULT_MIN_SCORE=0.7                # 仅对 vector 模式生效
DEFAULT_MIN_DENSE_SCORE=0.3          # 仅对 hybrid 模式的 dense 候选生效，null 表示不施加
RAG_RESULT_CACHE_TTL_MS=300000       # 5分钟，已有
```

---

## 9. 性能约束

| 项   | 目标                                                                                |
| ---- | ----------------------------------------------------------------------------------- |
| 索引 | 稀疏列 GIN；向量侧维持现有 IVF/flat 策略                                            |
| 延迟 | hybrid P95 相对纯向量增幅 **< 50ms**（同机、候选 ≤ 3×topK，不含 embedding 网络）    |
| 写入 | 摄入批次内 sparse 更新不显著拖慢 embedding 批处理                                   |
| 查询 | 两路并行 `Promise.all`                                                              |
| 缓存 | query→结果的进程内缓存 TTL 5min（已有）；mode/fusion/rrfK 变化时需独立 key          |
| 上限 | `candidateMultiplier` 硬上限 **10**（即每路候选 ≤ 10 × topK），防止极端参数导致 OOM |

---

## 10. 迁移计划

### 10.1 兼容性阶段（M3 之前）

- 保留旧 `hybridSearch`（keyword-boost）逻辑，标记 `legacyKeywordBoost`，默认关
- 新 `retrievalMode` 参数进入但不影响默认行为
- 旧客户端不传 `retrievalMode` 时走兼容桥接（§5.2），打 deprecation 日志

### 10.2 清理阶段（M5）

- 确认所有客户端已迁移到显式 `retrievalMode`
- 删除 `legacyKeywordBoost` 分支和桥接逻辑
- `SearchParams` 旧字段 `denseWeight` 语义升级为「linear 融合权重」
- `useReranker=true` 不再隐式触发 hybrid

---

## 11. 测试计划

### 11.1 单测（包内）

| 测试文件                              | 覆盖点                                                  |
| ------------------------------------- | ------------------------------------------------------- |
| `fusion/rrf.test.ts`                  | 单路/双路/并列/空列表/大 k 值边界                       |
| `fusion/linear.test.ts`               | 归一化一致性/单路文档/权重边界 0/1                      |
| `retrievers/sparse-retriever.test.ts` | 中文分词、英文、数字错误码命中                          |
| `retrievers/hybrid-retriever.test.ts` | hybrid 模式双路并行、融合正确性、mode 分支              |
| `pipeline.test.ts`                    | `retrievalMode=vector` 结果与旧版等价；缓存 key 含 mode |

### 11.2 集成测

- M1：sparse-search 端到端（PG 真实连接）
- M2：hybrid-search 端到端（双路并行 + fusion）
- M5：摄入一致性（写入→删除→再查应返回空）

### 11.3 中文 Case 集（验收用，≥ 20 条）

| 类型       | 示例 Query                       | 期望                          |
| ---------- | -------------------------------- | ----------------------------- |
| 无空格中文 | `怎么重置密码`                   | 命中"如何重置密码"相关切片    |
| 错误码     | `E-1042`                         | 精确命中含 `E-1042` 的切片    |
| 中英混合   | `token expired 怎么处理`         | 两路均有命中，融合后排序合理  |
| 同义改写   | `如何修改头像` vs `更换头像方法` | dense 通路命中，sparse 不干扰 |

---

## 12. 开放问题与决策记录

以下问题已在文档顶部「拍板记录」解决，此处保留决策摘要供追溯：

| 编号 | 问题                                 | 决策                                                          |
| ---- | ------------------------------------ | ------------------------------------------------------------- |
| Q1   | 稀疏索引挂哪张表                     | ✅ 挂 `chunks` 表（见 §3.1）                                  |
| Q2   | `langchainjs.id` 与 `chunks.id` 关系 | ✅ 不是同一 UUID，sparse-store 用 `docId` 反向关联（见 §3.1） |
| Q3   | 中文分词策略                         | ✅ 应用层 jieba 分词 + simple 配置写 tsvector（见 §3.2）      |
| Q4   | `minDenseScore` 引入                 | ✅ 要，仅 hybrid 模式，过滤 dense 候选，默认 `0.3`（见 §8.2） |
| Q5   | 评测集维护与 CI                      | ✅ 仓库内 golden set + CI 冒烟；人工集外置（见 §11.2）        |
