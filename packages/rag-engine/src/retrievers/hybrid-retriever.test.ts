import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EmbeddingConfig, PGConfig, RetrievalResult } from '../types.js';
import type { Document } from '@langchain/core/documents';

// Mock embedQuery to avoid real API calls
vi.mock('../embeddings/openai-embeddings.js', () => ({
  embedQuery: vi.fn().mockResolvedValue([0.1, -0.2, 0.3]),
}));

// Mock similaritySearch — 返回 mock 向量结果
vi.mock('./similarity-retriever.js', () => ({
  similaritySearch: vi.fn().mockResolvedValue([
    {
      content: 'PostgreSQL向量检索原理与实现',
      score: 0.9,
      sourceFile: 'doc1.pdf',
      metadata: { chunkId: 'c1' },
    },
    {
      content: 'JavaScript基础语法教程',
      score: 0.7,
      sourceFile: 'doc2.pdf',
      metadata: { chunkId: 'c2' },
    },
    {
      content: 'PostgreSQL数据库优化技巧',
      score: 0.5,
      sourceFile: 'doc3.pdf',
      metadata: { chunkId: 'c3' },
    },
  ] as RetrievalResult[]),
  type: {} as typeof import('./similarity-retriever.js'),
}));

// Mock sparseSearch to avoid real DB
vi.mock('./sparse-retriever.js', () => ({
  sparseSearch: vi.fn().mockResolvedValue([]),
}));

import { hybridSearch } from './hybrid-retriever.js';
import { similaritySearch } from './similarity-retriever.js';
import { sparseSearch } from './sparse-retriever.js';
import type { HybridSearchParams } from './hybrid-retriever.js';

const mockEmbeddingConfig: EmbeddingConfig = {
  apiKey: 'test-key',
  model: 'text-embedding-3-small',
  baseURL: 'https://api.test.com',
  dimensions: 3,
};

const mockDbConfig: PGConfig = {
  host: 'localhost',
  port: 5432,
  user: 'test',
  password: 'test',
  database: 'test',
};

function makeMockVectorStore(results: Array<{ content: string; score: number }>) {
  return {
    similaritySearchVectorWithScore: async (_q: number[], k: number) =>
      results
        .slice(0, k)
        .map((r) => [
          { pageContent: r.content, metadata: { source: 'test.txt' } } as Document,
          r.score,
        ]),
  };
}

const baseParams: HybridSearchParams = {
  query: 'PostgreSQL 向量检索',
  topK: 10,
  minScore: 0,
  useReranker: false,
  denseWeight: 0.5,
  filter: { kbId: 'kb-1' },
  candidatesPerRoute: 30,
  fusionMethod: 'linear',
  fusionParam: 0.5,
  dbConfig: mockDbConfig,
  sparseTableName: 'chunks',
};

describe('hybridSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call both dense and sparse search in parallel', async () => {
    await hybridSearch(baseParams, makeMockVectorStore([]), mockEmbeddingConfig);

    expect(similaritySearch).toHaveBeenCalled();
    expect(sparseSearch).toHaveBeenCalled();
  });

  it('should fall back to empty sparse results without error', async () => {
    vi.mocked(sparseSearch).mockResolvedValue([]);

    const { results } = await hybridSearch(
      baseParams,
      makeMockVectorStore([]),
      mockEmbeddingConfig,
    );

    expect(results.length).toBeGreaterThan(0);
  });

  it('should respect topK in hybrid result', async () => {
    vi.mocked(sparseSearch).mockResolvedValue([]);

    const params = { ...baseParams, topK: 2, candidatesPerRoute: 6 };
    const { results } = await hybridSearch(params, makeMockVectorStore([]), mockEmbeddingConfig);

    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('should use rrf fusion when fusionMethod=rrf', async () => {
    vi.mocked(sparseSearch).mockResolvedValue([]);

    const params = {
      ...baseParams,
      fusionMethod: 'rrf' as const,
      fusionParam: 60,
    };
    const { results } = await hybridSearch(params, makeMockVectorStore([]), mockEmbeddingConfig);

    expect(results.length).toBeGreaterThan(0);
  });
});
