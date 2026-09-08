import type { RAGPipelineConfig } from '@knowbase-x/rag-engine';
import { env } from './env';

export const RAG_CONFIG = 'RAG_CONFIG';

/** 切片默认参数（业务决策值，不随部署环境变化，按 12-Factor 收编为代码常量） */
const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 200;

/**
 * 从集中配置构建 RAG Pipeline 配置。
 */
export function createRagConfig(): RAGPipelineConfig {
  return {
    pg: {
      host: env.database.host,
      port: env.database.port,
      user: env.database.user,
      password: env.database.password,
      database: env.database.name,
    },
    llm: {
      apiKey: env.llm.apiKey,
      model: env.llm.model,
      baseURL: env.llm.baseURL,
    },
    embedding: {
      apiKey: env.llm.apiKey,
      model: env.embedding.model,
      baseURL: env.llm.baseURL,
      dimensions: env.embedding.dimensions,
    },
    chunkSize: DEFAULT_CHUNK_SIZE,
    chunkOverlap: DEFAULT_CHUNK_OVERLAP,
    embeddingDimensions: env.embedding.dimensions,
    pgTableName: 'langchainjs',
  };
}
