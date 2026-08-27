import { Injectable, Inject } from '@nestjs/common';
import { retrieve } from '@knowbase-x/rag-engine';
import type { RAGPipelineConfig, SearchParams, RetrievalResult } from '@knowbase-x/rag-engine';
import { RAG_CONFIG } from '../../config/rag-config.provider';
import { SearchDto } from './dto/search.dto';
import { UsageLogService } from '../usage/usage-log.service';
import { RetrievalCacheService } from './retrieval-cache.service';

export interface SearchResultItem {
  chunkId: string;
  content: string;
  sourceFile: string;
  score: number;
}

@Injectable()
export class RetrievalService {
  constructor(
    @Inject(RAG_CONFIG) private readonly ragConfig: RAGPipelineConfig,
    private readonly usageLog: UsageLogService,
    private readonly retrievalCache: RetrievalCacheService,
  ) {}

  async search(dto: SearchDto): Promise<SearchResultItem[]> {
    const startTime = Date.now();
    const params: SearchParams = {
      topK: dto.topK ?? 10,
      minScore: dto.minScore ?? (Number(process.env.DEFAULT_MIN_SCORE) || 0.7),
      useReranker: dto.useReranker ?? false,
      denseWeight: dto.denseWeight ?? 0.5,
    };

    // 尝试缓存命中
    const cached = await this.retrievalCache.get(
      dto.query,
      dto.kbId,
      params.topK,
      params.minScore,
      params.denseWeight,
    );
    if (cached !== null) {
      this.usageLog.record({
        type: 'retrieval',
        kbId: dto.kbId,
        duration: Date.now() - startTime,
        status: 'success',
      });
      return cached.map((r: RetrievalResult) => ({
        chunkId: `${r.sourceFile}#${r.score}`,
        content: r.content,
        sourceFile: r.sourceFile,
        score: r.score,
      }));
    }

    try {
      const results: RetrievalResult[] = await retrieve(
        dto.query,
        dto.kbId,
        params,
        this.ragConfig,
      );

      // 写入缓存
      this.retrievalCache.set(
        dto.query,
        dto.kbId,
        params.topK,
        params.minScore,
        params.denseWeight,
        results,
      );

      this.usageLog.record({
        type: 'retrieval',
        kbId: dto.kbId,
        duration: Date.now() - startTime,
        status: 'success',
      });

      return results.map((r) => ({
        chunkId: `${r.sourceFile}#${r.score}`,
        content: r.content,
        sourceFile: r.sourceFile,
        score: r.score,
      }));
    } catch (err) {
      this.usageLog.record({
        type: 'retrieval',
        kbId: dto.kbId,
        duration: Date.now() - startTime,
        status: 'error',
      });
      throw err;
    }
  }
}
