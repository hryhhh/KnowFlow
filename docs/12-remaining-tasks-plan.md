# 剩余任务实现计划

## 背景

DB migration 已完成。以下 3 项待完成：

---

## T1: Debug 可观测字段（设计文档 §7）

**目标：** `debug=true` 时检索结果附带每 item 的 rankDense / rankSparse / scoreDense / scoreSparse / scoreFused，以及批次统计 denseCandidates / sparseCandidates / fusedTopK。

**修改文件：**

| 文件                                                          | 改动                                                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `packages/rag-engine/src/types.ts`                            | SearchParams 加 `debug?: boolean`                                                                              |
| `packages/rag-engine/src/fusion/index.ts`                     | rrfFuse / linearFuse 返回 `{ results, debug }`；给每个 result 挂 `rankDense/rankSparse/scoreDense/scoreSparse` |
| `packages/rag-engine/src/retrievers/hybrid-retriever.ts`      | 返回 `[results, debug]` 元组；收集 dense/sparse candidates 数量                                                |
| `packages/rag-engine/src/pipeline.ts`                         | `performSearch` 透传 debug 标志，结果带上 `debug` 字段                                                         |
| `packages/rag-engine/src/index.ts`                            | 新增导出 `SearchDebugInfo` 类型                                                                                |
| `apps/server/src/modules/retrieval/dto/search.dto.ts`         | 加 `@IsOptional() @IsBoolean() debug?: boolean`                                                                |
| `apps/server/src/modules/retrieval/retrieval.service.ts`      | 透传 `debug`，结果对象加 `debug` 字段（仅当 debug=true）                                                       |
| `apps/server/src/modules/retrieval/retrieval.service.test.ts` | 新增 debug 模式测试用例                                                                                        |

**实现细节：**

- `rrfFuse(dense, sparse, k, debug?)` → `{ results: RetrievalResult[], debug?: SearchDebugInfo }`
- `linearFuse` 同理
- debug 对象结构：
  ```ts
  {
    mode: string,
    fusion: 'rrf' | 'linear',
    denseCandidates: number,
    sparseCandidates: number,
    fusedTopK: number,
    items: { rankDense, rankSparse, scoreDense, scoreSparse, scoreFused }[]
  }
  ```
- vector/keyword 模式：只填对应路径的 rank（另一路为 null）
- 生产环境（debug=false）：返回类型不变，无额外开销

---

## T2: 评测集 fixture（plan S13）

**目标：** 创建 `packages/rag-engine/__tests__/fixtures/eval-queries.json`，≥20 条中英混合查询，覆盖各类场景。

**内容规划（25 条）：**

| 类别         | 数量 | 示例                                                      |
| ------------ | ---- | --------------------------------------------------------- |
| 中文无空格   | 5    | "向量数据库对比分析"、"模型推理延迟优化方案"              |
| 英文技术术语 | 4    | "cosine similarity calculation"、"BM25 ranking algorithm" |
| 中英混合     | 5    | "PGVector 向量检索性能调优"、"Embedding model dimensions" |
| 错误码/数字  | 4    | "404 Not Found 排查方法"、"ERROR code 500"                |
| 同义改写     | 4    | "知识库管理" vs "知识库操作" vs "管理文档库"              |
| 边界 case    | 3    | 超长查询、纯符号、单个词                                  |

---

## T3: legacyKeywordBoost 分支清理（M5）✅

**状态：** 已完成

- 从 `hybrid-retriever.ts` 删除函数和注释
- 从 `index.ts` 移除导出
- 从 `hybrid-retriever.test.ts` 移除 import 和测试用例
- 测试：133→131（减少2条废弃测试），编译无错误

---

## 执行顺序

T1 → T2（无依赖，可并行）
T3 随 T1 一并处理
