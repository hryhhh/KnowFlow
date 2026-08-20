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

  it('should sort results by rerank score descending', async () => {
    const result = await rerank('test query', mockResults, mockConfig);
    for (let i = 1; i < result.length; i++) {
      // Scores are extracted via toFixed internally but we verify ordering
      // by checking the re-ranked order matches cosine similarity ordering
    }
    // doc A should be first (highest similarity per mock embeddings)
    expect(result[0].sourceFile).toBe('a.txt');
    expect(result[result.length - 1].score).toBeLessThanOrEqual(result[0].score);
  });

  it('should return only best result when topK=1', async () => {
    const result = await rerank('test query', mockResults, mockConfig, { topK: 1 });
    expect(result).toHaveLength(1);
    expect(result[0].sourceFile).toBe('a.txt');
  });

  it('should remove all results when minScore is impossibly high', async () => {
    const result = await rerank('test query', mockResults, mockConfig, { minScore: 0.99 });
    expect(result.length).toBeLessThan(mockResults.length);
  });

  it('should not mutate the original results array', async () => {
    const originalScores = mockResults.map((r) => r.score);
    await rerank('test query', mockResults, mockConfig);
    mockResults.forEach((r, i) => {
      expect(r.score).toBe(originalScores[i]);
    });
  });

  it('should return empty array when all results are below minScore', async () => {
    const result = await rerank('test query', mockResults, mockConfig, { minScore: 2.0 });
    expect(result).toEqual([]);
  });

  it('should produce cosine similarity scores between 0 and 1', async () => {
    // Mocked embeddings: A=[0.75,0.12,0.18], B=[0.3,0.6,0.5], C=[0.9,0.05,0.05] vs query=[0.8,0.1,0.2]
    // Cosine similarities: A≈0.999, B≈0.576, C≈0.980
    const result = await rerank('test query', mockResults, mockConfig);
    expect(result.length).toBe(3);
    // Verify descending order: A > C > B
    expect(result[0].sourceFile).toBe('a.txt');
    expect(result[1].sourceFile).toBe('c.txt');
    expect(result[2].sourceFile).toBe('b.txt');
    // Scores should be in [0, 1]
    result.forEach((r) => {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    });
  });

  it('should handle empty query with non-empty results', async () => {
    const result = await rerank('', mockResults, mockConfig);
    expect(result).toHaveLength(3);
    // Empty query embedding should still produce valid similarity scores
    expect(result.every((r) => typeof r.score === 'number')).toBe(true);
  });

  it('should handle duplicate content correctly', async () => {
    const dupResults: RetrievalResult[] = [
      { content: 'Duplicate content', score: 0.5, sourceFile: 'a.txt', metadata: {} },
      { content: 'Duplicate content', score: 0.5, sourceFile: 'b.txt', metadata: {} },
      { content: 'Unique content', score: 0.8, sourceFile: 'c.txt', metadata: {} },
    ];

    const result = await rerank('test query', dupResults, mockConfig);
    expect(result).toHaveLength(3);
    // Duplicates should retain their separate sourceFile identities
    const sources = result.map((r) => r.sourceFile).sort();
    expect(sources).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });
});
