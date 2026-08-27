import { describe, it, expect } from 'vitest';
import { linearFuse } from './index.js';
import type { RetrievalResult } from '../types.js';

function makeResult(id: string, score: number): RetrievalResult {
  return { content: '', score, sourceFile: id, metadata: { chunkId: id } };
}

describe('linearFuse', () => {
  it('should return empty array for empty inputs', () => {
    const { results } = linearFuse([], [], 0.5);
    expect(results).toEqual([]);
  });

  it('should linearly combine scores with weight', () => {
    const dense = [makeResult('a', 0.9), makeResult('b', 0.5)];
    const sparse = [makeResult('a', 0.8), makeResult('c', 0.3)];

    const { results } = linearFuse(dense, sparse, 0.5);

    // 'a' appears in both → weighted avg of normalized scores
    // 'b' only in dense → normDense * 0.5
    // 'c' only in sparse → normSparse * 0.5
    expect(results.length).toBe(3);
    // 'a' should have highest fused score (high in both)
    expect(results[0].metadata.chunkId).toBe('a');
  });

  it('should give weight=1 results equal to dense scores only', () => {
    const dense = [makeResult('a', 0.9), makeResult('b', 0.3)];
    const sparse = [makeResult('a', 0.8)];

    const { results } = linearFuse(dense, sparse, 1.0);

    // With weight=1, sparse contribution is 0; ordering follows dense
    expect(results[0].metadata.chunkId).toBe('a');
    expect(results[1].metadata.chunkId).toBe('b');
  });

  it('should give weight=0 results equal to sparse scores only', () => {
    const dense = [makeResult('a', 0.9)];
    const sparse = [makeResult('a', 0.8), makeResult('b', 0.6)];

    const { results } = linearFuse(dense, sparse, 0.0);

    expect(results[0].metadata.chunkId).toBe('a');
    expect(results[1].metadata.chunkId).toBe('b');
  });

  it('should handle single-document dense list', () => {
    const dense = [makeResult('a', 0.7)];
    const sparse: RetrievalResult[] = [];

    const { results } = linearFuse(dense, sparse, 0.5);
    expect(results).toHaveLength(1);
    expect(results[0].metadata.chunkId).toBe('a');
  });
});
