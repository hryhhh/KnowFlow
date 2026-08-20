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

  it('should not false-positive on substring matches (e.g. "ai" in "JavaScript")', async () => {
    const store = makeMockVectorStore([
      { content: 'JavaScript前端开发教程', score: 0.95 },
      { content: 'AI 模型原理详解', score: 0.6 },
    ]);

    const params: HybridSearchParams = {
      query: 'AI 模型原理',
      topK: 10,
      minScore: 0,
      useReranker: false,
      denseWeight: 0.0,
    };

    const results = await hybridSearch(params, store, mockEmbeddingConfig);
    // 纯关键词模式（denseWeight=0），"JavaScript" 不含完整词 "AI"，不应排名高于含 "AI" 的文档
    expect(results[0].content).toContain('AI 模型原理');
    expect(results[1].content).toContain('JavaScript');
  });

  it('should pass kbId filter to the vector store (not just post-filter)', async () => {
    const mockSimSearch = vi
      .fn()
      .mockResolvedValue([
        [{ pageContent: 'KB-A content', metadata: { source: 'a.txt', kbId: 'kb-a' } }, 0.9],
      ] as [Document, number][]);
    const store = { similaritySearchVectorWithScore: mockSimSearch } as unknown as VectorStoreLike;

    const params: HybridSearchParams = {
      query: 'KB-A content',
      topK: 10,
      minScore: 0,
      useReranker: false,
      denseWeight: 1.0,
      filter: { kbId: 'kb-a' },
    };

    await hybridSearch(params, store, mockEmbeddingConfig);

    expect(mockSimSearch).toHaveBeenCalledTimes(1);
    const callArgs = mockSimSearch.mock.calls[0];
    expect(callArgs[2]).toEqual({ kbId: 'kb-a' });
  });

  it('should respect topK limit', async () => {
    const store = makeMockVectorStore([
      { content: 'Document one', score: 0.9 },
      { content: 'Document two', score: 0.8 },
      { content: 'Document three', score: 0.7 },
    ]);

    const params: HybridSearchParams = {
      query: 'test',
      topK: 2,
      minScore: 0,
      useReranker: false,
      denseWeight: 1.0,
    };

    const results = await hybridSearch(params, store, mockEmbeddingConfig);
    expect(results).toHaveLength(2);
  });

  it('should filter out results below minScore', async () => {
    const store = makeMockVectorStore([
      { content: 'High score result', score: 0.9 },
      { content: 'Low score result', score: 0.3 },
    ]);

    const params: HybridSearchParams = {
      query: 'test',
      topK: 10,
      minScore: 0.5,
      useReranker: false,
      denseWeight: 1.0,
    };

    const results = await hybridSearch(params, store, mockEmbeddingConfig);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThanOrEqual(0.5);
  });

  it('should return results with content, sourceFile, score, and metadata fields', async () => {
    const store = makeMockVectorStore([{ content: 'Some content here', score: 0.85 }]);

    const params: HybridSearchParams = {
      query: 'test',
      topK: 10,
      minScore: 0,
      useReranker: false,
      denseWeight: 1.0,
    };

    const results = await hybridSearch(params, store, mockEmbeddingConfig);
    expect(results[0]).toHaveProperty('content', 'Some content here');
    expect(results[0]).toHaveProperty('sourceFile', 'test.txt');
    expect(results[0]).toHaveProperty('score');
    expect(results[0]).toHaveProperty('metadata');
    expect(typeof results[0].score).toBe('number');
  });

  it('should handle negative scores from vector store', async () => {
    const store = makeMockVectorStore([
      { content: 'Negative score result', score: -0.5 },
      { content: 'Positive score result', score: 0.8 },
    ]);

    const params: HybridSearchParams = {
      query: 'test',
      topK: 10,
      minScore: 0,
      useReranker: false,
      denseWeight: 1.0,
    };

    const results = await hybridSearch(params, store, mockEmbeddingConfig);
    // Negative score filtered out by minScore=0
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('Positive');
  });

  it('should handle NaN scores from vector store', async () => {
    const store = makeMockVectorStore([
      { content: 'NaN score result', score: NaN },
      { content: 'Valid score result', score: 0.7 },
    ]);

    const params: HybridSearchParams = {
      query: 'test',
      topK: 10,
      minScore: 0,
      useReranker: false,
      denseWeight: 1.0,
    };

    const results = await hybridSearch(params, store, mockEmbeddingConfig);
    // NaN scores are not >= 0, so filtered out
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('Valid');
  });

  it('should return empty array when vector store returns no results', async () => {
    const store = makeMockVectorStore([]);

    const params: HybridSearchParams = {
      query: 'test',
      topK: 10,
      minScore: 0,
      useReranker: false,
      denseWeight: 1.0,
    };

    const results = await hybridSearch(params, store, mockEmbeddingConfig);
    expect(results).toEqual([]);
  });

  it('should handle single result correctly', async () => {
    const store = makeMockVectorStore([{ content: 'Only result', score: 0.95 }]);

    const params: HybridSearchParams = {
      query: 'test',
      topK: 10,
      minScore: 0,
      useReranker: false,
      denseWeight: 1.0,
    };

    const results = await hybridSearch(params, store, mockEmbeddingConfig);
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('Only result');
  });

  it('should handle Chinese query with mixed English terms', async () => {
    const store = makeMockVectorStore([
      { content: 'Python机器学习入门指南', score: 0.8 },
      { content: 'JavaWeb开发实战', score: 0.6 },
      { content: '深度学习原理与Python实现', score: 0.9 },
    ]);

    const params: HybridSearchParams = {
      query: 'Python 机器学习 深度学习',
      topK: 10,
      minScore: 0,
      useReranker: false,
      denseWeight: 0.3,
    };

    const results = await hybridSearch(params, store, mockEmbeddingConfig);
    expect(results).toHaveLength(3);
    // Result matching most terms should rank highest
    expect(results[0].content).toContain('Python');
  });
});
