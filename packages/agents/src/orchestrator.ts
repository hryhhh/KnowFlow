import type { ComposeStrategy, RouteResult, RouterRule, Agent, RouteMetadata } from "./types";
import { Dispatcher } from "./dispatcher";
import { IntentRouter } from "./router/intent-router";

/**
 * Orchestrator — 编排入口：路由 → 调度 → 合成
 */
export class Orchestrator {
  private readonly router: IntentRouter;
  private readonly dispatcher: Dispatcher;
  private readonly strategy: ComposeStrategy;

  constructor(
    router: IntentRouter,
    agents: Agent[],
    strategy: ComposeStrategy = "concat",
    allowParallel: boolean = true,
  ) {
    this.router = router;
    this.dispatcher = new Dispatcher(agents, strategy, allowParallel);
    this.strategy = strategy;
  }

  /**
   * 执行一次完整编排
   * @param query 用户查询
   * @param kbId 知识库 ID
   * @param traceId 链路追踪 ID
   */
  async orchestrate(
    query: string,
    kbId: string,
    traceId: string,
  ): Promise<RouteResult> {
    const { settings } = this.router.getRules();
    const limit = settings.maxMatchedRules ?? 3;

    // 1. 路由匹配（v2.1 返回 { matched, metadata }）
    const { matched, metadata } = await this.router.match(query, limit);

    // 2. 调度执行
    const agentParams = { query, kbId, traceId };
    const agentResults = await this.dispatcher.dispatch(
      matched,
      agentParams,
      settings.defaultAgentTimeoutMs ?? 3000,
    );

    // 3. 合成
    const { content, sources } = this.dispatcher.compose(
      agentResults,
      matched,
      query,
    );

    // 标记合成策略使用情况（在 compose 之后，因为 rag-priority 是动态判断的）
    const composeUsedRagPriority =
      this.strategy === "rag-priority" &&
      agentResults.some((r) => r.agent === "ragflow");

    return {
      traceId,
      matchedRules: matched,
      agentResults,
      content,
      sources,
      metadata: {
        ...metadata,
        composeUsedRagPriority,
      },
    };
  }
}
