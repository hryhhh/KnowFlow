import { describe, it, expect, afterEach } from 'vitest';
import { applySparseScoreNormalization, isSparseScoreNormalizationOn } from './index.js';

describe('applySparseScoreNormalization（A5）', () => {
  // --- 边界情况 ---

  it('空结果直接返回', () => {
    expect(applySparseScoreNormalization([])).toEqual([]);
  });

  it('单条结果归一化为 1.0（range=0）', () => {
    const input = [{ score: 5.0, content: 'c', sourceFile: 'f', metadata: { chunkId: 'x' } }];
    const [r] = applySparseScoreNormalization(input);
    expect(r.score).toBe(1.0);
    expect(r.metadata.scoreRaw).toBe(5.0);
  });

  it('全同分结果全部归一化为 1.0', () => {
    const input = [
      { score: 3.0, content: 'a', sourceFile: 'f1', metadata: {} },
      { score: 3.0, content: 'b', sourceFile: 'f2', metadata: {} },
      { score: 3.0, content: 'c', sourceFile: 'f3', metadata: {} },
    ];
    const results = applySparseScoreNormalization(input);
    results.forEach((r) => expect(r.score).toBeCloseTo(1.0, 5));
    results.forEach((r) => expect(r.metadata.scoreRaw).toBe(3.0));
  });

  // --- min-max 归一化正确性 ---

  it('最小分 → 0，最大分 → 1，中间值按比例映射', () => {
    const input = [
      { score: 1.0, content: 'low', sourceFile: 'f1', metadata: {} },
      { score: 5.0, content: 'mid', sourceFile: 'f2', metadata: {} },
      { score: 9.0, content: 'high', sourceFile: 'f3', metadata: {} },
    ];
    const results = applySparseScoreNormalization(input);
    // score = (s - 1) / (9 - 1)
    expect(results[0].score).toBeCloseTo(0.0, 5);   // (1-1)/8 = 0
    expect(results[1].score).toBeCloseTo(0.5, 5);   // (5-1)/8 = 0.5
    expect(results[2].score).toBeCloseTo(1.0, 5);   // (9-1)/8 = 1
    // 原始分保留在 metadata
    expect(results[0].metadata.scoreRaw).toBe(1.0);
    expect(results[1].metadata.scoreRaw).toBe(5.0);
    expect(results[2].metadata.scoreRaw).toBe(9.0);
  });

  it('不修改输入数组（不可变性）', () => {
    const input = [{ score: 2.0, content: 'c', sourceFile: 'f', metadata: {} }];
    applySparseScoreNormalization(input);
    expect(input[0].score).toBe(2.0); // 原数组不受影响
  });

  it('原始 metadata 被保留（扩展而非覆盖）', () => {
    const input = [{ score: 3.0, content: 'c', sourceFile: 'f', metadata: { chunkId: 'abc', kbId: 'kb-1' } }];
    const [r] = applySparseScoreNormalization(input);
    expect(r.metadata.chunkId).toBe('abc');
    expect(r.metadata.kbId).toBe('kb-1');
    expect(r.metadata.scoreRaw).toBe(3.0);
  });
});

describe('isSparseScoreNormalizationOn（A5）', () => {
  afterEach(() => {
    delete process.env.RETRIEVAL_SPARSE_SCORE_NORMALIZATION;
  });

  it('默认关闭（env 未设置）', () => {
    expect(isSparseScoreNormalizationOn()).toBe(false);
  });

  it('env 为 "true" 时开启', () => {
    process.env.RETRIEVAL_SPARSE_SCORE_NORMALIZATION = 'true';
    expect(isSparseScoreNormalizationOn()).toBe(true);
  });

  it('env 为 "false" 时关闭', () => {
    process.env.RETRIEVAL_SPARSE_SCORE_NORMALIZATION = 'false';
    expect(isSparseScoreNormalizationOn()).toBe(false);
  });
});
