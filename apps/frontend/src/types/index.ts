export interface KbListItem {
  id: string;
  name: string;
  description: string;
  type: string;
  documentCount: number;
  chunkCount: number;
  createdAt: string;
}

export interface DocListItem {
  id: string;
  kbId: string;
  name: string;
  status: "pending" | "processing" | "success" | "failed";
  strategy: string;
  chunkCount: number;
  importMethod: string;
  updatedAt: string;
  actions: string[];
}

export interface ChunkCard {
  id: string;
  index: number;
  title: string;
  contentPreview: string;
  sourceFile: string;
  tokenCount: number;
  updatedAt: string;
}

export interface SearchResultItem {
  chunkId: string;
  content: string;
  sourceFile: string;
  score: number;
}

export interface SourceRef {
  content: string;
  sourceFile: string;
  score: number;
}

export interface SearchParams {
  topK: number;
  minScore: number;
  useReranker: boolean;
  denseWeight: number;
}

export interface ApiServiceItem {
  id: string;
  serviceName: string;
  description: string;
  keyPrefix: string;
  kbId: string;
  callCount: number;
  updatedAt: string;
}

export interface CreateApiResult {
  id: string;
  serviceName: string;
  apiKey: string;
  endpoint: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SseEvent {
  type: "sources" | "token" | "done" | "error";
  value: unknown;
}
