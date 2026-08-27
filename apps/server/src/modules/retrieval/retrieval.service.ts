import { Injectable, Inject } from '@nestjs/common';
import { retrieve } from '@knowbase-x/rag-engine';
import type {
  RAGPipelineConfig,
  SearchParams,
  RetrievalResult,
  SearchDebugInfo,
} from '@knowbase-x/rag-engine';
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

export interface SearchResultWithDebug {
  results: SearchResultItem[];
  debug?: SearchDebugInfo;
}

@Injectable()
export class RetrievalService {
  constructor(
    @Inject(RAG_CONFIG) private readonly ragConfig: RAGPipelineConfig,
    private readonly usageLog: UsageLogService,
    private readonly retrievalCache: RetrievalCacheService,
  ) {}

  async search(dto: SearchDto): Promise<SearchResultWithDebug> {
    const startTime = Date.now();
    const params: SearchParams = {
      topK: dto.topK ?? 10,
      minScore: dto.minScore ?? (Number(process.env.DEFAULT_MIN_SCORE) || 0.7),
      useReranker: dto.useReranker ?? false,
      denseWeight: dto.denseWeight ?? 0.5,
      retrievalMode: dto.retrievalMode,
      fusionMethod: dto.fusionMethod,
      rrfK: dto.rrfK,
      candidateMultiplier: dto.candidateMultiplier ?? (Number(process.env.DEFAULT_CANDIDATE_MULTIPLIER) || 3),
      minDenseScore: dto.minDenseScore ?? (Number(process.env.DEFAULT_MIN_DENSE_SCORE) || null),
      debug: dto.debug ?? false,
    };

    // 尝试缓存命中（Server 层缓存，key 包含模式参数）
    const cached = await this.retrievalCache.get(
      dto.query,
      dto.kbId,
      params.topK,
      params.minScore,
      params.retrievalMode ?? 'vector',
      params.fusionMethod ?? 'rrf',
      params.rrfK ?? 60,
    );

    if (cached !== null) {
      this.usageLog.record({
        type: 'retrieval',
        kbId: dto.kbId,
        duration: Date.now() - startTime,
        status: 'success',
      });
      return {
        results: cached.map((r: RetrievalResult) => ({
          chunkId: `${r.sourceFile}#${r.score}`,
          content: r.content,
          sourceFile: r.sourceFile,
          score: r.score,
        })),
        debug: params.debug ? this._buildDebugFromCache(cached, params) : undefined,
      };
    }

    try {
      const { results, debug } = await retrieve(dto.query, dto.kbId, params, this.ragConfig);

      // 写入缓存
      this.retrievalCache.set(
        dto.query,
        dto.kbId,
        params.topK,
        params.minScore,
        params.retrievalMode ?? 'vector',
        params.fusionMethod ?? 'rrf',
        params.rrfK ?? 60,
        results,
      );

      this.usageLog.record({
        type: 'retrieval',
        kbId: dto.kbId,
        duration: Date.now() - startTime,
        status: 'success',
      });

      return {
        results: results.map((r) => ({
          chunkId: `${r.sourceFile}#${r.score}`,
          content: r.content,
          sourceFile: r.sourceFile,
          score: r.score,
        })),
        debug,
      };
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

  /** 从缓存构建 debug 信息（简化版，候选数为结果数） */
  private _buildDebugFromCache(results: RetrievalResult[], params: SearchParams): SearchDebugInfo {
    const mode = params.retrievalMode ?? 'vector';
    const fusionMethod = params.fusionMethod ?? 'rrf';

    const items = results.map((r, idx) => ({
      chunkId: (r.metadata?.chunkId as string) ?? r.sourceFile,
      rankDense: mode === 'vector' ? idx + 1 : null,
      rankSparse: mode === 'keyword' ? idx + 1 : null,
      scoreDense: mode === 'vector' ? r.score : null,
      scoreSparse: mode === 'keyword' ? r.score : null,
      scoreFused: r.score,
      sourceFile: r.sourceFile,
    }));

    return {
      mode,
      fusion: mode === 'hybrid' ? fusionMethod : null,
      denseCandidates: mode === 'vector' ? results.length : 0,
      sparseCandidates: mode === 'keyword' ? results.length : 0,
      fusedTopK: results.length,
      items,
    };
  }
}
