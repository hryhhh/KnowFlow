import { describe, it, expect, vi } from 'vitest';
import type { VectorStoreLike } from './similarity-retriever.js';
import type { HybridSearchParams } from './hybrid-retriever.js';
import type { EmbeddingConfig } from '../types.js';
import type { Document } from '@langchain/core/documents';

// Mock embedQuery to avoid real API calls
vi.mock('../embeddings/openai-embeddings.js', () => ({
  embedQuery: vi.fn().mockResolvedValue([0.1, -0.2, 0.3]),
}));

import { hybridSearch } from './hybrid-retriever.js';
import { embedQuery } from '../embeddings/openai-embeddings.js';

function makeMockVectorStore(results: Array<{ content: string; score: number }>): VectorStoreLike {
  return {
    similaritySearchVectorWithScore: async () =>
      results.map((r) => [
        { pageContent: r.content, metadata: { source: 'test.txt' } } as Document,
        r.score,
      ]),
  };
}

const mockEmbeddingConfig: EmbeddingConfig = {
  apiKey: 'test-key',
  model: 'text-embedding-3-small',
  baseURL: 'https://api.test.com',
  dimensions: 3,
};

describe('hybridSearch', () => {
  it('should use denseWeight to blend vector and keyword scores', async () => {
    const store = makeMockVectorStore([
      { content: 'PostgreSQL向量检索原理与实现', score: 0.9 },
      { content: 'JavaScript基础语法教程', score: 0.7 },
      { content: 'PostgreSQL数据库优化技巧', score: 0.5 },
    ]);

    const params: HybridSearchParams = {
      query: 'PostgreSQL 向量检索',
      topK: 10,
      minScore: 0,
      useReranker: false,
      denseWeight: 0.5,
    };

    const results = await hybridSearch(params, store, mockEmbeddingConfig);

    // When denseWeight=0.5, keyword hits should shift scores
    // "PostgreSQL向量检索原理与实现" matches both terms → should have highest score
    // "PostgreSQL数据库优化技巧" matches one term → should be higher than non-matching
    // "JavaScript基础语法教程" matches none → should have lowest score
    expect(results).toHaveLength(3);
    expect(results[0].content).toContain('PostgreSQL向量检索原理');
    expect(results[2].content).toContain('JavaScript');
  });

  it('should still work when denseWeight=1.0 (pure vector search)', async () => {
    const store = makeMockVectorStore([
      { content: 'PostgreSQL向量检索原理与实现', score: 0.9 },
      { content: 'JavaScript基础语法教程', score: 0.7 },
    ]);

    const params: HybridSearchParams = {
      query: 'PostgreSQL 向量检索',
      topK: 10,
      minScore: 0,
      useReranker: false,
      denseWeight: 1.0,
    };

    const results = await hybridSearch(params, store, mockEmbeddingConfig);

    // With denseWeight=1.0, keywordWeight=0, keyword hits should not affect ranking
    expect(results).toHaveLength(2);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('should correctly tokenize Chinese query terms', async () => {
    const store = makeMockVectorStore([
      { content: 'PostgreSQL向量检索原理与实现', score: 0.9 },
      { content: 'JavaScript基础语法教程', score: 0.7 },
      { content: 'PostgreSQL数据库优化技巧', score: 0.5 },
    ]);

    const params: HybridSearchParams = {
      query: 'PostgreSQL向量检索',
      topK: 10,
      minScore: 0,
      useReranker: false,
      denseWeight: 0.3,
    };

    const results = await hybridSearch(params, store, mockEmbeddingConfig);
    expect(results).toHaveLength(3);
    // "PostgreSQL向量检索原理与实现" matches all 3 terms (PostgreSQL, 向量, 检索) → highest
    expect(results[0].content).toContain('PostgreSQL向量检索原理');
  });

  it('should work when denseWeight=0.0 (pure keyword search)', async () => {
    const store = makeMockVectorStore([
      { content: 'PostgreSQL向量检索原理与实现', score: 0.9 },
      { content: 'JavaScript基础语法教程', score: 0.7 },
      { content: 'PostgreSQL数据库优化技巧', score: 0.5 },
    ]);

    const params: HybridSearchParams = {
      query: 'PostgreSQL 向量检索',
      topK: 10,
      minScore: 0,
      useReranker: false,
      denseWeight: 0.0,
    };

    const results = await hybridSearch(params, store, mockEmbeddingConfig);

    // With denseWeight=0, keyword hits should determine ranking
    // Results matching "PostgreSQL" or "向量检索" should rank higher
    expect(results).toHaveLength(3);
    const pgResults = results.filter((r) => r.content.includes('PostgreSQL'));
    const jsResult = results.find((r) => r.content.includes('JavaScript'));
    // At least one PostgreSQL result should be above JavaScript
    expect(pgResults.length).toBeGreaterThan(0);
    if (jsResult) {
      expect(pgResults[0].score).toBeGreaterThan(jsResult.score);
    }
  });
});
