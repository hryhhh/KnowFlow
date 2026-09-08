/**
 * 检索结果进程内缓存
 *
 * 按 (query, kbId, topK, minScore, retrievalMode, fusionMethod, rrfK, minDenseScore)
 * 哈希缓存检索结果，TTL 到期自动失效。
 * 用于减少重复查询时的向量检索和 embedding 调用。
 *
 * 文档删除时通过 invalidateByKbId() 主动失效相关缓存。
 */

import type { RetrievalResult } from '../types.js';

interface CacheEntry {
  results: RetrievalResult[];
  expiresAt: number;
}

const resultCache = new Map<string, CacheEntry>();

/** 检索结果缓存 TTL（毫秒），0 表示禁用（机制默认值，收编为常量） */
const DEFAULT_TTL_MS = 300000;

/**
 * 生成缓存 key
 */
function makeCacheKey(
  query: string,
  kbId: string,
  topK: number,
  minScore: number | undefined,
  retrievalMode: string,
  fusionMethod: string,
  rrfK: number,
  minDenseScore: number | undefined,
): string {
  const hash = simpleHash(
    `${query}|${kbId}|${topK}|${minScore}|${retrievalMode}|${fusionMethod}|${rrfK}|${minDenseScore}`,
  );
  return `rag:result:${hash}`;
}

/** 简单字符串哈希（非加密，仅用于缓存 key） */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export interface CachedSearchParams {
  query: string;
  kbId: string;
  topK: number;
  minScore?: number;
  retrievalMode: string;
  fusionMethod: string;
  rrfK: number;
  minDenseScore?: number;
}

/**
 * 尝试从缓存返回检索结果。
 */
export async function getCachedResults(
  params: CachedSearchParams,
): Promise<RetrievalResult[] | null> {
  const key = makeCacheKey(
    params.query,
    params.kbId,
    params.topK,
    params.minScore,
    params.retrievalMode,
    params.fusionMethod,
    params.rrfK,
    params.minDenseScore,
  );
  const entry = resultCache.get(key);

  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    resultCache.delete(key);
    return null;
  }

  return entry.results;
}

/**
 * 将检索结果写入缓存。
 */
export function setCachedResults(
  params: CachedSearchParams,
  results: RetrievalResult[],
  ttlMs: number = DEFAULT_TTL_MS,
): void {
  const key = makeCacheKey(
    params.query,
    params.kbId,
    params.topK,
    params.minScore,
    params.retrievalMode,
    params.fusionMethod,
    params.rrfK,
    params.minDenseScore,
  );
  resultCache.set(key, {
    results,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * 失效指定 kbId 下的所有缓存条目（文档删除/更新时调用）。
 * 生产环境可升级为 Redis 键前缀失效。
 */
export function invalidateByKbId(_kbId: string): void {
  // 当前 key 不包含 kbId，保守清空全部
  resultCache.clear();
}

/** 获取缓存统计（用于观测） */
export function getCacheStats(): { size: number; ttlMs: number } {
  return {
    size: resultCache.size,
    ttlMs: DEFAULT_TTL_MS,
  };
}
