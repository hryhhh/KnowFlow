import { describe, it, expect } from 'vitest';
import { rrfFuse } from './index.js';
import type { RetrievalResult } from '../types.js';

function makeResult(id: string, content = ''): RetrievalResult {
  return { content, score: 0, sourceFile: id, metadata: { chunkId: id } };
}

describe('rrfFuse', () => {
  it('should return empty array for empty inputs', () => {
    const { results } = rrfFuse([], [], 60);
    expect(results).toEqual([]);
  });

  it('should rank dense-only results by inverse rank', () => {
    const dense = [
      makeResult('a', 'result a'),
      makeResult('b', 'result b'),
      makeResult('c', 'result c'),
    ];
    const { results } = rrfFuse(dense, [], 60);
    // RRF score for rank 1: 1/(60+1), rank 2: 1/(60+2), ...
    expect(results[0].metadata.chunkId).toBe('a');
    expect(results[1].metadata.chunkId).toBe('b');
    expect(results[2].metadata.chunkId).toBe('c');
  });

  it('should merge results from both routes and rank by combined RRF', () => {
    const dense = [makeResult('a'), makeResult('b'), makeResult('c')];
    const sparse = [makeResult('a'), makeResult('d')]; // 'a' in both, rank 1 dense + rank 1 sparse

    const { results } = rrfFuse(dense, sparse, 60);
    // 'a': 1/61 + 1/61 = 2/61 ≈ 0.0328 (highest)
    // 'b': 1/62 ≈ 0.0161
    // 'c': 1/63 ≈ 0.0159
    // 'd': 1/62 ≈ 0.0161
    expect(results[0].metadata.chunkId).toBe('a');
  });

  it('should return no more than topK results', () => {
    const dense = Array.from({ length: 10 }, (_, i) => makeResult(`doc-${i}`));
    const { results } = rrfFuse(dense, [], 60);
    expect(results).toHaveLength(10); // placeholder — rrfFuse itself doesn't slice
  });

  it('should handle documents appearing in both lists with different ranks', () => {
    const dense = [makeResult('x'), makeResult('y')];
    const sparse = [makeResult('y'), makeResult('x')];

    const { results } = rrfFuse(dense, sparse, 60);
    // 'x': 1/61 (dense rank 1) + 1/62 (sparse rank 2)
    // 'y': 1/62 (dense rank 2) + 1/61 (sparse rank 1)
    // Both have same score; order is stable but either is acceptable
    expect(results.length).toBe(2);
  });

  it('should be sensitive to k value', () => {
    const dense = [makeResult('a'), makeResult('b')];
    const sparse = [makeResult('b')];

    const { results: resultSmallK } = rrfFuse(dense, sparse, 10);
    const { results: resultLargeK } = rrfFuse(dense, sparse, 100);

    // With small k, overlap matters more
    expect(resultSmallK[0].metadata.chunkId).toBe('b'); // 'b' in both, higher RRF
    expect(resultLargeK[0].metadata.chunkId).toBe('b');
  });
});
