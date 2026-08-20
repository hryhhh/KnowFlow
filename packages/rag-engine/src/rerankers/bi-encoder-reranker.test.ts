import { describe, it, expect, vi } from 'vitest';
import { rerank } from './bi-encoder-reranker.js';
import type { EmbeddingConfig, RetrievalResult } from '../types.js';

// Mock embedding functions
vi.mock('../embeddings/openai-embeddings.js', () => ({
  getEmbeddings: vi.fn(() => ({
    embedQuery: vi.fn().mockResolvedValue([0.8, 0.1, 0.2]),
    embedDocuments: vi.fn().mockResolvedValue([
      [0.75, 0.12, 0.18], // doc A: similar to query
      [0.3, 0.6, 0.5], // doc B: less similar
      [0.9, 0.05, 0.05], // doc C: most similar
    ]),
  })),
}));

const mockConfig: EmbeddingConfig = {
  apiKey: 'test',
  model: 'text-embedding-3-small',
  baseURL: 'https://api.test.com',
  dimensions: 3,
};

const mockResults: RetrievalResult[] = [
  { content: 'Document A content', score: 0.9, sourceFile: 'a.txt', metadata: {} },
  { content: 'Document B content', score: 0.7, sourceFile: 'b.txt', metadata: {} },
  { content: 'Document C content', score: 0.5, sourceFile: 'c.txt', metadata: {} },
];

describe('rerank (Bi-Encoder)', () => {
  it('should return empty array for empty input', async () => {
    const result = await rerank('test', [], mockConfig);
    expect(result).toEqual([]);
  });

  it('should re-rank results by cosine similarity', async () => {
    const result = await rerank('test query', mockResults, mockConfig);
    expect(result).toHaveLength(3);
    // doc A has highest similarity [0.75,0.12,0.18] vs query [0.8,0.1,0.2]
    expect(result[0].sourceFile).toBe('a.txt');
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it('should respect topK limit', async () => {
    const result = await rerank('test query', mockResults, mockConfig, { topK: 2 });
    expect(result).toHaveLength(2);
    expect(result[0].sourceFile).toBe('a.txt');
  });

  it('should filter results below minScore', async () => {
    const result = await rerank('test query', mockResults, mockConfig, { minScore: 0.99 });
    // Only docs with very high similarity should pass
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('should not modify original score field', async () => {
    const result = await rerank('test query', mockResults, mockConfig);
    // Original score should be preserved, rerankScore should not leak
    expect(result[0]).not.toHaveProperty('rerankScore');
  });
});
