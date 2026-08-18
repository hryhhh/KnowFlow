import type { EmbeddingConfig, RetrievalResult, SearchParams } from "../types.js";
import { similaritySearch } from "./similarity-retriever.js";
import type { VectorStoreLike } from "./similarity-retriever.js";

export interface HybridSearchParams extends SearchParams {
  query: string;
  filter?: Record<string, unknown>;
}

/**
 * 混合检索（dense vector + keyword 关键词）。
 * 通过 denseWeight 控制两种信号的权重，线性加权融合。
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
  // 中英文混合切词：英文按空格切，中文连续字符单独成词，过滤单字符和纯标点
  const queryTerms = params.query
    .toLowerCase()
    .split(/[\s,，\s]+/)
    .filter((t) => t.length > 1 && /^[a-z0-9一-龥]+$/.test(t));

  return results
    .map((r) => {
      // 用正则整体词匹配，避免 "ai" 误命中 "JavaScript"
      const hit = queryTerms.some(
        (t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(r.content),
      );
      const keywordScore = hit ? 1 : 0;
      const fused = params.denseWeight * r.score + keywordWeight * keywordScore;
      return { ...r, score: Number(fused.toFixed(7)) };
    })
    .sort((a, b) => b.score - a.score);
}
