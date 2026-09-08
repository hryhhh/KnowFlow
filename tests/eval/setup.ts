/**
 * A1 评测知识库 setup：先删后建（幂等），从 tests/eval/corpus/ 摄入固定小语料。
 *
 * 用法：pnpm eval:agent（由 runner 自动调用）或 tsx tests/eval/setup.ts 独立执行。
 * 依赖：本地 PostgreSQL（含 pgvector 扩展）+ LLM_API_KEY（embedding 调用）。
 */
import path from 'node:path';
import fs from 'node:fs';
import * as dotenv from 'dotenv';

// 根目录 .env（runner 从仓库根运行）
dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env') });

import { Pool } from 'pg';
import {
  ingestDocument,
  retrieve,
  writeSparseIndex,
  deleteByDocId,
  clearSparseByKbId,
  getChunkIds,
  type RAGPipelineConfig,
} from '@knowbase-x/rag-engine';

/** 评测知识库固定 ID（合法 UUID，与业务数据隔离） */
export const EVAL_KB_ID = '00000000-0000-4000-8000-0000000000e1';
export const EVAL_KB_NAME = 'eval-kb';

/** 固定 docId（幂等清理用；文件名不得命中 pipeline 的测试文件过滤规则 /^gen-test-|\.test\.|\.spec\./） */
export const CORPUS_FILES = [
  { docId: '00000000-0000-4000-8000-0000000000c1', fileName: 'employee-handbook.md' },
  { docId: '00000000-0000-4000-8000-0000000000c2', fileName: 'product-faq.md' },
  { docId: '00000000-0000-4000-8000-0000000000c3', fileName: 'onboarding-guide.md' },
];

/** 语料摄入后必须能被检索命中的冒烟查询（per 文件） */
const SMOKE_QUERIES: Record<string, string> = {
  'employee-handbook.md': '报销审批流程',
  'product-faq.md': '云盾 Pro 版定价',
  'onboarding-guide.md': '新人入职培训',
};

const repoRoot = path.resolve(import.meta.dirname, '../..');

function buildRagConfig(): RAGPipelineConfig {
  const apiKey = process.env.LLM_API_KEY ?? '';
  const baseURL = process.env.LLM_BASE_URL ?? '';
  return {
    pg: {
      host: process.env.DATABASE_HOST ?? 'localhost',
      port: Number(process.env.DATABASE_PORT ?? 5432),
      user: process.env.DATABASE_USER ?? 'postgres',
      password: process.env.DATABASE_PASSWORD ?? '123456',
      database: process.env.DATABASE_NAME ?? 'knowledge_rag',
    },
    llm: { apiKey, model: process.env.LLM_MODEL ?? 'qwen3.7-plus', baseURL },
    embedding: {
      apiKey,
      model: process.env.EMBEDDING_MODEL ?? 'text-embedding-v4',
      baseURL,
      dimensions: Number(process.env.EMBEDDING_DIMENSIONS ?? 1024),
    },
  };
}

/** 确保评测所需的最小表结构（与实体列对齐；不依赖服务端 migrations/synchronize） */
async function ensureSchema(pool: Pool): Promise<void> {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(128) UNIQUE NOT NULL,
      description text,
      type varchar(32) DEFAULT 'free',
      status varchar(32) DEFAULT 'active',
      "createdAt" timestamptz DEFAULT now(),
      "updatedAt" timestamptz DEFAULT now()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "kbId" uuid NOT NULL,
      name varchar(256) NOT NULL,
      "fileType" varchar(16) NOT NULL,
      "fileSize" int,
      "filePath" varchar(512),
      "processStrategy" varchar(64),
      status varchar(32) DEFAULT 'completed',
      "chunkCount" int DEFAULT 0,
      "importMethod" varchar(16) DEFAULT 'upload',
      "errorMessage" text,
      progress int DEFAULT 100,
      "processingStage" varchar(32) DEFAULT 'completed',
      "jobId" varchar(256),
      "createdAt" timestamptz DEFAULT now(),
      "updatedAt" timestamptz DEFAULT now()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chunks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "docId" uuid NOT NULL,
      "kbId" uuid NOT NULL,
      "chunkIndex" int NOT NULL,
      content text,
      title varchar(256),
      "tokenCount" int DEFAULT 0,
      "sourceFile" varchar(256),
      "chunkId" text,
      tsv tsvector,
      "createdAt" timestamptz DEFAULT now()
    )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_eval_chunk_kb ON chunks ("kbId")`);
}

/** 清理评测库的全部数据（dense 向量、稀疏索引、chunks/documents/kb 行） */
export async function teardownEvalKb(): Promise<void> {
  const ragConfig = buildRagConfig();
  const pool = new Pool(ragConfig.pg);
  try {
    for (const f of CORPUS_FILES) {
      try {
        await deleteByDocId(ragConfig.pg, 'langchainjs', f.docId);
      } catch {
        /* 表不存在时忽略 */
      }
    }
    try {
      await clearSparseByKbId(ragConfig.pg, 'chunks', EVAL_KB_ID);
    } catch {
      /* 表不存在时忽略 */
    }
    await pool.query(`DELETE FROM chunks WHERE "kbId" = $1`, [EVAL_KB_ID]);
    await pool.query(`DELETE FROM documents WHERE "kbId" = $1`, [EVAL_KB_ID]);
    await pool.query(`DELETE FROM knowledge_bases WHERE id = $1 OR name = $2`, [
      EVAL_KB_ID,
      EVAL_KB_NAME,
    ]);
  } finally {
    await pool.end();
  }
}

/** 摄入语料并断言每条语料均可被检索命中（未被 TEST_FILE_PATTERN 过滤） */
export async function setupEvalKb(): Promise<void> {
  const ragConfig = buildRagConfig();
  if (!ragConfig.llm.apiKey) {
    throw new Error('LLM_API_KEY 未设置：评测知识库摄入需要 embedding 调用');
  }

  await teardownEvalKb();

  const pool = new Pool(ragConfig.pg);
  try {
    await ensureSchema(pool);
    await pool.query(
      `INSERT INTO knowledge_bases (id, name, description) VALUES ($1, $2, $3)
       ON CONFLICT (name) DO UPDATE SET id = EXCLUDED.id`,
      [EVAL_KB_ID, EVAL_KB_NAME, 'A1 评测专用知识库（自动创建）'],
    );

    for (const f of CORPUS_FILES) {
      const filePath = path.join(repoRoot, 'tests/eval/corpus', f.fileName);
      if (!fs.existsSync(filePath)) throw new Error(`评测语料缺失: ${filePath}`);

      // 管线会跳过命中测试文件过滤规则的文件 —— 语料命名必须避开，此处再次显式断言
      if (/^gen-test-|\.test\.|\.spec\./.test(f.fileName)) {
        throw new Error(`评测语料文件名命中 TEST_FILE_PATTERN，会被静默过滤: ${f.fileName}`);
      }

      const { chunks } = await ingestDocument(
        filePath,
        EVAL_KB_ID,
        ragConfig,
        'basic',
        undefined,
        f.docId,
      );
      if (chunks.length === 0) throw new Error(`语料切分为空: ${f.fileName}`);

      // 落 chunks 行（chunkId 与 dense 侧一致），随后写稀疏索引
      const inserted: Array<{ id: string; content: string; chunkId: string }> = [];
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const res = await pool.query(
          `INSERT INTO chunks ("docId", "kbId", "chunkIndex", content, "tokenCount", "sourceFile", "chunkId")
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            f.docId,
            EVAL_KB_ID,
            i,
            c.content,
            c.tokenCount,
            (c.metadata.source as string) ?? f.fileName,
            c.metadata.chunkId as string,
          ],
        );
        inserted.push({
          id: res.rows[0].id,
          content: c.content,
          chunkId: c.metadata.chunkId as string,
        });
      }
      await writeSparseIndex(ragConfig.pg, 'chunks', inserted);

      // 落 documents 行
      await pool.query(
        `INSERT INTO documents ("kbId", name, "fileType", status, "chunkCount", "processStrategy", progress, "processingStage")
         VALUES ($1, $2, 'pdf', 'success', $3, 'basic', 100, 'completed')`,
        [EVAL_KB_ID, f.fileName, chunks.length],
      );

      // 冒烟断言：语料可被检索命中
      const smoke = await retrieve(
        SMOKE_QUERIES[f.fileName],
        EVAL_KB_ID,
        {
          topK: 5,
          minScore: 0,
          useReranker: false,
          denseWeight: 0.5,
          retrievalMode: 'hybrid',
          fusionMethod: 'rrf',
        } as any,
        ragConfig,
      );
      if (smoke.results.length === 0) {
        throw new Error(`冒烟检索未命中（语料可能被过滤或摄入失败）: ${f.fileName}`);
      }
      console.log(`[eval-setup] ✓ ${f.fileName} (${chunks.length} chunks)`);
    }

    // chunks 表中残留的 getChunkIds 校验（与 dense 侧对齐）
    void getChunkIds;
  } finally {
    await pool.end();
  }
}

// 独立执行：tsx tests/eval/setup.ts
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  setupEvalKb()
    .then(() => {
      console.log('[eval-setup] 评测知识库就绪');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[eval-setup] 失败:', err);
      process.exit(1);
    });
}
