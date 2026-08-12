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
}

/** 路由规则配置 */
export interface RouterRules {
  rules: RouterRule[];
  settings: {
    maxMatchedRules: number;
    defaultAgentTimeoutMs: number;
    allowParallel: boolean;
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
export type ComposeStrategy = "concat" | "llm-summarize" | "rerank-and-merge";
