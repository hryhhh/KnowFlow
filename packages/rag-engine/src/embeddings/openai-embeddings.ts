import { OpenAIEmbeddings } from "@langchain/openai";
import type { EmbeddingConfig } from "../types.js";

/** 按配置指纹缓存 Embedding 实例，避免热更新后仍使用旧配置 */
const cache = new Map<string, OpenAIEmbeddings>();

/**
 * 获取（或缓存创建）OpenAI 兼容 Embeddings 实例
 */
export function getEmbeddings(config: EmbeddingConfig): OpenAIEmbeddings {
  const key = `${config.apiKey.slice(0, 8)}:${config.model}:${config.baseURL}`;
  if (!cache.has(key)) {
    cache.set(key, new OpenAIEmbeddings({
      apiKey: config.apiKey,
      model: config.model,
      configuration: {
        baseURL: config.baseURL,
      },
      dimensions: config.dimensions,
    }));
  }
  return cache.get(key)!;
}

/** 批量将文档列表向量化 */
export async function embedDocuments(
  config: EmbeddingConfig,
  texts: string[],
): Promise<number[][]> {
  const embeddings = getEmbeddings(config);
  const BATCH_SIZE = 10;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchResult = await embeddings.embedDocuments(batch);
    results.push(...batchResult);

    if (i + BATCH_SIZE < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return results;
}

/** 将单个查询词向量化 */
export async function embedQuery(
  config: EmbeddingConfig,
  query: string,
): Promise<number[]> {
  const embeddings = getEmbeddings(config);
  return embeddings.embedQuery(query);
}
