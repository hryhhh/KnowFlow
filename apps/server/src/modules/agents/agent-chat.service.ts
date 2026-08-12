import { Injectable, Logger, Inject } from "@nestjs/common";
import { RAG_CONFIG } from "../../config/rag-config.provider";
import type { RAGPipelineConfig, SearchParams, SourceRef, StreamCallbacks } from "@knowbase-x/rag-engine";
import { retrieveAndChat } from "@knowbase-x/rag-engine";
import { DbQueryAgent, WebSearchAgent, RagFlowAgent, StreamAgentProxy } from "@knowbase-x/agents";
import type { Agent, AgentResult } from "@knowbase-x/agents";
import { UsageLogService } from "../usage/usage-log.service";
import { DbQueryService } from "./db-query.service";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { createSearchProvider } from "./providers/index";

type AgentOutcome = { agentId: string; result: AgentResult };

/**
 * AgentChatService — 多 Agent 编排入口层
 * 流程：RAGFlow → (无有效结果) → DB Query + Web Search 并行
 */
@Injectable()
export class AgentChatService {
  private readonly logger = new Logger(AgentChatService.name);
  private readonly agents: Map<string, Agent> = new Map();
  private agentsEnabled: boolean;
  private lastQuery = "";
  private lastKbId = "";
  private lastParams: SearchParams | undefined;

  constructor(
    @Inject(RAG_CONFIG) private readonly ragConfig: RAGPipelineConfig,
    private readonly usageLog: UsageLogService,
    private readonly dbQueryService: DbQueryService,
  ) {
    this.agentsEnabled = process.env.AGENTS_ENABLED === "true";

    // 注册 Agent 实例
    this.registerAgents();

    this.logger.log(`Agent 编排系统初始化完成 (enabled=${this.agentsEnabled}, agents: ${Array.from(this.agents.keys()).join(", ")})`);
  }

  private registerAgents(): void {
    // 1. DB Query Agent
    const dbAgent = new DbQueryAgent();
    // 加载查询模板
    this.loadDbTemplates(dbAgent);
    dbAgent.setExecuteFn(async (queryId, params, maxRows) => {
      if (!this.dbQueryService) throw new Error("数据库未连接");
      return this.dbQueryService.execute(queryId, params, maxRows);
    });
    this.agents.set(dbAgent.id, dbAgent);

    // 2. Web Search Agent
    const webSearchProvider = this.createWebSearchProvider();
    const webSearchAgent = new WebSearchAgent(
      webSearchProvider,
      {
        get: async () => null,
        set: async () => {},
      },
      {
        cacheTtlSeconds: parseInt(process.env.WEB_SEARCH_CACHE_TTL_SECONDS ?? "3600"),
        providerTimeoutMs: parseInt(process.env.WEB_SEARCH_PROVIDER_TIMEOUT_MS ?? "5000"),
        maxResults: 5,
      },
    );
    this.agents.set(webSearchAgent.id, webSearchAgent);

    // 3. RAGFlow Agent（支持流式）
    const ragFlowAgent = new RagFlowAgent();
    ragFlowAgent.setStreamingFn(async (params, onToken, _onSources, onDone, onError) => {
      const ragCallbacks: StreamCallbacks = {
        onSources: () => {},
        onToken,
        onDone,
        onError: (err) => onError(err),
      };
      await retrieveAndChat(params.query, params.kbId, {
        topK: params.topK ?? 10,
        minScore: params.minScore ?? 0.70,
        useReranker: params.useReranker ?? false,
        denseWeight: params.denseWeight ?? 0.5,
      }, this.ragConfig, ragCallbacks);
    });
    this.agents.set(ragFlowAgent.id, ragFlowAgent);

    // 4. 将所有非流式 Agent 包装为流式（统一处理）
    for (const [id, agent] of this.agents) {
      if (!(agent as any).stream) {
        this.agents.set(id, new StreamAgentProxy(agent));
      }
    }
  }

  private loadDbTemplates(agent: DbQueryAgent): void {
    const templatePath = process.env.DB_QUERIES_TEMPLATE_PATH ?? path.resolve(process.cwd(), "config", "db-queries.yml");
    try {
      const content = fs.readFileSync(templatePath, "utf-8");
      const config = yaml.load(content) as { templates: any[] };
      for (const template of config.templates) {
        agent.registerTemplate(template);
      }
      this.logger.log(`已为 DB Query Agent 加载 ${config.templates.length} 个查询模板`);
    } catch (err: any) {
      this.logger.warn(`加载 DB 查询模板失败: ${err.message}`);
    }
  }

  /**
   * 创建 Web Search Provider
   */
  private createWebSearchProvider(): import("@knowbase-x/agents").SearchProvider {
    const provider = process.env.WEB_SEARCH_PROVIDER ?? "tavily";
    const apiKey = process.env.WEB_SEARCH_API_KEY ?? "";

    if (!apiKey) {
      this.logger.warn(`Web Search Provider "${provider}" 未配置 API Key，将返回空结果`);
      // 返回占位 Provider
      return {
        search: async () => [],
      };
    }

    try {
      return createSearchProvider(provider, apiKey);
    } catch (err: any) {
      this.logger.error(`创建 Web Search Provider 失败: ${err.message}`);
      throw err;
    }
  }

  /**
   * 流式对话入口
   * 根据 AGENTS_ENABLED 路由到 Agent 编排或传统 RAG
   */
  async stream(
    query: string,
    kbId: string,
    params: SearchParams | undefined,
    callbacks: StreamCallbacks,
    traceId: string,
    apiKeyId: string | null,
  ): Promise<void> {
    const resolvedParams = this.normalizeParams(params);
    this.lastQuery = query;
    this.lastKbId = kbId;
    this.lastParams = resolvedParams;

    if (!this.agentsEnabled) {
      // 降级到传统 RAG
      this.streamViaRag(query, kbId, resolvedParams, callbacks);
      return;
    }

    await this.streamViaAgents(query, kbId, resolvedParams, callbacks, traceId, apiKeyId);
  }

  private async streamViaAgents(
    query: string,
    kbId: string,
    params: SearchParams,
    callbacks: StreamCallbacks,
    traceId: string,
    apiKeyId: string | null,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // 固定流程：RAGFlow → (无结果) → DB Query + Web Search 并行
      await this.executeAgentPipeline(query, kbId, params, callbacks, traceId);

      const duration = Date.now() - startTime;
      this.usageLog.record({
        type: "agent",
        kbId,
        apiKeyId,
        traceId,
        duration,
        status: "success",
      });
    } catch (err: unknown) {
      const duration = Date.now() - startTime;
      this.usageLog.record({
        type: "agent",
        kbId,
        apiKeyId,
        traceId,
        duration,
        status: "error",
      });
      const errorMessage = err instanceof Error ? err.message : String(err);
      callbacks.onError(new Error(errorMessage));
    }
  }

  /**
   * 固定 Agent 执行流程：RAGFlow → (无有效结果) → DB Query → (无结果) → Web Search
   */
  private async executeAgentPipeline(
    query: string,
    kbId: string,
    params: SearchParams,
    callbacks: StreamCallbacks,
    traceId: string,
  ): Promise<void> {
    // 1. 先执行 RAGFlow（缓存内容用于判断）
    const ragflowResult = await this.runSingleAgent(
      "ragflow", query, kbId, params, callbacks, traceId,
      { bufferContent: true }
    );

    // 判断 RAGFlow 是否有有效结果
    const ragflowContent = ragflowResult.result.content;
    const isNegativeAnswer = ragflowContent.includes("抱歉") ||
                              ragflowContent.includes("暂无") ||
                              ragflowContent.includes("无法为您") ||
                              ragflowContent.includes("没有相关信息") ||
                              ragflowContent.includes("没有关于") ||
                              ragflowContent.includes("无法回答") ||
                              ragflowContent.includes("无法提供");

    if (ragflowResult.result.status === "ok" && ragflowContent.trim().length > 0 && !isNegativeAnswer) {
      this.logger.debug("RAGFlow 有有效结果，直接使用");
      // 推送缓存的内容
      const chunks = this.chunkContent(ragflowContent, 20);
      for (const chunk of chunks) {
        callbacks.onToken(chunk);
      }
      callbacks.onDone();
      return;
    }

    this.logger.debug("RAGFlow 无有效结果，尝试 DB Query");

    // 2. RAGFlow 无有效结果，执行 DB Query
    const dbResult = await this.runSingleAgent("db-query", query, kbId, params, callbacks, traceId);

    // DB Query 有结果，直接使用
    if (dbResult.result.status === "ok" && dbResult.result.content.trim().length > 0) {
      this.logger.debug("DB Query 有结果，直接使用");
      // DB Query 已通过 callbacks 推送，直接 done
      callbacks.onDone();
      return;
    }

    this.logger.debug("DB Query 无结果，尝试 Web Search");

    // 3. DB Query 无结果，执行 Web Search
    const webResult = await this.runSingleAgent("web-search", query, kbId, params, callbacks, traceId);

    // Web Search 有结果，直接使用（已通过 callbacks 推送）
    this.composeAndEmit([webResult], callbacks);
  }

  /**
   * 执行 Agent（RAGFlow 优先，无结果才用其他 Agent）
   */
  private async executeAgentsWithFallback(
    targetAgents: string[],
    query: string,
    kbId: string,
    params: SearchParams,
    callbacks: StreamCallbacks,
    traceId: string,
  ): Promise<void> {
    // 分离 RAGFlow 和其他 Agent
    const ragflowAgent = targetAgents.includes("ragflow") ? "ragflow" : null;
    const otherAgents = targetAgents.filter((a) => a !== "ragflow");

    // 1. 先串行执行 RAGFlow（优先，缓存内容用于判断）
    if (ragflowAgent) {
      const ragflowResult = await this.runSingleAgent(
        ragflowAgent, query, kbId, params, callbacks, traceId,
        { bufferContent: true }
      );

      // RAGFlow 有有效结果（不是"抱歉/暂无"），推送缓存内容
      const ragflowContent = ragflowResult.result.content;
      const isNegativeAnswer = ragflowContent.includes("抱歉") ||
                                ragflowContent.includes("暂无") ||
                                ragflowContent.includes("无法为您") ||
                                ragflowContent.includes("没有相关信息") ||
                                ragflowContent.includes("没有关于") ||
                                ragflowContent.includes("无法回答") ||
                                ragflowContent.includes("无法提供");

      if (ragflowResult.result.status === "ok" && ragflowContent.trim().length > 0 && !isNegativeAnswer) {
        this.logger.debug("RAGFlow 有有效结果，直接使用");
        // 推送缓存的内容
        const chunks = this.chunkContent(ragflowContent, 20);
        for (const chunk of chunks) {
          callbacks.onToken(chunk);
        }
        callbacks.onDone();
        return;
      }
      this.logger.debug("RAGFlow 无有效结果，尝试其他 Agent");
    }

    // 2. RAGFlow 无有效结果，并行执行其他 Agent
    if (otherAgents.length > 0) {
      const otherResults = await Promise.all(
        otherAgents.map((agentId) => this.runSingleAgent(agentId, query, kbId, params, callbacks, traceId))
      );
      this.composeAndEmit(otherResults, callbacks);
    } else {
      callbacks.onDone();
    }
  }

  /**
   * 执行单个 Agent
   */
  private async runSingleAgent(
    agentId: string,
    query: string,
    kbId: string,
    params: SearchParams,
    callbacks: StreamCallbacks,
    traceId: string,
    options?: { bufferContent?: boolean },
  ): Promise<AgentOutcome> {
    const emitMeta = (type: string, value?: any, agent?: string) => {
      callbacks.onMeta?.({ type, value, agent });
    };

    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.warn(`Agent not found: ${agentId}`);
      return {
        agentId,
        result: {
          id: `${agentId}-error`,
          agent: agentId,
          status: "error",
          content: `Agent not found: ${agentId}`,
          error: { message: `Agent not found: ${agentId}` },
          elapsedMs: 0,
        },
      };
    }

    const startTime = Date.now();
    try {
      emitMeta("agent_start", { traceId }, agentId);

      const streamAgent = agent as any;
      if (streamAgent.stream) {
        // 流式 Agent
        let bufferedContent = "";
        
        await streamAgent.stream(
          { query, kbId, traceId },
          (token) => {
            bufferedContent += token;
            // 如果不缓存，直接推送
            if (!options?.bufferContent) {
              callbacks.onToken?.(token);
            }
          },
          () => emitMeta("agent_done", null, agentId),
          (err) => emitMeta("agent_error", { error: err.message }, agentId),
        );
        
        // 如果缓存了内容，返回以便后续判断
        if (options?.bufferContent) {
          return {
            agentId,
            result: {
              id: traceId,
              agent: agentId,
              status: "ok",
              content: bufferedContent,
              elapsedMs: Date.now() - startTime,
            },
          };
        }
        
        return {
          agentId,
          result: {
            id: traceId,
            agent: agentId,
            status: "ok",
            content: "",
            elapsedMs: Date.now() - startTime,
          },
        };
      } else {
        // 非流式 Agent
        const result = await agent.execute({ query, kbId, traceId });
        emitMeta("agent_done", null, agentId);
        return { agentId, result };
      }
    } catch (err: any) {
      emitMeta("agent_error", { error: err.message }, agentId);
      return {
        agentId,
        result: {
          id: `${agentId}-error`,
          agent: agentId,
          status: "error",
          content: "",
          error: { message: err.message },
          elapsedMs: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * 合成多个 Agent 的结果并推送
   */
  private composeAndEmit(
    results: AgentOutcome[],
    callbacks: StreamCallbacks,
  ): void {
    // 过滤成功结果（流式 Agent content 为空是正常的，已通过 callbacks 推送）
    const okResults = results.filter(
      (r) => r.result.status === "ok",
    );

    // 按优先级排序（db-query > web-search）
    const priorityOrder: Record<string, number> = { "db-query": 0, "web-search": 1 };
    okResults.sort((a, b) => (priorityOrder[a.agentId] ?? 99) - (priorityOrder[b.agentId] ?? 99));

    // 过滤出有内容的结果
    const resultsWithContent = okResults.filter((r) => r.result.content.trim().length > 0);

    if (resultsWithContent.length === 0) {
      // 没有有效结果，报错
      const hasErrors = okResults.some((r) => r.result.status === "error");
      if (hasErrors) {
        callbacks.onError(new Error("暂无可用答案"));
      } else {
        callbacks.onDone();
      }
      return;
    }

    // 推送有内容的结果（按优先级，DB Query 优先）
    const finalResults = resultsWithContent.slice(0, 1); // 只取优先级最高的一个
    const content = finalResults.map((r) => r.result.content).join("\n\n");
    const chunks = this.chunkContent(content, 20);
    for (const chunk of chunks) {
      callbacks.onToken(chunk);
    }

    const sources: SourceRef[] = [];
    for (const r of finalResults) {
      if (r.result.sources) {
        for (const s of r.result.sources) {
          sources.push({
            content: s.uri ?? "",
            sourceFile: s.title ?? s.uri ?? "",
            score: 0.8,
          });
        }
      }
    }
    if (sources.length > 0) {
      callbacks.onSources(sources);
    }

    callbacks.onDone();
  }

  private chunkContent(content: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private streamViaRag(
    query: string,
    kbId: string,
    params: SearchParams,
    callbacks: StreamCallbacks,
  ): void {
    retrieveAndChat(query, kbId, params, this.ragConfig, callbacks);
  }

  private normalizeParams(params: SearchParams | undefined): SearchParams {
    return {
      topK: params?.topK ?? 10,
      minScore: params?.minScore ?? 0.70,
      useReranker: params?.useReranker ?? false,
      denseWeight: params?.denseWeight ?? 0.5,
    };
  }
}
