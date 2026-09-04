import type { PGConfig, RetrievalResult } from '../types.js';
import { tokenize, tokensToTsQuery } from '../tokenizer.js';
import { Pool } from 'pg';

export interface SparseSearchParams {
  query: string;
  filter: { kbId: string };
  topK: number;
}

const CANDIDATE_MULTIPLIER = 3;

/**
 * 稀疏检索（tsvector on chunks 表）
 *
 * 分词 → 构造 tsquery → 按 ts_rank 排序 → 返回 topK × CANDIDATE_MULTIPLIER 条候选
 * score = ts_rank（不参与归一化，由 fusion 层处理）
 */
export async function sparseSearch(
  params: SparseSearchParams,
  dbConfig: PGConfig,
  tableName: string,
): Promise<RetrievalResult[]> {
  const { query, filter, topK } = params;
  const tokens = tokenize(query);
  const tsquery = tokensToTsQuery(tokens);

  if (!tsquery) return [];

  const pool = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
  });

  try {
    const result = await pool.query(
      `SELECT id, content, "sourceFile", "chunk_id", ts_rank(tsv, q) AS rank
       FROM "${tableName}"
       WHERE tsv @@ to_tsquery('simple', $1) AND "kbId" = $2
       ORDER BY rank DESC
       LIMIT $3`,
      [tsquery, filter.kbId, Math.ceil(topK * CANDIDATE_MULTIPLIER)],
    );

    return result.rows.map((row: any) => ({
      content: row.content,
      score: parseFloat(row.rank),
      sourceFile: row.sourceFile ?? 'unknown',
      metadata: { chunkId: row.chunk_id, kbId: filter.kbId },
    }));
  } finally {
    await pool.end();
  }
}
