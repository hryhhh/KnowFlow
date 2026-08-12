import type { ComposeStrategy, RouteResult, RouterRule, Agent } from "./types";
import { Dispatcher } from "./dispatcher";
import { IntentRouter } from "./router/intent-router";

/**
 * Orchestrator — 编排入口
 * 路由 → 调度 → 合成
 */
export class Orchestrator {
  private readonly router: IntentRouter;
  private readonly dispatcher: Dispatcher;

  constructor(
    router: IntentRouter,
    agents: Agent[],
    strategy: ComposeStrategy = "concat",
    allowParallel: boolean = true,
  ) {
    this.router = router;
    this.dispatcher = new Dispatcher(agents, strategy, allowParallel);
  }

  /**
   * 执行一次完整编排
   */
  async orchestrate(query: string, kbId: string, traceId: string): Promise<RouteResult> {
    const { settings } = this.router.getRules();
    const maxMatched = settings.maxMatchedRules ?? 3;

    // 1. 路由匹配
    const matchedRules = await this.router.match(query, maxMatched);

    // 2. 调度执行
    const agentParams = { query, kbId, traceId };
    const agentResults = await this.dispatcher.dispatch(
      matchedRules,
      agentParams,
      settings.defaultAgentTimeoutMs ?? 3000,
    );

    // 3. 合成
    const { content, sources } = this.dispatcher.compose(agentResults, matchedRules, query);

    return { traceId, matchedRules, agentResults, content, sources };
  }
}
