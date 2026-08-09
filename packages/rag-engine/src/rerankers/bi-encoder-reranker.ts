import { RetrievalResult } from "../types.js";
import { getEmbeddings } from "../embeddings/openai-embeddings.js";
import type { EmbeddingConfig } from "../types.js";

/**
 * Bi-Encoder 重排序。
 *
 * 对 (query, document) 对分别计算 embedding，用余弦相似度作为相关性分数。
 * 相比原始向量检索，bi-encoder 能更好地区分语义相近但主题不同的文档。
 *
 * 相比真正的 Cross-Encoder，bi-encoder 不需要联合编码，推理更快，
 * 适合在 LLM 已提供 OpenAI 兼容 Embedding 接口的场景下使用。
 */
export async function rerank(
  query: string,
  results: RetrievalResult[],
  embeddingConfig: EmbeddingConfig,
  topK?: number,
): Promise<RetrievalResult[]> {
  if (!results.length) return [];

  const embeddings = getEmbeddings(embeddingConfig);

  // 并行计算 query 和所有文档的 embedding
  const [queryVec, docVecs] = await Promise.all([
    embeddings.embedQuery(query),
    embeddings.embedDocuments(results.map((r) => r.content)),
  ]);

  // 计算余弦相似度并重排序
  const scored = results.map((r, i) => {
    const similarity = cosineSimilarity(queryVec, docVecs[i]);
    return { ...r, rerankScore: similarity };
  });

  scored.sort((a, b) => b.rerankScore - a.rerankScore);
  return scored.slice(0, topK ?? results.length).map(({ rerankScore, ...rest }) => rest);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
