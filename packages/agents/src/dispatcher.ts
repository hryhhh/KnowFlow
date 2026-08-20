import type { Agent, AgentParams, AgentResult, ComposeStrategy, RouterRule } from './types';

/**
 * Dispatcher — 并行调度多个 Agent，支持三种合成策略
 *
 * 合成策略：
 *   - concat：按 priority 降序拼接，同 priority 按 score 降序；去重；跳过 error/timeout
 *   - llm-summarize：将各 Agent 结果拼成 prompt，由调用方通过 LLM 合成
 *   - rerank-and-merge：合并所有 sources，确定性排序后交由 reranker 处理
 */
export class Dispatcher {
  private agents: Map<string, Agent>;
  private strategy: ComposeStrategy;
  private allowParallel: boolean;

  constructor(
    agents: Agent[],
    strategy: ComposeStrategy = 'concat',
    allowParallel: boolean = true,
  ) {
    this.agents = new Map(agents.map((a) => [a.id, a]));
    this.strategy = strategy;
    this.allowParallel = allowParallel;
  }

  /**
   * 执行匹配到的规则对应的 Agent
   * @param matchedRules 路由匹配结果（已按 priority 排序）
   * @param params Agent 执行参数
   * @param defaultTimeoutMs 全局默认超时（ms）
   */
  async dispatch(
    matchedRules: Array<{ rule: RouterRule; score: number }>,
    params: AgentParams,
    defaultTimeoutMs: number,
  ): Promise<AgentResult[]> {
    const targets = matchedRules.map(({ rule }) => rule.targetAgent);

    const runAgent = async (agentId: string, timeout: number): Promise<AgentResult> => {
      const agent = this.agents.get(agentId);
      if (!agent) {
        return {
          id: `${agentId}-error`,
          agent: agentId,
          status: 'error',
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
          status: 'error',
          content: '',
          error: { message: err instanceof Error ? err.message : String(err) },
          elapsedMs: Date.now() - startTime,
        };
      }
    };

    // 去重：相同 targetAgent 只执行一次（保留第一条规则）
    const uniqueTargets: string[] = [];
    const seenAgents = new Set<string>();
    for (const { rule } of matchedRules) {
      if (!seenAgents.has(rule.targetAgent)) {
        seenAgents.add(rule.targetAgent);
        uniqueTargets.push(rule.targetAgent);
      }
    }

    // 并行或串行执行
    let results: AgentResult[];
    if (this.allowParallel && uniqueTargets.length > 1) {
      const promises = uniqueTargets.map((id) => runAgent(id, defaultTimeoutMs));
      results = await Promise.all(promises);
    } else {
      results = await Promise.all(uniqueTargets.map((id) => runAgent(id, defaultTimeoutMs)));
    }

    return results;
  }

  /**
   * 合成策略：将多个 Agent 结果合并为最终内容
   *
   * rag-priority（v2.1 新增）：
   *   - 若 RAGFlow 结果 status=ok 且 content 非空，优先展示 RAG 结果，其他 Agent 结果作为补充（标注来源）
   *   - 若 RAGFlow 结果为空/错误/超时，回退到 concat
   */
  compose(
    agentResults: AgentResult[],
    matchedRules: Array<{ rule: RouterRule; score: number }>,
    query: string,
  ): { content: string; sources?: AgentResult['sources'] } {
    switch (this.strategy) {
      case 'concat':
        return this.composeConcat(agentResults, matchedRules);
      case 'llm-summarize':
        return this.composeLlmSummary(agentResults, query);
      case 'rerank-and-merge':
        return this.composeRerankMerge(agentResults);
      case 'rag-priority':
        return this.composeRagPriority(agentResults, matchedRules);
      default:
        return this.composeConcat(agentResults, matchedRules);
    }
  }

  /** concat：按 priority 降序拼接，去重，跳过 error/timeout */
  private composeConcat(
    results: AgentResult[],
    rules: Array<{ rule: RouterRule; score: number }>,
  ): { content: string; sources?: AgentResult['sources'] } {
    const priorityMap = new Map(rules.map(({ rule }) => [rule.targetAgent, rule.priority]));
    const sorted = [...results].sort((a, b) => {
      const pA = priorityMap.get(a.agent) ?? 0;
      const pB = priorityMap.get(b.agent) ?? 0;
      return pB - pA;
    });

    const seen = new Set<string>();
    const parts: string[] = [];
    const allSources: AgentResult['sources'] = [];
    const MAX_CONTENT_LENGTH = 1500; // 单条结果最大字符数，避免原始 HTML 过长

    for (const r of sorted) {
      if (r.status === 'error' || r.status === 'timeout') continue;
      const key = `${r.agent}:${r.content.slice(0, 100)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // 清理 HTML/markdown 残留，截断过长内容
      const cleaned = this.sanitizeContent(r.content);
      parts.push(
        cleaned.length > MAX_CONTENT_LENGTH
          ? cleaned.slice(0, MAX_CONTENT_LENGTH) + '...'
          : cleaned,
      );
      if (r.sources) allSources.push(...r.sources);
    }

    return {
      content: parts.join('\n\n'),
      sources: allSources.length ? allSources : undefined,
    };
  }

  /** 清理 Web Search 返回的 HTML/markdown 残留，提取纯文本 */
  private sanitizeContent(content: string): string {
    let result = content;

    // 移除 HTML 标签（如 <3级、<br>、</span> 等），替换为换行以便后续处理
    result = result.replace(/<[^>]+>/g, '\n');
    // 移除 markdown 标题符号
    result = result.replace(/^#{1,6}\s+/gm, '');
    // 移除列表符号（-、*、• 开头的行）
    result = result.replace(/^[#\-\*•]\s+/gm, '');
    // 移除 URL 链接
    result = result.replace(/https?:\/\/[^\s)\]}}]+/g, '');
    // 移除括号内的页码/截断标记 [...] [切换] 等
    result = result.replace(/\[([^\]]*\.+\s*)+\]/g, '');
    result = result.replace(/\[切换\]/g, '');
    // 移除独立的编号开头（如 "2. " "3." 开头的段落）
    result = result.replace(/\n\d+\.\s+/g, '\n');
    // 移除末尾孤立数字（如 "3." 这种段落末尾的残留编号）
    result = result.replace(/\n\d+\.$/, '');
    result = result.replace(/^\d+\.$\n?/gm, '');
    // 移除月份数字后缀（如 "1月)" "12月)"）
    result = result.replace(/(\d+)月\)/g, '');
    // 移除空行
    result = result.replace(/\n\s*\n/g, '\n');
    // 压缩每行内的多余空白（不跨行）
    result = result
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n');
    return result.trim();
  }

  /** llm-summarize：拼成 prompt，由调用方通过 LLM 合成 */
  private composeLlmSummary(results: AgentResult[], query: string): { content: string } {
    const validResults = results.filter((r) => r.status === 'ok' || r.status === 'partial');
    const sourcesText = validResults.map((r) => `【${r.agent}】\n${r.content}`).join('\n\n');

    return {
      content: `[llm-summarize] query=${query}\nsources=${sourcesText}`,
    };
  }

  /** rerank-and-merge：合并所有 sources，去重 */
  private composeRerankMerge(results: AgentResult[]): { content: string } {
    const allSources = results
      .flatMap((r) => r.sources ?? [])
      .filter((s, i, arr) => arr.findIndex((x) => x.uri === s.uri) === i);
    return { content: `[rerank-and-merge] ${allSources.length} sources` };
  }

  /**
   * rag-priority：RAGFlow 有有效结果时优先展示，其他 Agent 结果作为补充
   * 回退条件：RAGFlow 结果为空 / error / timeout
   */
  private composeRagPriority(
    results: AgentResult[],
    rules: Array<{ rule: RouterRule; score: number }>,
  ): { content: string; sources?: AgentResult['sources'] } {
    const ragResult = results.find((r) => r.agent === 'ragflow');
    const isRagValid =
      ragResult &&
      ragResult.status === 'ok' &&
      ragResult.content.trim().length > 0 &&
      !this.isNegativeAnswer(ragResult.content);

    if (isRagValid) {
      // RAG 有效：以 RAG 为主，其他 Agent 结果标注来源后追加
      const otherResults = results
        .filter((r) => r.agent !== 'ragflow')
        .filter((r) => r.status !== 'error' && r.status !== 'timeout');

      const priorityMap = new Map(rules.map(({ rule }) => [rule.targetAgent, rule.priority]));
      otherResults.sort(
        (a, b) => (priorityMap.get(b.agent) ?? 0) - (priorityMap.get(a.agent) ?? 0),
      );

      const parts = [`【RAGFlow】\n${ragResult.content}`];
      const allSources: AgentResult['sources'] = ragResult.sources ? [...ragResult.sources] : [];

      for (const r of otherResults) {
        const tag = r.agent.toUpperCase().replace(/-/g, ' ');
        parts.push(`【${tag}】\n${r.content}`);
        if (r.sources) allSources.push(...r.sources);
      }

      return {
        content: parts.join('\n\n'),
        sources: allSources.length ? allSources : undefined,
      };
    }

    // RAG 无效或无结果：排除 RAGFlow 后用 concat 处理其他 Agent
    const nonRagResults = results.filter((r) => r.agent !== 'ragflow');
    if (nonRagResults.length === 0) {
      return { content: '' };
    }
    return this.composeConcat(nonRagResults, rules);
  }

  /** 检测 RAGFlow 是否返回了负向回答 */
  private isNegativeAnswer(content: string): boolean {
    if (!content) return false;
    const negativePatterns = [
      '抱歉',
      '暂无',
      '无法为您',
      '没有相关信息',
      '没有关于',
      '无法回答',
      '无法提供',
      '没有找到',
      '无关信息',
      '未找到',
      '不涉及',
    ];
    return negativePatterns.some((p) => content.includes(p));
  }

  /** 带超时的 Promise 包装 */
  private runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, agentId: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Agent ${agentId} timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }
}
