/**
 * 离线评测 Runner（CI 冒烟）
 *
 * 读取 fixtures/eval-queries.json，对每条 query 调用 retrieve()，
 * 对比返回 chunkId 是否在 expectedChunkIds 中，计算 Recall@10。
 *
 * 运行方式：
 *   DATABASE_HOST=localhost DATABASE_PORT=5433 DATABASE_USER=postgres \
 *   DATABASE_PASSWORD=123456 DATABASE_NAME=knowledge_rag \
 *   EMBEDDING_API_KEY=test EMBEDDING_BASE_URL=http://localhost:3000 \
 *   pnpm --filter @knowbase-x/rag-engine test eval-runner
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { retrieve } from './pipeline.js';
import type { SearchParams, RetrievalResult } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 加载评测集 ───────────────────────────────────────────────

interface EvalQuery {
  id: string;
  query: string;
  queryType: string;
  expectedChunkIds: string[];
  description: string;
}

const fixturePath = resolve(__dirname, '../__tests__/fixtures/eval-queries.json');
const evalQueries: EvalQuery[] = JSON.parse(readFileSync(fixturePath, 'utf8'));

// ── Mock 依赖（跳过真实网络和 DB 调用）────────────────────────

vi.mock('./embeddings/openai-embeddings.js', () => ({
  getEmbeddings: vi.fn(() => ({
    embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  })),
}));

vi.mock('./stores/pgvector-store.js', () => ({
  ensureCachedPGVectorStore: vi.fn().mockResolvedValue({
    similaritySearchVectorWithScore: vi.fn().mockResolvedValue([]),
  }),
  addDocumentsToPG: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./retrievers/similarity-retriever.js', () => ({
  similaritySearch: vi.fn().mockResolvedValue([]),
}));

vi.mock('./retrievers/hybrid-retriever.js', () => ({
  hybridSearch: vi.fn().mockResolvedValue({ results: [], debug: null }),
}));

vi.mock('./retrievers/sparse-retriever.js', () => ({
  sparseSearch: vi.fn().mockResolvedValue([]),
}));

vi.mock('./rerankers/bi-encoder-reranker.js', () => ({
  rerank: vi.fn().mockResolvedValue([]),
}));

vi.mock('./llm/chat-service.js', () => ({
  buildContext: vi.fn(() => '（暂无可用参考资料）'),
  streamChat: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./cache/search-cache.js', () => ({
  getCachedResults: vi.fn().mockResolvedValue(null),
  setCachedResults: vi.fn(),
  invalidateByKbId: vi.fn(),
  getCacheStats: vi.fn(() => ({ size: 0, ttlMs: 300000 })),
}));

const MOCK_CONFIG = {
  pg: { host: 'localhost', port: 5433, user: 'test', password: 'test', database: 'test' },
  llm: { apiKey: 'test', model: 'gpt-4', baseURL: 'https://api.test.com' },
  embedding: { apiKey: 'test', model: 'text-embedding-3-small', baseURL: 'https://api.test.com', dimensions: 3 },
  chunkSize: 1000,
  chunkOverlap: 200,
  pgTableName: 'langchainjs',
};

// ── 实际检索结果收集（用于生成新 fixture）──────────────────────

const collectedResults = new Map<string, RetrievalResult[]>();

// ── 测试组：基础结构验证（不依赖 DB）──────────────────────────

describe('eval-runner: fixture 结构验证', () => {
  it('eval-queries.json 存在且至少 20 条', () => {
    expect(evalQueries.length).toBeGreaterThanOrEqual(20);
  });

  it('每条 query 都有必填字段', () => {
    for (const q of evalQueries) {
      expect(q.id, `query ${q.id}`).toBeTruthy();
      expect(q.query, `query ${q.id} query`).toBeTruthy();
      expect(q.expectedChunkIds, `query ${q.id} expectedChunkIds`).toBeTruthy();
    }
  });

  it('queryType 覆盖所有指定类型', () => {
    const types = new Set(evalQueries.map((q) => q.queryType));
    expect(types.has('chinese-no-space')).toBe(true);
    expect(types.has('english-tech')).toBe(true);
    expect(types.has('mixed')).toBe(true);
    expect(types.has('error-code')).toBe(true);
  });

  it('每类 query 至少有 2 条', () => {
    const byType = evalQueries.reduce(
      (acc, q) => { acc[q.queryType] = (acc[q.queryType] ?? 0) + 1; return acc; },
      {} as Record<string, number>,
    );
    for (const [type, count] of Object.entries(byType)) {
      expect(count, `${type} 数量不足`).toBeGreaterThanOrEqual(2);
    }
  });
});

// ── 测试组：检索逻辑验证（需要真实 DB）────────────────────────

describe('eval-runner: 检索召回评测', () => {
  // 跳过，需接入真实 DB 后取消注释
  it.skip('对 eval-queries 批量检索并计算 Recall@10', async () => {
    let totalExpected = 0;
    let totalHit = 0;
    const typeStats = new Map<string, { expected: number; hit: number }>();

    for (const q of evalQueries) {
      const params: SearchParams = {
        topK: 10,
        minScore: 0,
        useReranker: false,
        denseWeight: 0.5,
        retrievalMode: 'hybrid',
        fusionMethod: 'rrf',
        debug: false,
      };

      const results = await retrieve(q.query, 'kb-test', params, MOCK_CONFIG as any);
      collectedResults.set(q.id, results);

      const resultChunkIds = new Set(results.map((r) => r.metadata?.chunkId as string).filter(Boolean));
      const expectedSet = new Set(q.expectedChunkIds);

      totalExpected += expectedSet.size;
      const hit = [...expectedSet].filter((id) => resultChunkIds.has(id)).length;
      totalHit += hit;

      const stat = typeStats.get(q.queryType) ?? { expected: 0, hit: 0 };
      stat.expected += expectedSet.size;
      stat.hit += hit;
      typeStats.set(q.queryType, stat);
    }

    console.log('\n=== Eval 评测报告 ===');
    console.log(`总体 Recall@10: ${totalHit}/${totalExpected} = ${(totalHit / totalExpected * 100).toFixed(1)}%`);
    for (const [type, stat] of typeStats) {
      const recall = stat.expected > 0 ? (stat.hit / stat.expected * 100).toFixed(1) : 'N/A';
      console.log(`  ${type}: ${stat.hit}/${stat.expected} = ${recall}%`);
    }
    console.log('====================\n');

    // PRD 要求：专有名词类 Recall@10 ≥ 0.9
    const errorCodeStats = typeStats.get('error-code') ?? { expected: 0, hit: 0 };
    if (errorCodeStats.expected > 0) {
      expect(errorCodeStats.hit / errorCodeStats.expected).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('debug=true 时 retrieve 返回 SearchDebugInfo', async () => {
    const params: SearchParams = {
      topK: 5,
      minScore: 0,
      useReranker: false,
      denseWeight: 0.5,
      retrievalMode: 'vector',
      debug: true,
    };

    const { debug } = await retrieve('test query', 'kb-test', params, MOCK_CONFIG as any);
    expect(debug).toBeDefined();
    expect(debug!.mode).toBe('vector');
    expect(debug!.items).toBeDefined();
  });
});
