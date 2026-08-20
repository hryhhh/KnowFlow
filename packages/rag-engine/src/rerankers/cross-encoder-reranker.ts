import type { RetrievalResult } from '../types.js';

export interface RerankInput {
  query: string;
  results: RetrievalResult[];
  topK?: number;
}

/**
 * Cross-Encoder 重排序（占位实现）。
 *
 * 生产环境应部署 Cross-Encoder 模型（如 ms-marco-MiniLM-L-6-v2）或调用
 * 云端重排序接口，对 (query, document) 对输出相关性分数后重排。
 *
 * 此处保留接口与降级策略：无可用重排模型时原样返回（按相似度排序）。
 */
export async function rerank(input: RerankInput): Promise<RetrievalResult[]> {
  if (!input.results.length) return [];

  // TODO: 接入实际 Cross-Encoder 推理或云端 API
  // const scores = await crossEncoder.predict([input.results.map(r => [input.query, r.content])]);
  // return input.results.map((r,i) => ({...r, score: scores[i]})).sort(...)

  return input.results.slice(0, input.topK ?? 10);
}
