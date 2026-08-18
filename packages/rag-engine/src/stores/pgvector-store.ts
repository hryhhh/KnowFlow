import { OpenAIEmbeddings } from "@langchain/openai";
import {
  PGVectorStore,
  type DistanceStrategy,
} from "@langchain/community/vectorstores/pgvector";
import { Document } from "@langchain/core/documents";
import type { PoolConfig } from "pg";
import type { PGConfig, TextChunk } from "../types.js";

export interface PGVectorTableConfig {
  tableName?: string;
  vectorColumnName?: string;
  contentColumnName?: string;
  metadataColumnName?: string;
  distanceStrategy?: DistanceStrategy;
}

const DEFAULT_TABLE_CONFIG: Required<Omit<PGVectorTableConfig, "tableName">> & {
  tableName: string;
} = {
  tableName: "langchainjs",
  vectorColumnName: "vector",
  contentColumnName: "content",
  metadataColumnName: "metadata",
  distanceStrategy: "cosine",
};

/** 按 DB 配置缓存 PGVectorStore 实例，避免每次检索新建连接 */
const storeCache = new Map<string, PGVectorStore>();

/**
 * 创建 PGVector 持久化向量库。
 */
export async function createPGVectorStore(
  embeddings: OpenAIEmbeddings,
  dbConfig: PGConfig,
  tableConfig?: PGVectorTableConfig,
): Promise<PGVectorStore> {
  const merged = { ...DEFAULT_TABLE_CONFIG, ...tableConfig };
  const config = {
    tableName: merged.tableName,
    distanceStrategy: merged.distanceStrategy,
    columns: {
      vectorColumnName: merged.vectorColumnName,
      contentColumnName: merged.contentColumnName,
      metadataColumnName: merged.metadataColumnName,
    },
    postgresConnectionOptions: {
      type: "postgres",
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
    } as PoolConfig,
  };

  return PGVectorStore.initialize(embeddings, config);
}

/** 初始化并缓存 store */
export async function ensureCachedPGVectorStore(
  embeddings: OpenAIEmbeddings,
  dbConfig: PGConfig,
  tableConfig?: PGVectorTableConfig,
): Promise<PGVectorStore> {
  const key = `${dbConfig.host}:${dbConfig.database}:${tableConfig?.tableName ?? DEFAULT_TABLE_CONFIG.tableName}`;
  if (!storeCache.has(key)) {
    const store = await createPGVectorStore(embeddings, dbConfig, tableConfig);
    storeCache.set(key, store);
  }
  return storeCache.get(key)!;
}

/** 将切片写入向量库 */
export async function addDocumentsToPG(
  store: PGVectorStore,
  chunks: TextChunk[],
): Promise<void> {
  const documents = chunks.map(
    (c) =>
      new Document({
        pageContent: c.content,
        metadata: c.metadata ?? {},
      }),
  );

  const BATCH_SIZE = 10;
  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, i + BATCH_SIZE);
    await store.addDocuments(batch);

    if (i + BATCH_SIZE < documents.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/** 相似度检索 + 评分 */
export async function searchSimilarityWithScore(
  store: PGVectorStore,
  queryVector: number[],
  topK: number,
): Promise<[Document, number][]> {
  return store.similaritySearchVectorWithScore(queryVector, topK);
}
