import type { Document } from '@langchain/core/documents';

/** 文档类型 */
export type FileType = 'csv' | 'xlsx' | 'pdf' | 'word';

/** 文档加载结果 */
export interface LoadResult {
  documents: Document[];
  fileType: FileType;
  totalChars: number;
}

/** 切片后的文本块 */
export interface TextChunk {
  content: string;
  metadata: Record<string, unknown>;
  tokenCount: number;
}

/** 检索参数 */
export interface SearchParams {
  topK: number;
  minScore: number;
  useReranker: boolean;
  denseWeight: number;
  /** 检索模式：vector | keyword | hybrid，默认 vector */
  retrievalMode?: 'vector' | 'keyword' | 'hybrid';
  /** 融合方式，默认 rrf */
  fusionMethod?: 'rrf' | 'linear';
  /** RRF 公式中的 K 值，默认 60 */
  rrfK?: number;
  /** 每路候选数 = topK × multiplier，默认 3 */
  candidateMultiplier?: number;
  /** 仅 hybrid 模式生效，过滤 dense 候选，默认 null（不施加） */
  minDenseScore?: number | null;
  /** 是否开启调试模式，返回详细的检索信息 */
  debug?: boolean;
  /** LLM 生成温度（0~2），缺省用 env.llm.temperature；仅生成答案的链路生效 */
  temperature?: number;
}

/** 调试信息结构 */
export interface SearchDebugInfo {
  mode: string;
  fusion: 'rrf' | 'linear' | null;
  denseCandidates: number;
  sparseCandidates: number;
  fusedTopK: number;
  items: {
    chunkId: string;
    rankDense: number | null;
    rankSparse: number | null;
    scoreDense: number | null;
    scoreSparse: number | null;
    scoreFused: number;
    sourceFile: string;
  }[];
}

/** 检索结果项 */
export interface RetrievalResult {
  content: string;
  score: number;
  sourceFile: string;
  metadata: Record<string, unknown>;
}

/** 引用来源（返回给前端） */
export interface SourceRef {
  content: string;
  sourceFile: string;
  score: number;
}

/** LLM 流式回调 */
export interface StreamCallbacks {
  onSources: (sources: SourceRef[]) => void;
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (error: Error) => void;
  /** 流式完成时，推送完整答案文本（由框架聚合 tokens 后调用，供 faithfulness 等后处理钩子使用） */
  onAnswer?: (answer: string) => void;
}

/** Embedding 配置 */
export interface EmbeddingConfig {
  apiKey: string;
  model: string;
  baseURL: string;
  dimensions?: number;
}

/** LLM 配置 */
export interface LLMConfig {
  apiKey: string;
  model: string;
  baseURL: string;
  temperature?: number;
}

/** 数据库连接配置 */
export interface PGConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** RAG Pipeline 全局配置 */
export interface RAGPipelineConfig {
  pg: PGConfig;
  llm: LLMConfig;
  embedding: EmbeddingConfig;
  chunkSize: number;
  chunkOverlap: number;
  embeddingDimensions?: number;
  pgTableName?: string;
}

/**
 * 摄入阶段进度回调
 *
 * Worker 在解析、切片、embedding、落库各阶段完成时调用，
 * 用于更新 DB 中的 documents.progress 和 documents.processing_stage。
 */
export interface IngestProgressCallback {
  /** 0-100 的整数进度 */
  percent: number;
  /** 当前阶段名 */
  stage: string;
}
