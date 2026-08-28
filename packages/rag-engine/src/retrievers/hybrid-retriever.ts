import type {
  EmbeddingConfig,
  PGConfig,
  RetrievalResult,
  SearchParams,
  SearchDebugInfo,
} from '../types.js';
import { similaritySearch } from './similarity-retriever.js';
import type { VectorStoreLike } from './similarity-retriever.js';
import { sparseSearch } from './sparse-retriever.js';
import { rrfFuse, linearFuse } from '../fusion/index.js';

export interface HybridSearchParams extends SearchParams {
  query: string;
  filter?: Record<string, unknown>;
  /** 每路候选数（调用方已乘 candidateMultiplier） */
  candidatesPerRoute: number;
  fusionMethod: 'rrf' | 'linear';
  /** rrfK（rrf 时）或 denseWeight（linear 时） */
  fusionParam: number;
  dbConfig: PGConfig;
  sparseTableName: string;
}

/**
 * 混合检索（dense vector + sparse tsvector）并行召回 + RRF/linear 融合
 *
 * 当 retrievalMode=hybrid 时由 pipeline.ts 调用。
 */
export async function hybridSearch(
  params: HybridSearchParams & { minDenseScore?: number | null },
  vectorStore: VectorStoreLike,
  embeddingConfig: EmbeddingConfig,
): Promise<{ results: RetrievalResult[]; debug?: SearchDebugInfo }> {
  const {
    query,
    filter,
    candidatesPerRoute,
    fusionMethod,
    fusionParam,
    dbConfig,
    sparseTableName,
    topK,
    minDenseScore,
  } = params;

  // 并行双路召回
  const [denseRaw, sparse] = await Promise.all([
    similaritySearch(
      {
        query,
        filter: filter ?? { kbId: '' },
        topK: candidatesPerRoute,
        minScore: 0,
        useReranker: false,
        denseWeight: 0.5,
      },
      vectorStore,
      embeddingConfig,
    ),
    sparseSearch(
      { query, filter: { kbId: (filter as any)?.kbId ?? '' }, topK: candidatesPerRoute },
      dbConfig,
      sparseTableName,
    ),
  ]);

  // minDenseScore 在 dense 候选阶段预截断（不应用于 RRF/linear 融合分）
  const dense =
    minDenseScore !== null && minDenseScore !== undefined
      ? denseRaw.filter((r) => r.score >= minDenseScore)
      : denseRaw;

  // 融合
  let fusionResult: { results: RetrievalResult[]; debug?: SearchDebugInfo };
  if (fusionMethod === 'linear') {
    fusionResult = linearFuse(dense, sparse, fusionParam, params.debug);
  } else {
    fusionResult = rrfFuse(dense, sparse, fusionParam, params.debug);
  }

  const results = fusionResult.results;

  // dense 和 sparse 结果均已携带 metadata.chunkId（pipeline 注入占位符，ingestion.processor 回填真实 PK），
  // rrfFuse / linearFuse 直接以 chunkId 为关联键完成融合，无需额外回填 sourceFile。

  // 取 topK
  const sliced = results.slice(0, topK);

  // 如果 debug 模式，更新 fusedTopK
  if (params.debug && fusionResult.debug) {
    fusionResult.debug.fusedTopK = sliced.length;
  }

  return { results: sliced, debug: fusionResult.debug };
}
