export interface KbListItem {
  id: string;
  name: string;
  description: string;
  type: string;
  documentCount: number;
  chunkCount: number;
  createdAt: string;
  isDefault?: boolean;
}

export interface DocListItem {
  id: string;
  kbId: string;
  name: string;
  status: 'pending' | 'processing' | 'success' | 'failed';
  strategy: string;
  chunkCount: number;
  importMethod: string;
  progress: number;
  processingStage?: string;
  errorMessage?: string;
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

export interface DebugSearchItem {
  chunkId: string;
  rankDense: number | null;
  rankSparse: number | null;
  scoreDense: number | null;
  scoreSparse: number | null;
  scoreFused: number;
  sourceFile: string;
}

export interface SearchDebugInfo {
  mode: string;
  fusion: 'rrf' | 'linear' | null;
  denseCandidates: number;
  sparseCandidates: number;
  fusedTopK: number;
  items: DebugSearchItem[];
}

export interface SearchParams {
  topK: number;
  minScore: number;
  useReranker: boolean;
  denseWeight: number;
  retrievalMode?: 'vector' | 'keyword' | 'hybrid';
  fusionMethod?: 'rrf' | 'linear';
  rrfK?: number;
  candidateMultiplier?: number;
  minDenseScore?: number | null;
  debug?: boolean;
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
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceRef[];
  createdAt?: string;
}

export interface SessionListItem {
  id: string;
  kbId: string;
  title: string;
  messageCount: number;
  createdAt: string;
}

export interface SseEvent {
  type: 'sources' | 'token' | 'done' | 'error';
  value: unknown;
}

export interface DashboardSummary {
  knowledgeBaseCount: number;
  documentCount: number;
  chunkCount: number;
  processingCount: number;
  storageUsage: string;
  activeKbCount: number;
  errorCount: number;
}

export interface TrendPoint {
  date: string;
  apiCalls: number;
  retrievalCalls: number;
  chatCalls: number;
}

export interface ActivityItem {
  id: string;
  title: string;
  type: string;
  agent: string;
  duration: number;
  status: string;
  createdAt: string;
}

/** Agent 执行事件（AgentRuntime 路径产生的 SSE 事件） */
export interface AgentActivityEvent {
  type: 'tool_call' | 'tool_result' | 'reasoning_summary' | 'agent_start' | 'agent_completed';
  timestamp: number;
  toolName?: string;
  args?: Record<string, any>;
  result?: string;
  summary?: string;
  durationMs?: number;
  isError?: boolean;
  status?: 'completed' | 'failed' | 'truncated';
  tokensUsed?: { prompt: number; completion: number; total: number };
  data?: Record<string, any>;
}

/** Trace 步骤 */
export interface AgentTraceStep {
  type: 'llm_call' | 'tool_call' | 'final_answer' | 'memory_load';
  timestamp: number;
  data: Record<string, any>;
}

/** Trace 聚合信息 */
export interface AgentTraceSummary {
  totalDurationMs: number;
  llmCalls: number;
  toolCalls: number;
  tokensUsed: { prompt: number; completion: number; total: number };
}

/** Trace 记录 */
export interface AgentTrace {
  id: string;
  sessionId: string;
  kbId: string;
  query: string;
  traceId?: string;
  status: 'running' | 'completed' | 'failed' | 'truncated';
  startedAt: string;
  completedAt: string | null;
  steps: AgentTraceStep[];
  summary: AgentTraceSummary;
  tokensUsed: { prompt: number; completion: number; total: number };
  errorMsg: string | null;
}
