// Loaders
export { loadCSV, loadXLSX, loadPDF, loadWord, loadDocument, detectFileType, type ParseStrategy, type LoadDocumentOptions } from "./loaders/index.js";

// Splitters
export { splitDocuments, splitText } from "./splitters/recursive-splitter.js";
export { splitMarkdownDocuments } from "./splitters/markdown-splitter.js";
export { SemanticSplitter } from "./splitters/semantic-splitter.js";

// Embeddings
export { getEmbeddings, embedDocuments, embedQuery } from "./embeddings/openai-embeddings.js";

// Stores
export {
  createPGVectorStore,
  ensureCachedPGVectorStore,
  addDocumentsToPG,
  searchSimilarityWithScore,
} from "./stores/pgvector-store.js";
export {
  createMemoryStore,
  createMemoryStoreFromTexts,
} from "./stores/memory-store.js";

// Retrievers
export { similaritySearch, type VectorStoreLike } from "./retrievers/similarity-retriever.js";
export { hybridSearch } from "./retrievers/hybrid-retriever.js";

// Rerankers
export { rerank } from "./rerankers/bi-encoder-reranker.js";

// LLM
export { streamChat, buildContext, DEFAULT_SYSTEM_PROMPT } from "./llm/chat-service.js";

// Pipeline
export { ingestDocument, retrieve, retrieveAndChat } from "./pipeline.js";

// Types
export type {
  FileType,
  LoadResult,
  TextChunk,
  SearchParams,
  RetrievalResult,
  SourceRef,
  StreamCallbacks,
  EmbeddingConfig,
  LLMConfig,
  PGConfig,
  RAGPipelineConfig,
} from "./types.js";
