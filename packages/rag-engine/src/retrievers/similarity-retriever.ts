import type { Document } from "@langchain/core/documents";
import type {
  EmbeddingConfig,
  RetrievalResult,
  SearchParams,
} from "../types.js";
import { embedQuery } from "../embeddings/openai-embeddings.js";

/** 兼容 PGVectorStore 与 MemoryVectorStore 的最小接口 */
export interface VectorStoreLike {
  similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: Record<string, unknown>,
  ): Promise<[Document, number][]>;
}

interface SimilaritySearchParams extends SearchParams {
  query: string;
  filter?: Record<string, unknown>;
}

/**
 * 纯向量相似度检索。
 */
export async function similaritySearch(
  params: SimilaritySearchParams,
  vectorStore: VectorStoreLike,
  embeddingConfig: EmbeddingConfig,
): Promise<RetrievalResult[]> {
  const queryVector = await embedQuery(embeddingConfig, params.query);

  const rawResults = await vectorStore.similaritySearchVectorWithScore(
    queryVector,
    params.topK,
    params.filter,
  );

  return rawResults
    .map(([doc, score]: [Document, number]) => ({
      content: doc.pageContent,
      score: Number(score.toFixed(7)),
      sourceFile: (doc.metadata?.source as string) ?? "unknown",
      metadata: (doc.metadata ?? {}) as Record<string, unknown>,
    }))
    .filter((r) => r.score >= params.minScore);
}
