# 混合检索升级设计文档（BM25 + Vector + RRF）

> **状态：✅ 已完成**（2026-08-27）

---

## 一、产品背景

### 1.1 问题

原有代码仅对向量召回结果做二元词命中加分，存在以下缺陷：

- 无独立稀疏检索通路
- 无 BM25 / tsvector 索引
- 无 RRF / Linear 融合算法
- `useReranker` 隐式切换检索模式，职责不清

**产品影响：** 专有名词、错误码、工单号、函数名等关键词密集型查询容易被向量排后或未进 topK。

### 1.2 目标

1. 双路召回（Dense + Sparse）
2. 标准融合（RRF 默认，Linear 可选）
3. 解耦 `useReranker` 与检索模式
4. 中文支持（N-gram + jieba 可选）
5. 可观测（debug 模式返回每 item 的 rank/score 明细）
6. 向后兼容（旧客户端默认 vector 模式）

### 1.3 成功指标

| 指标                    | 目标                     |
| ----------------------- | ------------------------ |
| 专有名词 recall@10 提升 | +15% vs 纯向量           |
| hybrid P95 延迟增量     | < 50ms（不含 embedding） |
| 候选倍数硬上限          | 10                       |

---

## 二、拍板决策

| 编号   | 问题                                | 结论                                                                              |
| ------ | ----------------------------------- | --------------------------------------------------------------------------------- |
| **Q1** | 稀疏索引挂哪张表                    | 挂 `chunks` 表（不在 `langchainjs` 上加列）                                       |
| **Q2** | `langchainjs.id` vs `chunks.id`     | 不是同一 UUID，sparse-store 用 `docId` 反向关联；通过 `chunk_id` 列直接关联两路   |
| **Q3** | 中文分词策略                        | 应用层 N-gram（unigram+bigram）fallback，jieba 可选优化，不依赖 zhparser/pg_jieba |
| **Q4** | hybrid+RRF 是否引入 `minDenseScore` | 要，只过滤 dense 候选阶段，默认 `null`，env `DEFAULT_MIN_DENSE_SCORE=0.3`         |
| **Q5** | 评测集维护与 CI                     | 仓库内 golden set（`fixtures/eval-queries.json`）+ CI 冒烟                        |

---

## 三、模块边界

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

### 新增文件

| 文件                     | 职责                                                     |
| ------------------------ | -------------------------------------------------------- |
| `sparse-retriever.ts`    | 对 query 分词/规范化 → 查询 tsvector → 返回带排名的切片  |
| `fusion/rrf.ts`          | 接收 dense/sparse 两路有序列表，输出 RRF 加权排序结果    |
| `fusion/linear.ts`       | 接收两路结果，归一化后线性加权合并                       |
| `stores/sparse-store.ts` | 封装 tsvector 列的读写、GIN 索引、按 kbId/docId 批量删除 |

### 修改文件

| 文件                                               | 改动点                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `types.ts`                                         | `SearchParams` 增加 `retrievalMode`、`fusionMethod`、`rrfK`、`candidateMultiplier`、`minDenseScore`、`debug` |
| `pipeline.ts`                                      | `performSearch` 按模式分支；`retrievalMode=vector` 时保持原逻辑不变                                          |
| `retrievers/hybrid-retriever.ts`                   | 重写：并行双路 + fusion，替换原 keyword-boost 逻辑                                                           |
| `stores/pgvector-store.ts`                         | 补充 `deleteByKbId` / `deleteByDocId`；摄入时同步写 sparse-store                                             |
| `cache/search-cache.ts`                            | 缓存 key 包含 `retrievalMode`、`fusionMethod`、`rrfK`、`minDenseScore`                                       |
| Server `dto/search.dto.ts`                         | 新增字段 + class-validator 装饰器                                                                            |
| Server `retrieval.service.ts`                      | 透传新参数                                                                                                   |
| Server `chat.service.ts` / `agent-chat.service.ts` | 透传新参数到 rag-engine                                                                                      |

---

## 四、检索参数接口

```typescript
interface SearchParams {
  topK: number;
  minScore?: number;
  retrievalMode?: 'vector' | 'keyword' | 'hybrid';
  fusionMethod?: 'rrf' | 'linear';
  rrfK?: number;
  candidateMultiplier?: number;
  denseWeight?: number;
  minDenseScore?: number | null;
  useReranker?: boolean;
  debug?: boolean;
}
```

### 向后兼容

未传 `retrievalMode` 时自动映射：

```
retrievalMode = useReranker ? 'hybrid' : 'vector'
fusionMethod  = 'linear'
denseWeight   = 原值
rrfK          = 60
candidateMultiplier = 3
```

映射期间打 deprecation 日志（`Logger.warn`），下个主版本移除。

---

## 五、稀疏检索实现

### 5.1 DB Migration

```sql
-- 稀疏检索全文索引
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS tsv tsvector;
CREATE INDEX IF NOT EXISTS idx_chunks_tsv ON chunks USING GIN (tsv);

-- dense/sparse 两路关联 ID
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS chunk_id text;
CREATE INDEX IF NOT EXISTS idx_chunks_chunk_id ON chunks (chunk_id);
```

**为什么选 `chunks` 而非 `langchainjs`：**

- `langchainjs` 由 LangChain 内部管理，加列有被覆盖的风险
- `chunks` 有 `kbId`、`docId` 等直接字段，查询和删除更直观

**写入时序：**

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
  ├── DELETE FROM langchainjs WHERE metadata @> '{"docId": $1}'
  └── DELETE FROM chunks WHERE doc_id = $1

deleteByKbId(kbId)
  ├── DELETE FROM langchainjs WHERE metadata->>'kbId' = $1
  └── DELETE FROM chunks WHERE kb_id = $1
```

### 5.2 中文分词策略

实际实现在 `packages/rag-engine/src/tokenizer.ts`：

- **默认策略**：字符级 N-gram（unigram + bigram）
  - 英文单词整体保留（如 `"E-1042"`、`"pdf"`）
  - 中文字符拆为单字 unigram，相邻两字组成 bigram
  - 结果统一 lowercased
- **jieba 降级**：若安装了 `node-jieba`，可切换为 jieba 分词（质量更优，但非必须）
- **降级路径**：若 jieba 不可用，自动回退到 N-gram 策略

**摄入侧：**

```typescript
import { tokenize, tokensToTsvString } from './tokenizer';
const tokens = tokenize(content); // ['如何', '重置', '密码']
const tsvString = tokensToTsvString(tokens); // "如何 重置 密码"
await db.query("UPDATE chunks SET tsv = to_tsvector('simple', $1) WHERE id = $2", [
  tsvString,
  chunk.id,
]);
```

**查询侧：**

```typescript
import { tokenize, tokensToTsQuery } from './tokenizer';
const tokens = tokenize(query); // '怎么重置密码' → ['怎么', '重置', '密码']
const tsquery = tokensToTsQuery(tokens); // "'怎么':* & '重置':* & '密码':*"
// prefix operator（:*）支持部分匹配中文
```

### 5.3 sparse-retriever.ts 核心逻辑

```typescript
async function sparseSearch(
  query: string,
  filter: { kbId: string },
  topK: number,
): Promise<RetrievalResult[]> {
  const tokens = tokenize(query);
  const tsqueryStr = tokensToTsQuery(tokens);
  const results = await db.query(
    `SELECT id, content, ts_rank(tsv, q) AS rank
     FROM chunks WHERE tsv @@ $1 AND kb_id = $2
     ORDER BY rank DESC LIMIT $3`,
    [tsqueryStr, filter.kbId, topK * CANDIDATE_MULTIPLIER],
  );
  return results.map((row) => ({
    content: row.content,
    score: row.rank,
    sourceFile: 'unknown',
    metadata: { chunkId: row.id, kbId: filter.kbId },
  }));
}
```

---

## 六、融合算法

### 6.1 RRF（默认）

$$\mathrm{RRF}(d) = \sum_{r \in \{\text{dense},\ \text{sparse}\}} \frac{1}{k + \mathrm{rank}_r(d)}$$

- `rank` 从 1 开始，未出现在某路的文档该项为 0
- `k` 默认 60，可配置 `rrfK`
- 最终按 RRF 分降序取 topK

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

### 6.2 Linear（可选）

```
s_dense_norm  = min-max 归一化到 [0, 1]
s_sparse_norm = min-max 归一化到 [0, 1]
s             = w × s_dense_norm + (1 - w) × s_sparse_norm
```

仅出现在一路的文档：另一路视为 0。

---

## 七、Pipeline 改造

### 7.1 `performSearch` 调度逻辑

```typescript
async function performSearch(query, filter, params, config): Promise<RetrievalResult[]> {
  const { retrievalMode, fusionMethod, rrfK, candidateMultiplier, useReranker, ...rest } = params;
  const candidatesPerRoute = Math.ceil(rest.topK * Math.min(candidateMultiplier ?? 3, 10));

  // 缓存 key 包含 retrievalMode / fusionMethod / rrfK / minDenseScore
  const cached = await getCachedResults(
    query,
    filter.kbId,
    rest.topK,
    rest.minScore,
    retrievalMode,
    fusionMethod,
    rrfK,
    params.minDenseScore,
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
          { ...rest, query, filter, topK: candidatesPerRoute },
          store,
          embeddingConfig,
        ),
        sparseSearch({ query, filter, topK: candidatesPerRoute }, sparseStore),
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
    params.minDenseScore,
    results,
  );
  return results;
}
```

### 7.2 失败处理

| 失败点                     | 处理                                               |
| -------------------------- | -------------------------------------------------- |
| `addDocumentsToPG` 失败    | chunks 行已写入，启动期校验发现缺失时触发补写      |
| `writeSparseToChunks` 失败 | langchainjs 已写入，chunks 补写由同一 worker 重试  |
| Worker 重试                | 按 docId 幂等：先清理本次 docId 的两路数据，再重跑 |

---

## 八、API 参数

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
| `minDenseScore`       | `number`                        | 否   | `null`   | 仅 hybrid 模式，过滤 dense 候选 |
| `useReranker`         | `boolean`                       | 否   | `false`  | 是否重排（当前为 stub）         |
| `debug`               | `boolean`                       | 否   | `false`  | 是否返回详细调试信息            |

**请求头覆盖：** `X-Debug: true` — 无需修改 body 即可开启调试模式。

### 8.2 `minScore` / `minDenseScore` 语义分化

| 参数            | 适用模式               | 行为                                           |
| --------------- | ---------------------- | ---------------------------------------------- |
| `minScore`      | `vector`               | 过滤最终结果，默认 0.7                         |
| `minScore`      | `keyword`              | **默认不启用**（稀疏分无固定上限）             |
| `minScore`      | `hybrid + rrf`         | **默认不启用**（RRF 分无固定范围）             |
| `minScore`      | `hybrid + linear`      | 过滤融合后最终结果（归一化后 0~1）             |
| `minDenseScore` | `hybrid`（rrf/linear） | **可选**，只在 dense 候选阶段过滤，默认 `null` |

### 8.3 环境变量

```bash
DEFAULT_RETRIEVAL_MODE=vector
DEFAULT_FUSION_METHOD=rrf
DEFAULT_RRF_K=60
DEFAULT_CANDIDATE_MULTIPLIER=3
DEFAULT_DENSE_WEIGHT=0.5
DEFAULT_MIN_SCORE=0.7                # 仅对 vector 模式生效
DEFAULT_MIN_DENSE_SCORE=0.3          # 仅对 hybrid 模式的 dense 候选生效
RAG_RESULT_CACHE_TTL_MS=300000       # 检索结果缓存 TTL（毫秒）
```

### 8.4 Debug 输出格式

`debug=true` 或 `X-Debug: true` 时，每次检索返回：

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

生产环境（`debug=false`）不返回明细字段。

---

## 九、性能约束

| 项   | 目标                                                    |
| ---- | ------------------------------------------------------- |
| 索引 | 稀疏列 GIN；向量侧维持现有 IVF/flat 策略                |
| 延迟 | hybrid P95 相对纯向量增幅 **< 50ms**                    |
| 查询 | 两路并行 `Promise.all`                                  |
| 缓存 | 进程内 Map，TTL 5min；mode/fusion/rrfK 变化时需独立 key |
| 上限 | `candidateMultiplier` 硬上限 **10**                     |

---

## 十、测试

### 单测

| 测试文件                              | 覆盖点                                                  |
| ------------------------------------- | ------------------------------------------------------- |
| `fusion/rrf.test.ts`                  | 单路/双路/并列/空列表/大 k 值边界                       |
| `fusion/linear.test.ts`               | 归一化一致性/单路文档/权重边界 0/1                      |
| `retrievers/sparse-retriever.test.ts` | 中文分词、英文、数字错误码命中                          |
| `retrievers/hybrid-retriever.test.ts` | hybrid 模式双路并行、融合正确性、mode 分支              |
| `pipeline.test.ts`                    | `retrievalMode=vector` 结果与旧版等价；缓存 key 含 mode |

### 集成测

- sparse-search 端到端（PG 真实连接）
- hybrid-search 端到端（双路并行 + fusion）
- 摄入一致性（写入→删除→再查应返回空）

### Eval Fixture

`packages/rag-engine/__tests__/fixtures/eval-queries.json`（~25 条），覆盖：

- 中文无空格（5）：向量数据库对比分析、模型推理延迟优化方案
- 英文技术术语（4）：cosine similarity calculation、BM25 ranking algorithm
- 中英混合（5）：PGVector 向量检索性能调优、Embedding model dimensions
- 错误码/数字（4）：404 Not Found 排查方法、ERROR code 500
- 同义改写（4）：知识库管理 vs 知识库操作 vs 管理文档库
- 边界 case（3）：超长查询、纯符号、单个词

---

## 十一、迁移历史

| 阶段 | 内容                                       | 状态 |
| ---- | ------------------------------------------ | ---- |
| M1   | 稀疏索引模型 + 摄入/删除同步               | ✅   |
| M2   | 重写 hybridSearch：并行双路 + RRF + linear | ✅   |
| M3   | pipeline / Server DTO / 默认配置 / 兼容层  | ✅   |
| M4   | 前端调试参数页                             | ✅   |
| M5   | 可观测字段 + 旧 boost 下线                 | ✅   |

S1–S13 全部完成，legacyKeywordBoost 已下线，无遗留任务。
