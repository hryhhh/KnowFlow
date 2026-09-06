import type { SearchParams } from '@knowbase-x/rag-engine';
import { RETRIEVAL_DEFAULTS } from '../config/defaults';

/**
 * 归一化检索参数，应用默认值
 * 供 AgentController 和 AgentChatService 共用，避免重复定义
 */
export function normalizeSearchParams(params: Partial<SearchParams> | undefined): SearchParams {
  return {
    topK: params?.topK ?? 10,
    minScore: params?.minScore ?? RETRIEVAL_DEFAULTS.minScore,
    useReranker: params?.useReranker ?? false,
    denseWeight: params?.denseWeight ?? 0.5,
    retrievalMode: params?.retrievalMode,
    fusionMethod: params?.fusionMethod,
    rrfK: params?.rrfK,
    candidateMultiplier: params?.candidateMultiplier ?? RETRIEVAL_DEFAULTS.candidateMultiplier,
    minDenseScore: params?.minDenseScore ?? RETRIEVAL_DEFAULTS.minDenseScore,
  };
}
