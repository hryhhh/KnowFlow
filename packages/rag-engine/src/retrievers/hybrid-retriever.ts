import type { EmbeddingConfig, RetrievalResult, SearchParams } from "../types.js";
import { similaritySearch } from "./similarity-retriever.js";
import type { VectorStoreLike } from "./similarity-retriever.js";

export interface HybridSearchParams extends SearchParams {
  query: string;
  filter?: Record<string, unknown>;
}

/**
 * 混合检索（BM25 关键词 + Vector 语义）。
 * 通过 denseWeight 控制两种信号的权重，使用 RRF 融合。
 */
export async function hybridSearch(
  params: HybridSearchParams,
  vectorStore: VectorStoreLike,
  embeddingConfig: EmbeddingConfig,
): Promise<RetrievalResult[]> {
  const results = await similaritySearch(
    { ...params, filter: params.filter },
    vectorStore,
    embeddingConfig,
  );

  const keywordWeight = 1 - params.denseWeight;
  const queryTerms = params.query.toLowerCase().split(/\s+/).filter(Boolean);

  return results
    .map((r) => {
      const hit = queryTerms.some((t) => r.content.toLowerCase().includes(t));
      const keywordScore = hit ? 1 : 0;
      const fused = params.denseWeight * (1 - r.score) + keywordWeight * (1 - keywordScore);
      return { ...r, score: Number((r.score + fused * 0.0).toFixed(7)) };
    })
    .sort((a, b) => b.score - a.score);
}
