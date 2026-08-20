import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Document } from '@langchain/core/documents';

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 5433,
  user: 'postgres',
  password: '123456',
  database: 'knowledge_rag',
};

const TABLE_NAME = `test_hybrid_retrieval_${Date.now()}`;

let client: Client;
let embeddings: OpenAIEmbeddings;
let store: PGVectorStore;

describe.skip('Integration: hybridSearch with real PGVector', () => {
  beforeAll(async () => {
    client = new Client({ ...DB_CONFIG });
    await client.connect();

    // 创建带 vector 扩展的表
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${TABLE_NAME}" (
        id SERIAL PRIMARY KEY,
        "vector" vector(1536),
        "content" text,
        "metadata" jsonb
      );
    `);

    // 使用真实 API key 初始化（测试环境）
    embeddings = new OpenAIEmbeddings({
      apiKey: process.env.EMBEDDING_API_KEY || 'test-key',
      model: 'text-embedding-3-small',
      configuration: { baseURL: process.env.EMBEDDING_BASE_URL || 'https://api.test.com' },
      dimensions: 1536,
    });

    store = await PGVectorStore.initialize(embeddings, {
      tableName: TABLE_NAME,
      columns: {
        vectorColumnName: 'vector',
        contentColumnName: 'content',
        metadataColumnName: 'metadata',
      },
      postgresConnectionOptions: {
        host: DB_CONFIG.host,
        port: DB_CONFIG.port,
        user: DB_CONFIG.user,
        password: DB_CONFIG.password,
        database: DB_CONFIG.database,
      },
    });
  });

  afterAll(async () => {
    // 清理测试表
    await client.query(`DROP TABLE IF EXISTS "${TABLE_NAME}"`);
    await client.end();
  });

  it('should insert and retrieve documents with kbId filter', async () => {
    const testDocs = [
      new Document({
        pageContent: 'PostgreSQL向量检索原理与实现详解',
        metadata: { source: 'pg.txt', kbId: 'test-kb' },
      }),
      new Document({
        pageContent: 'JavaScript前端开发最佳实践指南',
        metadata: { source: 'js.txt', kbId: 'test-kb' },
      }),
    ];

    await store.addDocuments(testDocs);

    // 检索并验证 filter 生效
    const results = await store.similaritySearchVectorWithScore(
      await embeddings.embedQuery('PostgreSQL向量检索'),
      10,
      { kbId: 'test-kb' },
    );

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0][0].metadata.kbId).toBe('test-kb');
  });

  it('should filter out documents with different kbId', async () => {
    const otherDocs = [
      new Document({
        pageContent: 'Other KB content',
        metadata: { source: 'other.txt', kbId: 'other-kb' },
      }),
    ];
    await store.addDocuments(otherDocs);

    const results = await store.similaritySearchVectorWithScore(
      await embeddings.embedQuery('test'),
      10,
      { kbId: 'nonexistent-kb' },
    );
    expect(results).toHaveLength(0);
  });
});
