import type { RetrievalResult, SearchDebugInfo } from '../types.js';

/**
 * Reciprocal Rank Fusion
 *
 * RRF(d) = Σ_{r in {dense, sparse}} 1 / (k + rank_r(d))
 * rank 从 1 开始，未出现则该项为 0。
 * 最终按 RRF 分降序取 topK。
 */
export function rrfFuse(
  dense: RetrievalResult[],
  sparse: RetrievalResult[],
  k: number,
  debug?: boolean,
): { results: RetrievalResult[]; debug?: SearchDebugInfo } {
  const scoreMap = new Map<
    string,
    {
      rrf: number;
      result?: RetrievalResult;
      rankDense?: number;
      rankSparse?: number;
      scoreDense?: number;
      scoreSparse?: number;
    }
  >();

  for (let i = 0; i < dense.length; i++) {
    const id = getChunkId(dense[i]);
    const prev = scoreMap.get(id) ?? { rrf: 0 };
    scoreMap.set(id, {
      rrf: prev.rrf + 1 / (k + i + 1),
      result: dense[i],
      rankDense: debug ? i + 1 : undefined,
      scoreDense: debug ? dense[i].score : undefined,
    });
  }

  for (let i = 0; i < sparse.length; i++) {
    const id = getChunkId(sparse[i]);
    const prev = scoreMap.get(id) ?? { rrf: 0 };
    scoreMap.set(id, {
      rrf: prev.rrf + 1 / (k + i + 1),
      result: sparse[i],
      rankSparse: debug ? i + 1 : undefined,
      scoreSparse: debug ? sparse[i].score : undefined,
    });
  }

  const results = Array.from(scoreMap.values())
    .map(({ rrf, result }) => ({ ...result!, score: rrf }))
    .sort((a, b) => b.score - a.score);

  // 构建 debug 信息
  let debugInfo: SearchDebugInfo | undefined;
  if (debug) {
    debugInfo = {
      mode: 'hybrid',
      fusion: 'rrf',
      denseCandidates: dense.length,
      sparseCandidates: sparse.length,
      fusedTopK: results.length,
      items: results.map((r, idx) => {
        const entry = Array.from(scoreMap.values()).find((e) => e.result === r);
        return {
          chunkId: getChunkId(r),
          rankDense: entry?.rankDense ?? null,
          rankSparse: entry?.rankSparse ?? null,
          scoreDense: entry?.scoreDense ?? null,
          scoreSparse: entry?.scoreSparse ?? null,
          scoreFused: r.score,
          sourceFile: r.sourceFile,
        };
      }),
    };
  }

  return { results, debug: debugInfo };
}

/**
 * Linear weighted fusion
 *
 * s = w * norm_dense + (1 - w) * norm_sparse
 * 归一化：min-max 到 [0, 1]；仅出现在一路的文档，另一路计 0。
 */
export function linearFuse(
  dense: RetrievalResult[],
  sparse: RetrievalResult[],
  weight: number,
  debug?: boolean,
): { results: RetrievalResult[]; debug?: SearchDebugInfo } {
  if (dense.length === 0 && sparse.length === 0) {
    return { results: [] };
  }

  const allIds = new Set<string>([...dense.map(getChunkId), ...sparse.map(getChunkId)]);

  const denseMap = new Map<string, number>();
  for (const r of dense) denseMap.set(getChunkId(r), r.score);

  const sparseMap = new Map<string, number>();
  for (const r of sparse) sparseMap.set(getChunkId(r), r.score);

  // 单路为空时直接返回（另一路结果无需归一化）
  if (denseMap.size === 0) {
    return { results: sparse, debug: undefined };
  }
  if (sparseMap.size === 0) {
    return { results: dense, debug: undefined };
  }

  const denseScores = Array.from(denseMap.values());
  const sparseScores = Array.from(sparseMap.values());
  const dMin = Math.min(...denseScores);
  const dMax = Math.max(...denseScores);
  const sMin = Math.min(...sparseScores);
  const sMax = Math.max(...sparseScores);
  const dRange = dMax - dMin || 1;
  const sRange = sMax - sMin || 1;

  // 构建 rank 映射用于 debug
  const denseRankMap = new Map<string, number>();
  dense.forEach((r, i) => denseRankMap.set(getChunkId(r), i + 1));
  const sparseRankMap = new Map<string, number>();
  sparse.forEach((r, i) => sparseRankMap.set(getChunkId(r), i + 1));

  const results = Array.from(allIds)
    .map((id) => {
      const dScore = denseMap.get(id) ?? 0;
      const sScore = sparseMap.get(id) ?? 0;
      // 取 dense 或 sparse 中的原始结果作为基础，回填 fusion score
      const baseResult =
        dense.find((r) => getChunkId(r) === id) ??
        sparse.find((r) => getChunkId(r) === id) ??
        ({ content: '', sourceFile: id, score: 0, metadata: {} } as RetrievalResult);
      const normDense = (dScore - dMin) / dRange;
      const normSparse = (sScore - sMin) / sRange;
      return { ...baseResult, score: weight * normDense + (1 - weight) * normSparse };
    })
    .sort((a, b) => b.score - a.score);

  // 构建 debug 信息
  let debugInfo: SearchDebugInfo | undefined;
  if (debug) {
    debugInfo = {
      mode: 'hybrid',
      fusion: 'linear',
      denseCandidates: dense.length,
      sparseCandidates: sparse.length,
      fusedTopK: results.length,
      items: results.map((r) => {
        const chunkId = getChunkId(r);
        return {
          chunkId,
          rankDense: denseRankMap.get(chunkId) ?? null,
          rankSparse: sparseRankMap.get(chunkId) ?? null,
          scoreDense: denseMap.get(chunkId) ?? null,
          scoreSparse: sparseMap.get(chunkId) ?? null,
          scoreFused: r.score,
          sourceFile: r.sourceFile,
        };
      }),
    };
  }

  return { results, debug: debugInfo };
}

function getChunkId(result: RetrievalResult): string {
  return (result.metadata?.chunkId as string) ?? result.sourceFile;
}
