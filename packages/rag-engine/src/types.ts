import type { Document } from "@langchain/core/documents";

/** 文档类型 */
export type FileType = "csv" | "xlsx" | "pdf" | "word";

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
  /** 内部事件回调（agent 状态、traceId 等），不显示给用户 */
  onMeta?: (event: { type: string; value?: any; agent?: string; traceId?: string }) => void;
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
