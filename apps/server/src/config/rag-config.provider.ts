import type { RAGPipelineConfig } from "@knowledge-ai/rag-engine";

export const RAG_CONFIG = "RAG_CONFIG";

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function num(key: string, fallback: number): number {
  const v = process.env[key];
  return v !== undefined ? Number(v) : fallback;
}

/**
 * 从环境变量构建 RAG Pipeline 配置。
 */
export function createRagConfig(): RAGPipelineConfig {
  return {
    pg: {
      host: env("DATABASE_HOST", "localhost"),
      port: num("DATABASE_PORT", 5432),
      user: env("DATABASE_USER", "postgres"),
      password: env("DATABASE_PASSWORD", "123456"),
      database: env("DATABASE_NAME", "knowledge_rag"),
    },
    llm: {
      apiKey: env("LLM_API_KEY", ""),
      model: env("LLM_MODEL", "qwen3.7-plus"),
      baseURL: env("LLM_BASE_URL", ""),
    },
    embedding: {
      apiKey: env("LLM_API_KEY", ""),
      model: env("EMBEDDING_MODEL", "text-embedding-v4"),
      baseURL: env("LLM_BASE_URL", ""),
      dimensions: num("EMBEDDING_DIMENSIONS", 1024),
    },
    chunkSize: num("DEFAULT_CHUNK_SIZE", 1000),
    chunkOverlap: num("DEFAULT_CHUNK_OVERLAP", 200),
    embeddingDimensions: num("EMBEDDING_DIMENSIONS", 1024),
    pgTableName: "langchainjs",
  };
}
