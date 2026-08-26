import { OpenAIEmbeddings } from '@langchain/openai';
import { PGVectorStore, type DistanceStrategy } from '@langchain/community/vectorstores/pgvector';
import { Document } from '@langchain/core/documents';
import type { PoolConfig } from 'pg';
import type { PGConfig, TextChunk } from '../types.js';
import { Pool } from 'pg';

export interface PGVectorTableConfig {
  tableName?: string;
  vectorColumnName?: string;
  contentColumnName?: string;
  metadataColumnName?: string;
  distanceStrategy?: DistanceStrategy;
}

const DEFAULT_TABLE_CONFIG: Required<Omit<PGVectorTableConfig, 'tableName'>> & {
  tableName: string;
} = {
  tableName: 'langchainjs',
  vectorColumnName: 'vector',
  contentColumnName: 'content',
  metadataColumnName: 'metadata',
  distanceStrategy: 'cosine',
};

/** 按 DB 配置缓存 PGVectorStore 实例，避免每次检索新建连接 */
const storeCache = new Map<string, PGVectorStore>();

/**
 * 按 docId 清理 PGVector 中的向量记录。
 *
 * PGVectorStore 没有按 metadata 过滤删除的内置 API，
 * 因此直接通过参数化 SQL DELETE 实现。
 * 使用独立的 pg Pool（而非 LangChain PGVectorStore 内部连接），
 * 避免连接池隔离问题导致的数据操作失败。
 *
 * @param dbConfig PG 连接配置（host/port/user/password/database）
 * @param tableName 表名，默认 langchainjs
 * @param docId 要删除的文档 UUID
 */
export async function deleteByDocId(
  dbConfig: PGConfig,
  tableName: string = DEFAULT_TABLE_CONFIG.tableName,
  docId: string,
): Promise<{ deleted: number }> {
  const pool = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
  });
  try {
    // 先检查 metadata 列是否存在 docId 键（兼容无 docId 的历史数据）
    const checkResult = await pool.query(
      `SELECT COUNT(*) AS cnt FROM ${tableName} WHERE metadata ? 'docId' LIMIT 1`,
    );
    const hasDocId = parseInt(checkResult.rows[0].cnt, 10) > 0;
    if (!hasDocId) {
      return { deleted: 0 };
    }
    const result = await pool.query(`DELETE FROM ${tableName} WHERE metadata @> '{"docId": $1}'`, [
      docId,
    ]);
    return { deleted: result.rowCount ?? 0 };
  } finally {
    await pool.end();
  }
}

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
      type: 'postgres',
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

/**
 * 将切片写入向量库
 *
 * @param onBatchProgress 可选的批次进度回调，每批次写入后调用
 *   (percent: number, stage: string) => void
 *   percent 范围 50-89（对应 embedding 阶段的百分比）
 */
export async function addDocumentsToPG(
  store: PGVectorStore,
  chunks: TextChunk[],
  onBatchProgress?: (percent: number, stage: string) => void,
): Promise<void> {
  const documents = chunks.map(
    (c) =>
      new Document({
        pageContent: c.content,
        metadata: c.metadata ?? {},
      }),
  );

  const BATCH_SIZE = 10;
  const totalBatches = Math.ceil(documents.length / BATCH_SIZE);
  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, i + BATCH_SIZE);
    await store.addDocuments(batch);

    const completed = Math.floor((i + BATCH_SIZE) / BATCH_SIZE);
    // 进度映射：50%（开始 embedding）→ 89%（即将进入 persisting）
    const percent = 50 + Math.round((completed / totalBatches) * 39);
    onBatchProgress?.(percent, 'embedding');

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
