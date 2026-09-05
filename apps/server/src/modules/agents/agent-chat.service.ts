import { Injectable, Logger, Inject } from '@nestjs/common';
import { RAG_CONFIG } from '../../config/rag-config.provider';
import type {
  RAGPipelineConfig,
  SearchParams,
  SourceRef,
  StreamCallbacks,
} from '@knowbase-x/rag-engine';
import { retrieveAndChat, retrieve } from '@knowbase-x/rag-engine';
import {
  DbQueryAgent,
  WebSearchAgent,
  RagFlowAgent,
  StreamAgentProxy,
  IntentRouter,
  Orchestrator,
  ToolRegistry,
  RagSearchTool,
  DbQueryTool,
  WebSearchTool,
  ReadFileTool,
  CallHttpApiTool,
  LegacyAgentAdapter,
  AgentRuntime,
  ConversationMemory,
  type LLMConfig,
} from '@knowbase-x/agents';
import { normalizeSearchParams } from '../../common/search-params';
import type { Agent, AgentResult, RouteMetadata } from '@knowbase-x/agents';
import { UsageLogService } from '../usage/usage-log.service';
import { DbQueryService } from './db-query.service';
import { createSearchProvider } from './providers/index';
import * as path from 'node:path';
import { RedisCacheProvider } from './cache/redis-cache.provider';
import { TraceService } from './trace/trace.service';
import { SessionService } from '../session/session.service';
import type { MemoryLoader } from '../session/session.service';

/**
 * AgentChatService — 多 Agent 编排入口层
 *
 * 双路径设计：
 * - AGENTS_ENABLED=true + AGENT_RUNTIME_ENABLED=false → 走 Orchestrator 路由链路（原有）
 * - AGENTS_ENABLED=true + AGENT_RUNTIME_ENABLED=true  → 走 AgentRuntime ReAct 循环（新）
 * - AGENTS_ENABLED=false                              → 降级为传统单链路 RAG
 */
@Injectable()
export class AgentChatService {
  private readonly logger = new Logger(AgentChatService.name);
  private readonly agentsEnabled: boolean;
  private readonly composeStrategy: string;
  private readonly allowParallel: boolean;
  private readonly confidenceThreshold: number;
  private readonly alwaysIncludeAgents: string[];
  private readonly runtimeEnabled: boolean;

  // IntentRouter 实例（热重载）
  private router: IntentRouter;
  // Orchestrator 实例
  private orchestrator: Orchestrator | null = null;
  // Tool 注册表（AgentRuntime 路径）
  private toolRegistry: ToolRegistry | null = null;
  // Agent 实例缓存
  private agentInstances: Map<string, Agent> = new Map();

  constructor(
    @Inject(RAG_CONFIG) private readonly ragConfig: RAGPipelineConfig,
    private readonly usageLog: UsageLogService,
    private readonly dbQueryService: DbQueryService,
    private readonly redisCache: RedisCacheProvider,
    private readonly traceService: TraceService,
    private readonly sessionService: SessionService,
  ) {
    this.agentsEnabled = process.env.AGENTS_ENABLED === 'true';
    this.composeStrategy = process.env.AGENT_COMPOSE_STRATEGY ?? 'rag-priority';
    this.allowParallel = process.env.AGENT_ROUTER_ALLOW_PARALLEL !== 'false';
    this.confidenceThreshold = parseInt(process.env.AGENT_ROUTER_CONFIDENCE_THRESHOLD ?? '70', 10);
    const rawAlwaysInclude = process.env.AGENT_ALWAYS_INCLUDE_AGENTS ?? 'ragflow';
    this.alwaysIncludeAgents = rawAlwaysInclude
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    this.runtimeEnabled = process.env.AGENT_RUNTIME_ENABLED === 'true';

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
    const providerName = process.env.WEB_SEARCH_PROVIDER ?? 'tavily';
    const apiKey = process.env.WEB_SEARCH_API_KEY ?? '';

    let webProvider: ReturnType<typeof createSearchProvider>;
    if (!apiKey) {
      this.logger.warn('WEB_SEARCH_API_KEY 未配置，Web Search Agent 将返回空结果');
      webProvider = { search: async () => [] };
    } else {
      try {
        webProvider = createSearchProvider(providerName, apiKey);
      } catch (err: any) {
        this.logger.error(`创建 Web Search Provider 失败: ${err.message}`);
        webProvider = { search: async () => [] };
      }
    }

    const webAgent = new WebSearchAgent(webProvider, this.redisCache, {
      cacheTtlSeconds: parseInt(process.env.WEB_SEARCH_CACHE_TTL_SECONDS ?? '3600'),
      providerTimeoutMs: parseInt(process.env.WEB_SEARCH_PROVIDER_TIMEOUT_MS ?? '5000'),
      maxResults: 1,
    });
    this.agentInstances.set(webAgent.id, webAgent);

    // 3. RAGFlow Agent（包装 retrieveAndChat 为流式接口）
    const ragFlowAgent = new RagFlowAgent();
    ragFlowAgent.setStreamingFn(async (params, onToken, onSources, onDone, onError) => {
      const callbacks: StreamCallbacks = {
        onSources,
        onToken,
        onDone,
        onError: (err) => onError(err),
      };
      await retrieveAndChat(
        params.query,
        params.kbId,
        {
          topK: params.topK ?? 10,
          minScore: params.minScore ?? 0.7,
          useReranker: params.useReranker ?? false,
          denseWeight: params.denseWeight ?? 0.5,
          retrievalMode: params.retrievalMode,
          fusionMethod: params.fusionMethod,
          rrfK: params.rrfK,
          candidateMultiplier:
            params.candidateMultiplier ?? (Number(process.env.DEFAULT_CANDIDATE_MULTIPLIER) || 3),
          minDenseScore:
            params.minDenseScore ?? (Number(process.env.DEFAULT_MIN_DENSE_SCORE) || null),
        },
        this.ragConfig,
        callbacks,
      );
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
            baseURL: process.env.LLM_BASE_URL ?? '',
          }
        : undefined;

    this.router = new IntentRouter(
      process.env.ROUTER_RULES_PATH ?? path.resolve(process.cwd(), 'config/router.rules.yml'),
      llmConfig,
    );

    // 6. 初始化 Orchestrator
    this.orchestrator = new Orchestrator(
      this.router,
      allAgents,
      this.composeStrategy as 'concat' | 'llm-summarize' | 'rerank-and-merge' | 'rag-priority',
      this.allowParallel,
    );

    // 7. 初始化 ToolRegistry（AgentRuntime 路径需要）
    if (this.runtimeEnabled) {
      this.initTools();
    }

    this.logger.log(
      `Agent 编排系统初始化完成 (enabled=${this.agentsEnabled}, runtime=${this.runtimeEnabled}, agents: ${allAgents.map((a) => a.id).join(', ')}, strategy=${this.composeStrategy}, confidenceThreshold=${this.confidenceThreshold}, alwaysInclude=${this.alwaysIncludeAgents.join(',') || 'none'})`,
    );
  }

  /**
   * 初始化 ToolRegistry — 注册 5 个内置工具 + LegacyAgentAdapter
   */
  private initTools(): void {
    this.toolRegistry = new ToolRegistry();

    // 1. rag_search — 注入 retrieve 函数（非流式，只返回文档片段）
    this.toolRegistry.register(
      new RagSearchTool(
        async (query: string, kbId: string, params: { topK: number; minScore: number }) => {
          const result = await retrieve(
            query,
            kbId,
            {
              topK: params.topK,
              minScore: params.minScore,
              useReranker: false,
              denseWeight: 0.5,
            },
            this.ragConfig,
          );
          return result.results;
        },
      ),
    );

    // 2. query_database — 复用现有 DbQueryService
    this.toolRegistry.register(
      new DbQueryTool((templateId, params, maxRows) =>
        this.dbQueryService.execute(templateId, params, maxRows),
      ),
    );

    // 3. web_search — 复用现有 SearchProvider
    const providerName = process.env.WEB_SEARCH_PROVIDER ?? 'tavily';
    const apiKey = process.env.WEB_SEARCH_API_KEY ?? '';
    let webProvider: any;
    if (!apiKey) {
      webProvider = { search: async () => [] };
    } else {
      try {
        webProvider = createSearchProvider(providerName, apiKey);
      } catch {
        webProvider = { search: async () => [] };
      }
    }
    this.toolRegistry.register(new WebSearchTool(webProvider));

    // 4. read_file
    this.toolRegistry.register(new ReadFileTool());

    // 5. call_http_api
    this.toolRegistry.register(new CallHttpApiTool());

    // 6. LegacyAgentAdapter — 降级路径（默认不注册：legacy 工具内嵌完整 Agent/LLM 调用，
    //    会被 ReAct 循环当成普通工具重复消耗 token，仅在明确启用时暴露给 LLM）
    if (process.env.AGENT_LEGACY_TOOLS_ENABLED === 'true') {
      for (const [id, agent] of this.agentInstances) {
        this.toolRegistry.register(
          new LegacyAgentAdapter(agent, `${id}_legacy`, `Legacy ${agent.name} adapter`),
        );
      }
    }

    this.logger.log(`ToolRegistry 初始化完成，注册了 ${this.toolRegistry.list().length} 个工具`);
  }

  /** 从 config/db-queries.yml 加载 SQL 模板 */
  private loadDbTemplates(agent: DbQueryAgent): void {
    const templatePath =
      process.env.DB_QUERIES_TEMPLATE_PATH ??
      path.resolve(__dirname, '../../../../../config/db-queries.yml');
    try {
      const content = require('fs').readFileSync(templatePath, 'utf-8');
      const config = require('js-yaml').load(content) as { templates: any[] };
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
    sessionId?: string | null,
  ): Promise<void> {
    const resolvedParams = normalizeSearchParams(params);
    const startTime = Date.now();

    // ===== 路径选择 =====
    const useRuntime = this.agentsEnabled && this.runtimeEnabled && !!this.toolRegistry;

    if (!useRuntime) {
      // 降级到传统路由链路（完全不变）
      this.logger.debug('走 Orchestrator 路由链路');
      return this.runOrchestrator(
        query,
        kbId,
        params,
        callbacks,
        traceId,
        apiKeyId,
        startTime,
        resolvedParams,
      );
    }

    // ===== AgentRuntime 路径 =====
    return this.runAgentRuntime(
      query,
      kbId,
      params,
      callbacks,
      traceId,
      apiKeyId,
      startTime,
      sessionId ?? null,
    );
  }

  /**
   * Orchestrator 路由链路（原有逻辑，不变）
   */
  private async runOrchestrator(
    query: string,
    kbId: string,
    params: SearchParams | undefined,
    callbacks: StreamCallbacks & { onMeta?: (event: any) => void },
    traceId: string,
    apiKeyId: string | null,
    startTime: number,
    resolvedParams: SearchParams,
  ): Promise<void> {
    if (!this.agentsEnabled || !this.orchestrator) {
      // 最终降级到传统 RAG
      this.logger.debug('AGENTS_ENABLED=false，降级到传统 RAG 链路');
      retrieveAndChat(query, kbId, resolvedParams, this.ragConfig, callbacks);
      return;
    }

    try {
      const result = await this.orchestrator.orchestrate(query, kbId, traceId, resolvedParams);
      const meta = result.metadata;

      callbacks.onMeta?.({ type: 'trace_id', value: { traceId } });

      if (meta.triggeredLlmArbitration) {
        callbacks.onMeta?.({
          type: 'llm_arbitration',
          value: { triggered: true, agent: meta.llmArbitrationAgent, traceId },
        });
      }
      if (meta.ragIncludedBy !== 'none') {
        callbacks.onMeta?.({ type: 'rag_included', value: { by: meta.ragIncludedBy } });
      }
      if (meta.composeUsedRagPriority) {
        callbacks.onMeta?.({ type: 'compose_strategy', value: { strategy: 'rag-priority' } });
      }

      for (const matched of result.matchedRules) {
        callbacks.onMeta?.({
          type: 'agent_start',
          value: { agent: matched.rule.targetAgent, traceId },
        });
      }

      if (result.sources && result.sources.length > 0) {
        const sources: SourceRef[] = result.sources.map((s) => ({
          content: s.uri ?? '',
          sourceFile: s.title ?? s.uri ?? '',
          score: 0.8,
        }));
        callbacks.onSources(sources);
      }

      const content = result.content;
      const chunkSize = 20;
      if (!content || content.trim().length === 0) {
        this.logger.debug('Agent 编排无有效结果，回退到传统 RAG');
        retrieveAndChat(query, kbId, resolvedParams, this.ragConfig, callbacks);
        return;
      }
      for (let i = 0; i < content.length; i += chunkSize) {
        callbacks.onToken(content.slice(i, i + chunkSize));
      }

      for (const agentResult of result.agentResults) {
        callbacks.onMeta?.({
          type: 'agent_done',
          value: {
            agent: agentResult.agent,
            status: agentResult.status,
            elapsedMs: agentResult.elapsedMs,
          },
        });
      }

      callbacks.onDone();

      this.usageLog.record({
        type: 'agent',
        kbId,
        apiKeyId,
        traceId,
        duration: Date.now() - startTime,
        status: 'success',
        triggeredLlmArbitration: meta.triggeredLlmArbitration,
        ragIncludedBy: meta.ragIncludedBy,
        composeUsedRagPriority: meta.composeUsedRagPriority,
        llmArbitrationAgent: meta.llmArbitrationAgent,
      });
    } catch (err: any) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`Agent 编排失败: ${errorMessage}`);
      callbacks.onMeta?.({ type: 'agent_error', value: { error: errorMessage, traceId } });
      callbacks.onError(new Error(errorMessage));
      this.usageLog.record({
        type: 'agent',
        kbId,
        apiKeyId,
        traceId,
        duration: Date.now() - startTime,
        status: 'error',
        triggeredLlmArbitration: false,
        ragIncludedBy: null,
        composeUsedRagPriority: false,
        llmArbitrationAgent: null,
      });
    }
  }

  /**
   * AgentRuntime 路径（ReAct 循环 + 工具调用）
   */
  private async runAgentRuntime(
    query: string,
    kbId: string,
    params: SearchParams | undefined,
    callbacks: StreamCallbacks & { onMeta?: (event: any) => void },
    traceId: string,
    apiKeyId: string | null,
    startTime: number,
    sessionId: string | null,
  ): Promise<void> {
    const resolvedParams = normalizeSearchParams(params);

    // LLM 配置校验：缺失时快速失败，避免等待 LLM API 超时后才报错
    if (!process.env.LLM_API_KEY) {
      this.logger.warn('LLM_API_KEY 未配置，AgentRuntime 无法执行');
      callbacks.onError(new Error('LLM_API_KEY 未配置，请检查环境变量后重试'));
      callbacks.onDone();
      return;
    }

    try {
      // 推送 trace 事件
      callbacks.onMeta?.({ type: 'trace', timestamp: Date.now(), data: { traceId } });

      // 加载对话记忆（SessionService 实现了 MemoryLoader 接口，类型安全）
      const memory = new ConversationMemory(this.sessionService as unknown as MemoryLoader);
      const maxMessages = parseInt(process.env.AGENT_MEMORY_MAX_MESSAGES ?? '6', 10);
      const messages = await memory.load(sessionId, maxMessages);
      // 用户消息在进入本方法前已入库，若记忆末条与当前问题重复则剔除，
      // 避免同一条问题在 prompt 中出现两次
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === 'user' && lastMsg.content === query) {
        messages.pop();
      }

      // 构建 LLM 配置
      const llmConfig: LLMConfig = {
        apiKey: process.env.LLM_API_KEY,
        model: process.env.LLM_MODEL ?? 'gpt-4',
        baseURL: process.env.LLM_BASE_URL ?? '',
      };

      // 运行 AgentRuntime
      // agent_start 必须在 runtime.run() 之前推送，保证事件顺序: trace → agent_start → tool_call → ... → agent_completed
      callbacks.onMeta?.({
        type: 'agent_start',
        timestamp: Date.now(),
        data: { agent: 'AgentRuntime', traceId },
      });

      const runtime = new AgentRuntime();
      const result = await runtime.run({
        query,
        kbId,
        sessionId: sessionId ?? 'anonymous',
        traceId,
        messages,
        searchParams: resolvedParams,
        llmConfig,
        tools: this.toolRegistry!,
        emitEvent: (event: any) => {
          // rag_search 产生的检索来源转成 sources 事件，恢复前端来源列表
          if (event?.type === 'sources' && Array.isArray(event.data?.sources)) {
            const sources: SourceRef[] = event.data.sources.map((s: any) => ({
              content: s.content ?? '',
              sourceFile: s.sourceFile ?? '',
              score: s.score ?? 0,
            }));
            callbacks.onSources?.(sources);
            return;
          }
          callbacks.onMeta?.(event);
        },
      });

      // ===== 失败降级：回退到 Orchestrator 路由链路（PRD-12 §六 风险缓解）=====
      if (
        result.status === 'failed' &&
        this.orchestrator &&
        process.env.AGENT_RUNTIME_FALLBACK !== 'false'
      ) {
        this.logger.warn(
          `AgentRuntime 执行失败，降级到 Orchestrator 路由链路: ${result.error ?? 'unknown'}`,
        );
        callbacks.onMeta?.({
          type: 'agent_error',
          value: { error: result.error ?? 'AgentRuntime failed', traceId },
        });
        await this.saveRuntimeTrace(result);
        return this.runOrchestrator(
          query,
          kbId,
          params,
          callbacks,
          traceId,
          apiKeyId,
          startTime,
          resolvedParams,
        );
      }

      // 记录记忆加载到 trace
      if (messages.length > 0 && result.context?.trace) {
        result.context.trace.recordMemoryLoad(messages.length);
      }

      // 将 finalAnswer 分块推送到 onToken（模拟流式）
      if (result.finalAnswer) {
        const chunkSize = 20;
        for (let i = 0; i < result.finalAnswer.length; i += chunkSize) {
          callbacks.onToken(result.finalAnswer.slice(i, i + chunkSize));
        }
      }

      // 推送 agent_completed 事件
      const tokensUsed = result.context?.trace?.tokensUsed;
      callbacks.onMeta?.({
        type: 'agent_completed',
        timestamp: Date.now(),
        data: {
          status: result.status,
          durationMs: Date.now() - startTime,
          traceId,
          runId: result.context?.runId,
          tokensUsed,
        },
      });

      // trace 必须在 done 事件前落库：前端收到 agent_completed 即可点击查看详情，
      // 若在流关闭后异步保存会出现短暂查不到的情况
      await this.saveRuntimeTrace(result);

      callbacks.onDone();

      // 记录使用日志
      this.usageLog.record({
        type: 'agent',
        kbId,
        apiKeyId,
        traceId,
        duration: Date.now() - startTime,
        status: result.status === 'completed' ? 'success' : 'error',
      });
    } catch (err: any) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`AgentRuntime 执行失败: ${errorMessage}`);
      callbacks.onMeta?.({ type: 'agent_error', value: { error: errorMessage, traceId } });
      // 异常也降级到 Orchestrator（PRD-12 §六），仅在可用时
      if (this.orchestrator && process.env.AGENT_RUNTIME_FALLBACK !== 'false') {
        this.logger.warn('AgentRuntime 异常，降级到 Orchestrator 路由链路');
        return this.runOrchestrator(
          query,
          kbId,
          params,
          callbacks,
          traceId,
          apiKeyId,
          startTime,
          resolvedParams,
        );
      }
      callbacks.onError(new Error(errorMessage));
      this.usageLog.record({
        type: 'agent',
        kbId,
        apiKeyId,
        traceId,
        duration: Date.now() - startTime,
        status: 'error',
      });
    }
  }

  /**
   * 持久化 runtime trace（aborted 映射为 failed）。
   * 写入失败仅告警，不影响主流程（TraceService 内部已兜底）。
   */
  private async saveRuntimeTrace(result: {
    status: string;
    context: any;
    error?: string;
  }): Promise<void> {
    if (process.env.AGENT_TRACE_ENABLED !== 'true' || !result.context?.trace) return;
    const traceStatus = result.status === 'aborted' ? 'failed' : result.status;
    const errorMsg =
      result.error ?? (result.status === 'truncated' ? 'Reached max reasoning rounds' : undefined);
    const trace = result.context.trace.finalize(
      traceStatus as 'completed' | 'failed' | 'truncated',
      errorMsg,
    );
    await this.traceService.save(trace);
  }

  /**
   * 同步编排入口（非流式）
   */
  async orchestrate(query: string, kbId: string, params: SearchParams | undefined): Promise<any> {
    if (!this.agentsEnabled || !this.orchestrator) {
      return { agentsEnabled: false, message: 'Agent 编排未启用' };
    }

    const startTime = Date.now();
    const traceId = `sync_${Date.now()}`;

    try {
      const result = await this.orchestrator.orchestrate(query, kbId, traceId, params);
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
      this.logger.log('路由规则已重新加载');
    }
  }
}
