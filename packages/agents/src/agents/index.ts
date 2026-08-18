import type {
  Agent,
  AgentParams,
  AgentResult,
  SearchProvider,
  SearchResult,
  CacheProvider,
} from "../types";
import { generateAgentResultId, sanitizeText } from "../utils";

/** 抽象基类：所有 Agent 继承此基类 */
export abstract class BaseAgent implements Agent {
  readonly id: string;
  readonly name: string;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  abstract execute(params: AgentParams): Promise<AgentResult>;
}

// ---------------------------------------------------------------------------
// DbQueryAgent — 基于模板的参数化查询（无 LLM 生成 SQL）
// ---------------------------------------------------------------------------

export interface DbQueryTemplate {
  id: string;
  description: string;
  queryTemplate: string;
  params: Array<{ name: string; type: string; description?: string }>;
  requiredFields: string[];
}

export interface DbQueryExecuteFn {
  (queryId: string, params: any[], maxRows: number): Promise<any[]>;
}

export class DbQueryAgent implements Agent {
  readonly id = "db-query";
  readonly name = "DB Query";

  private readonly templates: Map<string, DbQueryTemplate> = new Map();
  private executeFn?: DbQueryExecuteFn;

  registerTemplate(template: DbQueryTemplate): void {
    this.templates.set(template.id, template);
  }

  setExecuteFn(fn: DbQueryExecuteFn): void {
    this.executeFn = fn;
  }

  async execute(params: AgentParams): Promise<AgentResult> {
    const startTime = Date.now();
    try {
      const templateId = this.resolveTemplate(params.query);
      if (!templateId) {
        return this.errorResult(startTime, "无法匹配查询模板");
      }

      if (!this.executeFn) {
        return this.errorResult(startTime, "查询执行函数未配置");
      }

      const template = this.templates.get(templateId);
      if (!template) {
        return this.errorResult(startTime, `模板不存在: ${templateId}`);
      }

      const queryParams = this.extractParams(params, template);
      const rows = await this.executeFn(templateId, queryParams, 100);
      const content = this.formatResults(rows, template);

      return {
        id: generateAgentResultId(),
        agent: this.id,
        status: "ok",
        content,
        sources: [{ uri: `db://${templateId}`, title: template.description || templateId }],
        elapsedMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        id: generateAgentResultId(),
        agent: this.id,
        status: "error",
        content: "",
        error: { message: err instanceof Error ? err.message : String(err) },
        elapsedMs: Date.now() - startTime,
      };
    }
  }

  /** 根据查询意图匹配模板 ID */
  private resolveTemplate(query: string): string | null {
    const q = query.toLowerCase();

    // 统计数量类（含"多少+量词"模式）
    if (q.includes("总数") || q.includes("总共有") || q.includes("合计") || q.includes("累计") ||
        /多少.*?(知识库|文档|切片|用户|员工|客户)/.test(q) ||
        /知识库.*?多少/.test(q) || /文档.*?多少/.test(q)) {
      // 优先判断更具体的实体，避免"知识库总共有多少文档"误匹配为 kb_stats
      if (q.includes("切片") || q.includes("chunk")) return "chunk_stats";
      if (q.includes("文档") || q.includes("doc")) return "doc_stats";
      if (q.includes("知识库") || q.includes("kb")) return "kb_stats";
      return "kb_stats";
    }

    // 列表类
    if (q.includes("列出") || q.includes("清单") || q.includes("全部") || q.includes("列表")) {
      // 优先判断更具体的实体，避免"列出知识库中的文档"误匹配为 kb_list
      if (q.includes("文档") || q.includes("doc")) return "doc_list";
      if (q.includes("切片") || q.includes("chunk")) return "doc_list";
      if (q.includes("知识库") || q.includes("kb")) return "kb_list";
      return "doc_list";
    }

    // 排行/排名类
    if (q.includes("排行") || q.includes("排名") || /top\d+/i.test(q)) {
      return "top_docs_by_chunks";
    }

    // 统计/趋势类（趋势优先于纯统计，避免"文档创建趋势"误入 doc_stats）
    if (q.includes("趋势") || q.includes("增长") || q.includes("变化")) {
      return "doc_creation_trend";
    }
    if (q.includes("统计") || q.includes("分析")) {
      if (q.includes("切片") || q.includes("chunk")) return "chunk_stats";
      if (q.includes("文档") || q.includes("doc")) return "doc_stats";
      if (q.includes("知识库") || q.includes("kb")) return "kb_stats";
      return "doc_creation_trend";
    }

    // 有哪些 — 需区分对象
    if (q.includes("有哪些")) {
      if (q.includes("切片数最多") || q.includes("切片多")) return "top_docs_by_chunks";
      if (q.includes("知识库")) return "kb_list";
      return "doc_list";
    }

    // 个人查询 — 当前无对应模板，返回 null 触发 RAG 降级
    if (
      q.includes("学号") || q.includes("身份证") || q.includes("手机号") ||
      q.includes("电话") || q.includes("邮箱") || q.includes("联系方式") ||
      q.includes("住址") || q.includes("姓名.*?信息")
    ) {
      return null;
    }

    return null;
  }

  private extractParams(params: AgentParams, template: DbQueryTemplate): any[] {
    const kbId = params.kbId;
    const result: any[] = [];

    for (const param of template.params) {
      if (param.name === "kbId" && kbId) {
        result.push(kbId);
      } else if (param.name === "limit") {
        result.push(10);
      } else if (param.name === "status") {
        result.push("active");
      } else if (param.name === "since") {
        // 默认近 30 天
        const d = new Date();
        d.setDate(d.getDate() - 30);
        result.push(d.toISOString());
      }
    }

    return result;
  }

  private formatResults(rows: any[], template: DbQueryTemplate): string {
    if (!rows || rows.length === 0) return "查询结果为空";

    // 单行单列（计数结果）
    if (rows.length === 1 && Object.keys(rows[0]).length === 1) {
      const key = Object.keys(rows[0])[0];
      return `总计 ${rows[0][key]} 条记录`;
    }

    // 多列结果 → 格式化表格
    const columns = Object.keys(rows[0]);
    const lines = columns.join(" | ");
    const dataLines = rows.map((row) =>
      columns.map((c) => String(row[c] ?? "")).join(" | "),
    );
    return `${lines}\n${dataLines.join("\n")}`;
  }

  private errorResult(elapsedStart: number, message: string): AgentResult {
    return {
      id: generateAgentResultId(),
      agent: this.id,
      status: "error",
      content: "",
      error: { message },
      elapsedMs: Date.now() - elapsedStart,
    };
  }
}

// ---------------------------------------------------------------------------
// WebSearchAgent — 可插拔 Provider + 内存缓存
// ---------------------------------------------------------------------------

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
    options: {
      cacheTtlSeconds?: number;
      providerTimeoutMs?: number;
      maxResults?: number;
    } = {},
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
      const results = await this.searchWithTimeout(params.query);
      // 去重：URL 相同的只保留第一个
      const uniqueResults = this.dedupByUrl(results);
      // 格式化内容：限制每个 snippet 长度，避免原始网页过长
      const content = uniqueResults
        .map((r) => `【${r.title}】\n${this.truncateSnippet(r.snippet, 300)}`)
        .join("\n\n");

      return {
        id: generateAgentResultId(),
        agent: this.id,
        status: "ok",
        content,
        sources: uniqueResults.map((r) => ({ uri: r.uri, title: r.title })),
        elapsedMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        id: generateAgentResultId(),
        agent: this.id,
        status: "error",
        content: "",
        error: { message: err instanceof Error ? err.message : String(err) },
        elapsedMs: Date.now() - startTime,
      };
    }
  }

  /** 按 URL 去重，保留第一个 */
  private dedupByUrl(results: SearchResult[]): SearchResult[] {
    const seen = new Set<string>();
    return results.filter((r) => {
      const key = r.uri.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** 截断 snippet，最多保留 N 个字符，不截断单词中间 */
  private truncateSnippet(snippet: string, maxLen: number): string {
    if (!snippet || snippet.length <= maxLen) return snippet;
    // 优先在句号/换行处截断
    const cutoff = snippet.slice(0, maxLen + 50);
    const lastPeriod = Math.max(
      cutoff.lastIndexOf("。"),
      cutoff.lastIndexOf("."),
      cutoff.lastIndexOf("\n"),
    );
    if (lastPeriod > maxLen * 0.6) {
      return snippet.slice(0, lastPeriod + 1);
    }
    return snippet.slice(0, maxLen) + "...";
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

// ---------------------------------------------------------------------------
// RagFlowAgent — 对现有 retrieveAndChat 的轻量包装，支持流式
// ---------------------------------------------------------------------------

export interface RagFlowStreamingFn {
  (
    params: AgentParams,
    onToken: (token: string) => void,
    onSources: (sources: any[]) => void,
    onDone: () => void,
    onError: (err: Error) => void,
  ): Promise<void>;
}

export class RagFlowAgent implements Agent {
  readonly id = "ragflow";
  readonly name = "RAGFlow";

  private streamingFn?: RagFlowStreamingFn;

  setStreamingFn(fn: RagFlowStreamingFn): void {
    this.streamingFn = fn;
  }

  async execute(params: AgentParams): Promise<AgentResult> {
    const startTime = Date.now();
    if (!this.streamingFn) {
      return {
        id: generateAgentResultId(),
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
        this.streamingFn!(
          params,
          (token) => { content += token; },
          () => {},
          resolve,
          (err) => reject(err),
        );
      });
      return {
        id: generateAgentResultId(),
        agent: this.id,
        status: "ok",
        content,
        elapsedMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        id: generateAgentResultId(),
        agent: this.id,
        status: "error",
        content,
        elapsedMs: Date.now() - startTime,
        error: { message: err?.message ?? String(err) },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// StreamAgentProxy — 将非流式 Agent 包装为支持流式输出
// ---------------------------------------------------------------------------

export class StreamAgentProxy implements Agent {
  readonly id: string;
  readonly name: string;
  private readonly agent: Agent;

  constructor(agent: Agent) {
    this.id = agent.id;
    this.name = agent.name;
    this.agent = agent;
  }

  async execute(params: AgentParams): Promise<AgentResult> {
    return this.agent.execute(params);
  }
}
