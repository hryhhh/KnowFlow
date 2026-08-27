// Loaders
export {
  loadCSV,
  loadXLSX,
  loadPDF,
  loadWord,
  loadDocument,
  detectFileType,
  type ParseStrategy,
  type LoadDocumentOptions,
} from './loaders/index.js';

// Splitters
export { splitDocuments, splitText } from './splitters/recursive-splitter.js';
export { splitMarkdownDocuments } from './splitters/markdown-splitter.js';
export { SemanticSplitter } from './splitters/semantic-splitter.js';

// Embeddings
export { getEmbeddings, embedDocuments, embedQuery } from './embeddings/openai-embeddings.js';

// Stores
export {
  createPGVectorStore,
  ensureCachedPGVectorStore,
  addDocumentsToPG,
  searchSimilarityWithScore,
  deleteByDocId,
} from './stores/pgvector-store.js';
export {
  writeSparseIndex,
  deleteSparseByDocId,
  deleteSparseByKbId,
} from './stores/sparse-store.js';
export { createMemoryStore, createMemoryStoreFromTexts } from './stores/memory-store.js';

// Cache
export {
  getCachedResults,
  setCachedResults,
  invalidateByKbId,
  getCacheStats,
} from './cache/search-cache.js';

// Tokenizer
export { tokenize, tokensToTsvString, tokensToTsQuery } from './tokenizer.js';

// Retrievers
export { similaritySearch, type VectorStoreLike } from './retrievers/similarity-retriever.js';
export {
  hybridSearch,
  type HybridSearchParams,
} from './retrievers/hybrid-retriever.js';
export { sparseSearch, type SparseSearchParams } from './retrievers/sparse-retriever.js';

// Fusion
export { rrfFuse, linearFuse } from './fusion/index.js';

// Rerankers
export { rerank } from './rerankers/bi-encoder-reranker.js';

// LLM
export { streamChat, buildContext, DEFAULT_SYSTEM_PROMPT } from './llm/chat-service.js';

// Pipeline
export { ingestDocument, retrieve, retrieveAndChat, getChunkIds } from './pipeline.js';

// Types
export type {
  FileType,
  LoadResult,
  TextChunk,
  SearchParams,
  RetrievalResult,
  SourceRef,
  StreamCallbacks,
  SearchDebugInfo,
  EmbeddingConfig,
  LLMConfig,
  PGConfig,
  RAGPipelineConfig,
  IngestProgressCallback,
} from './types.js';
