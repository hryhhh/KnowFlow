import type { SearchParams } from '@knowbase-x/rag-engine';
import { env } from '../config/env';

/**
 * 归一化检索参数，应用默认值
 * 供 AgentController 和 AgentChatService 共用，避免重复定义
 */
export function normalizeSearchParams(params: Partial<SearchParams> | undefined): SearchParams {
  return {
    topK: params?.topK ?? 10,
    minScore: params?.minScore ?? env.rag.minScore,
    useReranker: params?.useReranker ?? false,
    denseWeight: params?.denseWeight ?? 0.5,
    retrievalMode: params?.retrievalMode,
    fusionMethod: params?.fusionMethod,
    rrfK: params?.rrfK,
    candidateMultiplier: params?.candidateMultiplier ?? env.rag.candidateMultiplier,
    minDenseScore: params?.minDenseScore ?? env.rag.minDenseScore,
  };
}
