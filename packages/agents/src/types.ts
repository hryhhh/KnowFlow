/**
 * Agent 编排核心类型
 */

/** 路由规则 */
export interface RouterRule {
  id: string;
  pattern: string;
  intent: string;
  targetAgent: string;
  priority: number;
  minScore: number;
  enabled: boolean;
  /** 示例查询（为后续语义匹配预留，当前版本不做匹配） */
  examples?: string[];
}

/** 路由规则配置 */
export interface RouterRules {
  rules: RouterRule[];
  settings: {
    maxMatchedRules: number;
    defaultAgentTimeoutMs: number;
    allowParallel: boolean;
    /** 始终加入候选列表的 Agent（如 ["ragflow"]） */
    alwaysIncludeAgents?: string[];
    /** 置信度仲裁阈值：最高命中规则 priority ≤ 此值时触发 LLM 仲裁 */
    routerConfidenceThreshold?: number;
    /** 合成策略 */
    composeStrategy?: ComposeStrategy;
  };
}

/** Agent 执行结果 */
export interface AgentResult {
  id: string;
  agent: string;
  status: "ok" | "partial" | "error" | "timeout";
  score?: number;
  content: string;
  sources?: Array<{ uri?: string; title?: string; meta?: Record<string, any> }>;
  tokens?: number;
  elapsedMs?: number;
  error?: { message: string; code?: string };
}

/** 路由结果 */
export interface RouteResult {
  traceId: string;
  matchedRules: Array<{
    rule: RouterRule;
    score: number;
  }>;
  agentResults: AgentResult[];
  content: string;
  sources?: Array<{ uri?: string; title?: string; meta?: Record<string, any> }>;
  /** 可观测性元数据 */
  metadata: RouteMetadata;
}

/** Agent 接口 */
export interface Agent {
  id: string;
  name: string;
  execute(params: AgentParams): Promise<AgentResult>;
}

/** Agent 执行参数 */
export interface AgentParams {
  query: string;
  kbId: string;
  traceId: string;
  [key: string]: any;
}

/** 支持流式的 Agent 接口（如 RAGFlow） */
export interface StreamAgent extends Agent {
  /** 流式执行：实时推送 token，不返回完整 content */
  stream(
    params: AgentParams,
    onToken: (token: string) => void,
    onSources: (sources: any[]) => void,
    onDone: () => void,
    onError: (err: Error) => void,
  ): Promise<void>;
}

/** Web Search Provider 接口 */
export interface SearchProvider {
  search(query: string, options?: Record<string, any>): Promise<SearchResult[]>;
}

/** Web Search 结果 */
export interface SearchResult {
  title: string;
  uri: string;
  snippet: string;
  source: string;
  publishedAt?: string;
}

/** 缓存 Provider 接口 */
export interface CacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

/** 合成策略 */
export type ComposeStrategy = "concat" | "llm-summarize" | "rerank-and-merge" | "rag-priority";

/** 路由可观测性元数据 */
export interface RouteMetadata {
  /** 是否触发了 LLM 仲裁 */
  triggeredLlmArbitration: boolean;
  /** ragflow 被加入候选的原因 */
  ragIncludedBy: "strict_rule" | "soft_rule" | "always_include" | "llm" | "none";
  /** 合成阶段是否采用了 rag-priority 策略 */
  composeUsedRagPriority: boolean;
  /** 仲裁时 LLM 返回的目标 Agent */
  llmArbitrationAgent?: string;
}
