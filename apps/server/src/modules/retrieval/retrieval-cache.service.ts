import { Injectable, Logger } from '@nestjs/common';

/**
 * 检索结果缓存服务（进程内 Map）
 *
 * 按 (query, kbId, topK, minScore, retrievalMode, fusionMethod, rrfK) 哈希缓存检索结果，
 * TTL 默认 5 分钟。文档删除时通过 invalidateByKbId() 主动失效指定知识库的缓存条目。
 */
@Injectable()
export class RetrievalCacheService {
  private readonly logger = new Logger(RetrievalCacheService.name);
  private readonly cache = new Map<string, { results: any[]; expiresAt: number; kbId: string }>();
  private readonly ttlMs: number;

  constructor() {
    this.ttlMs = parseInt(process.env.RAG_RESULT_CACHE_TTL_MS ?? '300000', 10);
  }

  private makeKey(
    query: string,
    kbId: string,
    topK: number,
    minScore: number,
    retrievalMode: string,
    fusionMethod: string,
    rrfK: number,
  ): string {
    let hash = 0;
    const str = `${query}|${kbId}|${topK}|${minScore}|${retrievalMode}|${fusionMethod}|${rrfK}`;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `rag:result:${Math.abs(hash).toString(36)}`;
  }

  async get(
    query: string,
    kbId: string,
    topK: number,
    minScore: number,
    retrievalMode: string,
    fusionMethod: string,
    rrfK: number,
  ): Promise<any[] | null> {
    const key = this.makeKey(query, kbId, topK, minScore, retrievalMode, fusionMethod, rrfK);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.results;
  }

  set(
    query: string,
    kbId: string,
    topK: number,
    minScore: number,
    retrievalMode: string,
    fusionMethod: string,
    rrfK: number,
    results: any[],
  ): void {
    const key = this.makeKey(query, kbId, topK, minScore, retrievalMode, fusionMethod, rrfK);
    this.cache.set(key, { results, expiresAt: Date.now() + this.ttlMs, kbId });
  }

  /** 文档删除时失效指定 kbId 下的所有缓存条目 */
  invalidateByKbId(kbId: string): void {
    let cleaned = 0;
    for (const [key, entry] of this.cache) {
      if (entry.kbId === kbId) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      this.logger.log(`检索缓存失效：kbId=${kbId}, 清理 ${cleaned} 条`);
    }
  }

  stats(): { size: number; ttlMs: number } {
    return { size: this.cache.size, ttlMs: this.ttlMs };
  }
}
