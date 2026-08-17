import { Injectable, Logger, Inject } from "@nestjs/common";
import { RAG_CONFIG } from "../../config/rag-config.provider";
import type { RAGPipelineConfig, SearchParams, SourceRef, StreamCallbacks } from "@knowbase-x/rag-engine";
import { retrieveAndChat } from "@knowbase-x/rag-engine";
import {
  DbQueryAgent,
  WebSearchAgent,
  RagFlowAgent,
  StreamAgentProxy,
  IntentRouter,
  Orchestrator,
} from "@knowbase-x/agents";
import type { Agent, AgentResult, RouteMetadata } from "@knowbase-x/agents";
import { UsageLogService } from "../usage/usage-log.service";
import { DbQueryService } from "./db-query.service";
import { createSearchProvider } from "./providers/index";
import * as path from "node:path";

/**
 * AgentChatService — 多 Agent 编排入口层
 *
 * 当 AGENTS_ENABLED=true 时，路由到 Agent 编排链路：
 *   1. IntentRouter 匹配规则（含置信度仲裁 + alwaysInclude）
 *   2. Dispatcher 并行执行所有命中 Agent
 *   3. rag-priority 合成策略合并结果，通过 callbacks 流式推送给前端
 *
 * 当 AGENTS_ENABLED=false 时，降级为传统单链路 RAG
 */
@Injectable()
export class AgentChatService {
  private readonly logger = new Logger(AgentChatService.name);
  private readonly agentsEnabled: boolean;
  private readonly composeStrategy: string;
  private readonly allowParallel: boolean;
  private readonly confidenceThreshold: number;
  private readonly alwaysIncludeAgents: string[];

  // IntentRouter 实例（热重载）
  private router: IntentRouter;
  // Orchestrator 实例
  private orchestrator: Orchestrator | null = null;
  // Agent 实例缓存
  private agentInstances: Map<string, Agent> = new Map();

  constructor(
    @Inject(RAG_CONFIG) private readonly ragConfig: RAGPipelineConfig,
    private readonly usageLog: UsageLogService,
    private readonly dbQueryService: DbQueryService,
  ) {
    this.agentsEnabled = process.env.AGENTS_ENABLED === "true";
    this.composeStrategy = process.env.AGENT_COMPOSE_STRATEGY ?? "rag-priority";
    this.allowParallel = process.env.AGENT_ROUTER_ALLOW_PARALLEL !== "false";
    this.confidenceThreshold = parseInt(
      process.env.AGENT_ROUTER_CONFIDENCE_THRESHOLD ?? "70",
      10,
    );
    const rawAlwaysInclude = process.env.AGENT_ALWAYS_INCLUDE_AGENTS ?? "ragflow";
    this.alwaysIncludeAgents = rawAlwaysInclude
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (this.agentsEnabled) {
      this.initAgents();
    }
  }

  /** 初始化所有 Agent 实例并注册到 Orchestrator */
  private initAgents(): void {
    // 1. DB Query Agent
    const dbAgent = new DbQueryAgent();
    this.loadDbTemplates(dbAgent);
    dbAgent.setExecuteFn(async (queryId, params, maxRows) => {
      return this.dbQueryService.execute(queryId, params, maxRows);
    });
    this.agentInstances.set(dbAgent.id, dbAgent);

    // 2. Web Search Agent
    const providerName = process.env.WEB_SEARCH_PROVIDER ?? "tavily";
    const apiKey = process.env.WEB_SEARCH_API_KEY ?? "";

    let webProvider: ReturnType<typeof createSearchProvider>;
    if (!apiKey) {
      this.logger.warn("WEB_SEARCH_API_KEY 未配置，Web Search Agent 将返回空结果");
      webProvider = { search: async () => [] };
    } else {
      try {
        webProvider = createSearchProvider(providerName, apiKey);
      } catch (err: any) {
        this.logger.error(`创建 Web Search Provider 失败: ${err.message}`);
        webProvider = { search: async () => [] };
      }
    }

    const webAgent = new WebSearchAgent(
      webProvider,
      { get: async () => null, set: async () => {} },
      {
        cacheTtlSeconds: parseInt(process.env.WEB_SEARCH_CACHE_TTL_SECONDS ?? "3600"),
        providerTimeoutMs: parseInt(process.env.WEB_SEARCH_PROVIDER_TIMEOUT_MS ?? "5000"),
        maxResults: 1,
      },
    );
    this.agentInstances.set(webAgent.id, webAgent);

    // 3. RAGFlow Agent（包装 retrieveAndChat 为流式接口）
    const ragFlowAgent = new RagFlowAgent();
    ragFlowAgent.setStreamingFn(async (params, onToken, _onSources, onDone, onError) => {
      const callbacks: StreamCallbacks = {
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
      }, this.ragConfig, callbacks);
    });
    this.agentInstances.set(ragFlowAgent.id, ragFlowAgent);

    // 4. 将所有非流式 Agent 包装为流式代理
    const allAgents: Agent[] = [];
    for (const [id, agent] of this.agentInstances) {
      allAgents.push(agent);
      if (!(agent as any).stream) {
        this.agentInstances.set(id, new StreamAgentProxy(agent));
      }
    }

    // 5. 初始化 IntentRouter
    const llmConfig =
      process.env.LLM_API_KEY && process.env.LLM_MODEL
        ? {
            apiKey: process.env.LLM_API_KEY,
            model: process.env.LLM_MODEL,
            baseURL: process.env.LLM_BASE_URL ?? "",
          }
        : undefined;

    this.router = new IntentRouter(
      process.env.ROUTER_RULES_PATH ?? path.resolve(process.cwd(), "config/router.rules.yml"),
      llmConfig,
    );

    // 6. 初始化 Orchestrator
    this.orchestrator = new Orchestrator(
      this.router,
      allAgents,
      this.composeStrategy as "concat" | "llm-summarize" | "rerank-and-merge" | "rag-priority",
      this.allowParallel,
    );

    this.logger.log(
      `Agent 编排系统初始化完成 (enabled=true, agents: ${allAgents.map((a) => a.id).join(", ")}, strategy=${this.composeStrategy}, confidenceThreshold=${this.confidenceThreshold}, alwaysInclude=${this.alwaysIncludeAgents.join(",") || "none"})`,
    );
  }

  /** 从 config/db-queries.yml 加载 SQL 模板 */
  private loadDbTemplates(agent: DbQueryAgent): void {
    const templatePath =
      process.env.DB_QUERIES_TEMPLATE_PATH ??
      path.resolve(__dirname, '../../../../../config/db-queries.yml');
    try {
      const content = require("fs").readFileSync(templatePath, "utf-8");
      const config = require("js-yaml").load(content) as { templates: any[] };
      for (const t of config.templates) {
        agent.registerTemplate(t);
      }
      this.logger.log(`已为 DB Query Agent 加载 ${config.templates.length} 个查询模板`);
    } catch (err: any) {
      this.logger.warn(`加载 DB 查询模板失败: ${err.message}`);
    }
  }

  /**
   * 流式对话入口
   * @param query 用户查询
   * @param kbId 知识库 ID
   * @param params 检索参数
   * @param callbacks SSE 回调
   * @param traceId 链路追踪 ID
   * @param apiKeyId API Key ID（用于日志）
   */
  async stream(
    query: string,
    kbId: string,
    params: SearchParams | undefined,
    callbacks: StreamCallbacks & { onMeta?: (event: any) => void },
    traceId: string,
    apiKeyId: string | null,
  ): Promise<void> {
    const resolvedParams = this.normalizeParams(params);
    const startTime = Date.now();

    if (!this.agentsEnabled || !this.orchestrator) {
      // 降级到传统 RAG
      this.logger.debug("AGENTS_ENABLED=false，降级到传统 RAG 链路");
      retrieveAndChat(query, kbId, resolvedParams, this.ragConfig, callbacks);
      return;
    }

    try {
      // 执行编排：路由 → 调度 → 合成
      const result = await this.orchestrator.orchestrate(query, kbId, traceId);
      const meta = result.metadata;

      // 推送 trace_id
      callbacks.onMeta?.({ type: "trace_id", value: { traceId } });

      // 推送可观测元数据（v2.1）
      if (meta.triggeredLlmArbitration) {
        callbacks.onMeta?.({
          type: "llm_arbitration",
          value: {
            triggered: true,
            agent: meta.llmArbitrationAgent,
            traceId,
          },
        });
      }
      if (meta.ragIncludedBy !== "none") {
        callbacks.onMeta?.({
          type: "rag_included",
          value: { by: meta.ragIncludedBy },
        });
      }
      if (meta.composeUsedRagPriority) {
        callbacks.onMeta?.({
          type: "compose_strategy",
          value: { strategy: "rag-priority" },
        });
      }

      for (const matched of result.matchedRules) {
        callbacks.onMeta?.({
          type: "agent_start",
          value: { agent: matched.rule.targetAgent, traceId },
          agent: matched.rule.targetAgent,
        });
      }

      // 推送来源
      if (result.sources && result.sources.length > 0) {
        const sources: SourceRef[] = result.sources.map((s) => ({
          content: s.uri ?? "",
          sourceFile: s.title ?? s.uri ?? "",
          score: 0.8,
        }));
        callbacks.onSources(sources);
      }

      // 流式推送合成内容（分块推送模拟流式）
      const content = result.content;
      const chunkSize = 20;
      if (!content || content.trim().length === 0) {
        // 编排无有效结果，回退到传统 RAG
        this.logger.debug("Agent 编排无有效结果，回退到传统 RAG");
        retrieveAndChat(query, kbId, resolvedParams, this.ragConfig, callbacks);
        return;
      }
      for (let i = 0; i < content.length; i += chunkSize) {
        callbacks.onToken(content.slice(i, i + chunkSize));
      }

      // Agent 执行完成事件
      for (const agentResult of result.agentResults) {
        callbacks.onMeta?.({
          type: "agent_done",
          value: {
            agent: agentResult.agent,
            status: agentResult.status,
            elapsedMs: agentResult.elapsedMs,
          },
          agent: agentResult.agent,
        });
      }

      callbacks.onDone();

      // 记录使用日志
      this.usageLog.record({
        type: "agent",
        kbId,
        apiKeyId,
        traceId,
        duration: Date.now() - startTime,
        status: "success",
        triggeredLlmArbitration: meta.triggeredLlmArbitration,
        ragIncludedBy: meta.ragIncludedBy,
        composeUsedRagPriority: meta.composeUsedRagPriority,
        llmArbitrationAgent: meta.llmArbitrationAgent,
      });
    } catch (err: any) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`Agent 编排失败: ${errorMessage}`);

      callbacks.onMeta?.({
        type: "agent_error",
        value: { error: errorMessage, traceId },
      });

      callbacks.onError(new Error(errorMessage));

      this.usageLog.record({
        type: "agent",
        kbId,
        apiKeyId,
        traceId,
        duration: Date.now() - startTime,
        status: "error",
        triggeredLlmArbitration: false,
        ragIncludedBy: null,
        composeUsedRagPriority: false,
        llmArbitrationAgent: null,
      });
    }
  }

  /**
   * 同步编排入口（非流式）
   */
  async orchestrate(
    query: string,
    kbId: string,
    params: SearchParams | undefined,
  ): Promise<any> {
    if (!this.agentsEnabled || !this.orchestrator) {
      return { agentsEnabled: false, message: "Agent 编排未启用" };
    }

    const startTime = Date.now();
    const traceId = `sync_${Date.now()}`;

    try {
      const result = await this.orchestrator.orchestrate(query, kbId, traceId);
      return {
        ...result,
        elapsedMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        traceId,
        error: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - startTime,
      };
    }
  }

  /** 手动触发路由规则热重载 */
  reloadRules(): void {
    if (this.router) {
      this.router.reload();
      this.logger.log("路由规则已重新加载");
    }
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
