import type { Agent, AgentParams, AgentResult, SearchProvider, SearchResult, CacheProvider } from "../types";
import { sanitizeText } from "../utils";

/**
 * Base Agent 接口实现
 */
export abstract class BaseAgent implements Agent {
  readonly id: string;
  readonly name: string;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  abstract execute(params: AgentParams): Promise<AgentResult>;
}

/**
 * StreamAgent — 支持流式输出的 Agent（如 RAGFlow）
 */
export interface StreamAgent extends Agent {
  id: string;
  name: string;
  /** 流式执行：实时推送 token */
  stream(params: AgentParams, onToken: (token: string) => void, onDone: () => void, onError: (err: Error) => void): Promise<void>;
}

/**
 * DB Query Agent — 基于模板的参数化查询
 */
export class DbQueryAgent implements Agent {
  readonly id = "db-query";
  readonly name = "DB Query";

  private readonly queryTemplate: Map<string, {
    queryTemplate: string;
    params: Array<{ name: string; type: string }>;
  }> = new Map();
  private executeFn?: (queryId: string, params: any[], maxRows: number) => Promise<any[]>;

  registerTemplate(template: {
    id: string;
    queryTemplate: string;
    params: Array<{ name: string; type: string }>;
  }): void {
    this.queryTemplate.set(template.id, {
      queryTemplate: template.queryTemplate,
      params: template.params,
    });
  }

  /**
   * 设置查询执行函数（由 NestJS 层注入）
   */
  setExecuteFn(fn: (queryId: string, params: any[], maxRows: number) => Promise<any[]>): void {
    this.executeFn = fn;
  }

  async execute(params: AgentParams): Promise<AgentResult> {
    const startTime = Date.now();
    try {
      const templateId = this.resolveTemplate(params.query);
      if (!templateId) {
        return {
          id: params.traceId,
          agent: this.id,
          status: "error",
          content: "",
          error: { message: "无法匹配查询模板" },
          elapsedMs: Date.now() - startTime,
        };
      }

      // 执行查询
      if (!this.executeFn) {
        return {
          id: params.traceId,
          agent: this.id,
          status: "error",
          content: "",
          error: { message: "查询执行函数未配置" },
          elapsedMs: Date.now() - startTime,
        };
      }

      // 根据模板提取参数
      const template = this.queryTemplate.get(templateId);
      const queryParams = this.extractParams(params, template);

      const results = await this.executeFn(templateId, queryParams, 100);

      // 格式化结果
      const content = this.formatResults(results);
      return {
        id: params.traceId,
        agent: this.id,
        status: "ok",
        content,
        sources: [{ uri: `db://${templateId}`, title: templateId }],
        elapsedMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        id: params.traceId,
        agent: this.id,
        status: "error",
        content: "",
        error: { message: err instanceof Error ? err.message : String(err) },
        elapsedMs: Date.now() - startTime,
      };
    }
  }

  private resolveTemplate(query: string): string | null {
    // 根据查询意图匹配模板
    const q = query.toLowerCase();
    if (q.includes("知识库") || q.includes("kb")) return "kb_stats";
    if (q.includes("文档") || q.includes("doc")) return "doc_stats";
    if (q.includes("切片") || q.includes("chunk")) return "chunk_stats";
    if (q.includes("列表") || q.includes("列出") || q.includes("有哪些")) return "doc_list";
    if (q.includes("总数") || q.includes("总共有") || q.includes("合计") || q.includes("累计")) return "kb_stats";
    // "多少" 出现在特定上下文中才匹配统计
    if ((q.includes("多少") && (q.includes("知识库") || q.includes("文档") || q.includes("切片"))) ||
        q.includes("多少") && q.match(/数量|个|条|人/)) return "kb_stats";
    // 学号、身份证、手机号等个人查询 → 无匹配，返回 null 触发 RAG 降级
    if (q.includes("学号") || q.includes("身份证") || q.includes("手机号") ||
        q.includes("电话") || q.includes("邮箱") || q.includes("住址")) {
      return null;
    }
    return null; // 无匹配模板时返回 null，触发 RAG 降级
  }

  private extractParams(params: AgentParams, template: any): any[] {
    if (!template) return [];

    const query = params.query.toLowerCase();
    const kbId = params.kbId;
    const result: any[] = [];

    // 根据查询类型填充参数
    const templateParams = template.params || [];
    for (const param of templateParams) {
      if (param.name === "kbId" && kbId) {
        result.push(kbId);
      } else if (param.name === "limit") {
        result.push(10); // 默认限制 10 条
      } else if (param.name === "status") {
        result.push("active"); // 默认 active 状态
      }
    }

    return result;
  }

  private formatResults(results: any[]): string {
    if (!results || results.length === 0) {
      return "查询结果为空";
    }

    // 如果是单个计数结果
    if (results.length === 1 && Object.keys(results[0]).length === 1) {
      const key = Object.keys(results[0])[0];
      return `总计 ${results[0][key]} 条记录`;
    }

    // 多行结果，格式化为表格
    const columns = Object.keys(results[0]);
    let lines = columns.join(" | ");
    for (const row of results) {
      lines += "\n" + columns.map((c) => String(row[c] ?? "")).join(" | ");
    }
    return lines;
  }
}

/**
 * Web Search Agent — 可插拔 Provider + 缓存
 */
export class WebSearchAgent implements Agent {
  readonly id = "web-search";
  readonly name = "Web Search";

  private readonly provider: SearchProvider;
  private readonly cache: CacheProvider;
  private readonly cacheTtl: number;
  private readonly providerTimeout: number;
  private readonly maxResults: number;

  constructor(
    provider: SearchProvider,
    cache: CacheProvider,
    options: { cacheTtlSeconds?: number; providerTimeoutMs?: number; maxResults?: number } = {},
  ) {
    this.provider = provider;
    this.cache = cache;
    this.cacheTtl = options.cacheTtlSeconds ?? 3600;
    this.providerTimeout = options.providerTimeoutMs ?? 5000;
    this.maxResults = options.maxResults ?? 5;
  }

  async execute(params: AgentParams): Promise<AgentResult> {
    const startTime = Date.now();
    try {
      const results: SearchResult[] = await this.searchWithTimeout(params.query);
      const content = results.map((r) => `【${r.title}】${r.uri}\n${r.snippet}`).join("\n\n");

      return {
        id: params.traceId,
        agent: this.id,
        status: "ok",
        content,
        sources: results.map((r) => ({ uri: r.uri, title: r.title })),
        elapsedMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        id: params.traceId,
        agent: this.id,
        status: "error",
        content: "",
        error: { message: err instanceof Error ? err.message : String(err) },
        elapsedMs: Date.now() - startTime,
      };
    }
  }

  private async searchWithTimeout(query: string): Promise<SearchResult[]> {
    const promise = this.provider.search(query);
    const timeout = new Promise<SearchResult[]>((resolve) =>
      setTimeout(() => resolve([]), this.providerTimeout),
    );
    const results = await Promise.race([promise, timeout]);
    return results
      .map((r) => ({ ...r, snippet: sanitizeText(r.snippet) }))
      .slice(0, this.maxResults);
  }
}

/**
 * RAGFlow Agent — 对现有 retrieveAndChat 的轻量包装，支持流式
 */
export class RagFlowAgent implements StreamAgent {
  readonly id = "ragflow";
  readonly name = "RAGFlow";

  private streamingFn?: (
    params: AgentParams,
    onToken: (t: string) => void,
    onSources: (sources: any[]) => void,
    onDone: () => void,
    onError: (err: Error) => void,
  ) => Promise<void>;

  setStreamingFn(fn: (
    params: AgentParams,
    onToken: (t: string) => void,
    onSources: (sources: any[]) => void,
    onDone: () => void,
    onError: (err: Error) => void,
  ) => Promise<void>): void {
    this.streamingFn = fn;
  }

  /** 流式执行 */
  async stream(
    params: AgentParams,
    onToken: (token: string) => void,
    onDone: () => void,
    onError: (err: Error) => void,
  ): Promise<void> {
    if (!this.streamingFn) {
      onError(new Error("RAGFlow streaming function not configured"));
      return;
    }

    try {
      await this.streamingFn(params, onToken, () => {}, onDone, onError);
    } catch (err: any) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** 非流式执行（返回完整结果） */
  async execute(params: AgentParams): Promise<AgentResult> {
    const startTime = Date.now();
    if (!this.streamingFn) {
      return {
        id: params.traceId,
        agent: this.id,
        status: "error",
        content: "",
        error: { message: "RAGFlow streaming function not configured" },
        elapsedMs: Date.now() - startTime,
      };
    }

    let content = "";
    try {
      await new Promise<void>((resolve, reject) => {
        this.streamingFn!(params, (token) => { content += token; }, () => {}, resolve, reject);
      });
      return {
        id: params.traceId,
        agent: this.id,
        status: "ok",
        content,
        elapsedMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        id: params.traceId,
        agent: this.id,
        status: "error",
        content,
        elapsedMs: Date.now() - startTime,
        error: { message: err instanceof Error ? err.message : String(err) },
      };
    }
  }
}

/**
 * 代理 Agent — 将非流式 Agent 包装为流式
 */
export class StreamAgentProxy implements StreamAgent {
  readonly id: string;
  readonly name: string;
  private agent: Agent;

  constructor(agent: Agent) {
    this.id = agent.id;
    this.name = agent.name;
    this.agent = agent;
  }

  async stream(
    params: AgentParams,
    onToken: (token: string) => void,
    onDone: () => void,
    onError: (err: Error) => void,
  ): Promise<void> {
    try {
      const result = await this.agent.execute(params);
      if (result.status === "ok" && result.content) {
        // 分块推送内容（模拟流式）
        const chunkSize = 50;
        for (let i = 0; i < result.content.length; i += chunkSize) {
          onToken(result.content.slice(i, i + chunkSize));
        }
        onDone();
      } else {
        onError(new Error(result.error?.message ?? "Agent execution failed"));
      }
    } catch (err: any) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async execute(params: AgentParams): Promise<AgentResult> {
    return this.agent.execute(params);
  }
}
