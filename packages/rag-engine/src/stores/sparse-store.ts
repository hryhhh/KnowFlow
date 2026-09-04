import { Pool } from 'pg';
import type { PGConfig } from '../types.js';
import { tokenize, tokensToTsvString } from '../tokenizer.js';

/**
 * 稀疏索引存储（tsvector on chunks 表）
 *
 * 使用独立 pg.Pool，与 pgvector-store 保持相同隔离模式。
 */

interface SparseUpdate {
  id: string;
  content: string;
  /** chunkId：pipeline 注入的 UUID，写入 tsv 列时一并存储，供 sparseSearch 返回 */
  chunkId: string;
}

/**
 * 批量写入/更新 chunks.tsv 和 chunks.chunkId
 *
 * 幂等：同一 id 多次调用以最后一次为准（UPSERT 语义）。
 * 分批执行，每批 50 条，避免单条 SQL 过长。
 *
 * SQL 结构：
 *   UPDATE "chunks" SET
 *     tsv = CASE id WHEN $id1 THEN $tsv1 WHEN $id2 THEN $tsv2 ... END,
 *     "chunkId" = CASE id WHEN $id1 THEN $chunkId1 WHEN $id2 THEN $chunkId2 ... END
 *   WHERE id IN ($id1, $id2, ...)
 *
 * 参数顺序：[tsv1, id1, chunkId1, tsv2, id2, chunkId2, ...]
 */
export async function writeSparseIndex(
  dbConfig: PGConfig,
  tableName: string,
  updates: SparseUpdate[],
): Promise<void> {
  if (updates.length === 0) return;

  const pool = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
  });

  try {
    const BATCH_SIZE = 50;
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);

      // 每个条目准备 [tsvStr, id, chunkId] 三个参数
      const paramGroups = batch.map((u) => {
        const tokens = tokenize(u.content);
        return [tokensToTsvString(tokens), u.id, u.chunkId] as [string, string, string];
      });

      // 展平为单一参数数组：[tsv1, id1, chunkId1, tsv2, id2, chunkId2, ...]
      const params = paramGroups.flat();

      // 构建 CASE WHEN 子句（每组 3 个占位符）
      const tsvCases = paramGroups
        .map((_, idx) => `WHEN $${idx * 3 + 2} THEN $${idx * 3 + 1}`)
        .join(' ');
      const chunkIdCases = paramGroups
        .map((_, idx) => `WHEN $${idx * 3 + 2} THEN $${idx * 3 + 3}`)
        .join(' ');
      const ids = paramGroups.map((_, idx) => `$${idx * 3 + 2}`);

      await pool.query(
        `UPDATE "${tableName}" SET tsv = CASE id ${tsvCases} END,
                                  "chunk_id" = CASE id ${chunkIdCases} END
         WHERE id IN (${ids.join(', ')})`,
        params,
      );
    }
  } finally {
    await pool.end();
  }
}

/**
 * 按 docId 删除 chunks 表中对应文档的 tsv
 */
export async function deleteSparseByDocId(
  dbConfig: PGConfig,
  tableName: string,
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
    const result = await pool.query(
      `DELETE FROM "${tableName}" WHERE "docId" = $1 AND tsv IS NOT NULL`,
      [docId],
    );
    return { deleted: result.rowCount ?? 0 };
  } finally {
    await pool.end();
  }
}

/**
 * 按 kbId 删除 chunks 表中该知识库的所有 tsv
 */
export async function deleteSparseByKbId(
  dbConfig: PGConfig,
  tableName: string,
  kbId: string,
): Promise<{ deleted: number }> {
  const pool = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
  });
  try {
    const result = await pool.query(
      `DELETE FROM "${tableName}" WHERE "kbId" = $1 AND tsv IS NOT NULL`,
      [kbId],
    );
    return { deleted: result.rowCount ?? 0 };
  } finally {
    await pool.end();
  }
}
