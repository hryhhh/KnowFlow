import type {
  Agent,
  AgentParams,
  AgentResult,
  ComposeStrategy,
  RouterRule,
} from "./types";

/**
 * Dispatcher — 并行调度多个 Agent，支持合成策略
 */
export class Dispatcher {
  private agents: Map<string, Agent>;
  private strategy: ComposeStrategy;
  private allowParallel: boolean;

  constructor(
    agents: Agent[],
    strategy: ComposeStrategy = "concat",
    allowParallel: boolean = true,
  ) {
    this.agents = new Map(agents.map((a) => [a.id, a]));
    this.strategy = strategy;
    this.allowParallel = allowParallel;
  }

  /**
   * 执行匹配到的规则对应的 Agent
   */
  async dispatch(
    matchedRules: Array<{ rule: RouterRule; score: number }>,
    params: AgentParams,
    defaultTimeoutMs: number,
  ): Promise<AgentResult[]> {
    const targets = matchedRules.map(({ rule }) => rule.targetAgent);
    const timeoutMs = defaultTimeoutMs;

    const runAgent = async (
      agentId: string,
      timeout: number,
    ): Promise<AgentResult> => {
      const agent = this.agents.get(agentId);
      if (!agent) {
        return {
          id: `${agentId}-error`,
          agent: agentId,
          status: "error",
          content: `Agent not found: ${agentId}`,
          error: { message: `Agent not found: ${agentId}` },
          elapsedMs: 0,
        };
      }

      const startTime = Date.now();
      try {
        const result = await this.runWithTimeout(
          agent.execute({ ...params, agentId }),
          timeout,
          agentId,
        );
        result.elapsedMs = Date.now() - startTime;
        return result;
      } catch (err) {
        return {
          id: `${agentId}-error`,
          agent: agentId,
          status: "error",
          content: "",
          error: { message: err instanceof Error ? err.message : String(err) },
          elapsedMs: Date.now() - startTime,
        };
      }
    };

    // 并行或串行执行
    let results: AgentResult[];
    if (this.allowParallel && targets.length > 1) {
      const promises = targets.map((id) => runAgent(id, timeoutMs));
      results = await Promise.all(promises);
    } else {
      results = await Promise.all(targets.map((id) => runAgent(id, timeoutMs)));
    }

    return results;
  }

  /**
   * 合成策略：将多个 Agent 结果合并
   */
  compose(
    agentResults: AgentResult[],
    matchedRules: Array<{ rule: RouterRule; score: number }>,
    query: string,
  ): { content: string; sources?: AgentResult["sources"] } {
    switch (this.strategy) {
      case "concat":
        return this.composeConcat(agentResults, matchedRules);
      case "llm-summarize":
        return this.composeLlmSummary(agentResults, matchedRules, query);
      case "rerank-and-merge":
        return this.composeRerankMerge(agentResults);
      default:
        return this.composeConcat(agentResults, matchedRules);
    }
  }

  private composeConcat(
    results: AgentResult[],
    rules: Array<{ rule: RouterRule; score: number }>,
  ): { content: string; sources?: AgentResult["sources"] } {
    // 按 priority 降序拼接，去重
    const priorityMap = new Map(rules.map(({ rule, score }) => [rule.targetAgent, rule.priority]));
    const sorted = [...results].sort((a, b) => {
      const pA = priorityMap.get(a.agent) ?? 0;
      const pB = priorityMap.get(b.agent) ?? 0;
      return pB - pA;
    });

    const seen = new Set<string>();
    const parts: string[] = [];
    const allSources: AgentResult["sources"] = [];

    for (const r of sorted) {
      if (r.status === "error" || r.status === "timeout") continue;
      const key = `${r.agent}:${r.content.slice(0, 100)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(r.content);
      if (r.sources) allSources.push(...r.sources);
    }

    return { content: parts.join("\n\n"), sources: allSources.length ? allSources : undefined };
  }

  private composeLlmSummary(
    results: AgentResult[],
    rules: Array<{ rule: RouterRule; score: number }>,
    query: string,
  ): { content: string } {
    // 合成 prompt（占位，LLM 调用在 NestJS 层处理）
    const sourcesText = results
      .filter((r) => r.status === "ok" || r.status === "partial")
      .map((r) => `【${r.agent}】\n${r.content}`)
      .join("\n\n");

    return {
      content: `[llm-summarize] query=${query} sources=${sourcesText}`,
    };
  }

  private composeRerankMerge(results: AgentResult[]): { content: string } {
    // 占位，reranker 在 NestJS 层处理
    const allSources = results
      .flatMap((r) => r.sources ?? [])
      .filter((s, i, arr) => arr.findIndex((x) => x.uri === s.uri) === i);
    return { content: `[rerank-and-merge] ${allSources.length} sources` };
  }

  private runWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    agentId: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Agent ${agentId} timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }
}
