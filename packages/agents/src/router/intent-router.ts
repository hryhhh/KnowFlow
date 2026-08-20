import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import type { RouterRules, RouterRule, RouteMetadata } from '../types';
import { ChatOpenAI } from '@langchain/openai';

/**
 * IntentRouter — 基于 YAML 规则的意图路由器
 * 支持热重载（mtime 轮询，30s 最小间隔）
 *
 * 匹配逻辑（v2.1）：
 *   1. 按 priority 降序遍历 enabled 规则，pattern 非空时做正则匹配
 *   2. 命中且 score >= minScore 则加入结果集，达到 maxMatchedRules 上限后停止
 *   3. 若最高命中规则的 priority ≤ routerConfidenceThreshold，触发 LLM finalRule
 *   4. 按 settings.alwaysIncludeAgents 将指定 Agent 追加到候选列表
 *   5. 全部无匹配时调用轻量 LLM 做意图分类兜底
 */
export class IntentRouter {
  private rules: RouterRules;
  private lastLoadedTime = 0;
  private rulesPath: string;
  private reloadTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param rulesPath 路由规则文件路径，默认读取 ROUTER_RULES_PATH 环境变量
   * @param llmConfig LLM 配置（用于兜底分类和置信度仲裁），未提供时跳过 LLM
   */
  constructor(
    rulesPath?: string,
    private readonly llmConfig?: { apiKey: string; model: string; baseURL: string },
  ) {
    this.rulesPath =
      rulesPath ??
      process.env.ROUTER_RULES_PATH ??
      path.resolve(process.cwd(), 'config/router.rules.yml');
    this.rules = this.loadRules();
    this.startHotReload();
  }

  private loadRules(): RouterRules {
    const content = fs.readFileSync(this.rulesPath, 'utf-8');
    this.lastLoadedTime = Date.now();
    return yaml.load(content) as RouterRules;
  }

  /** mtime 轮询，30s 最小间隔，防止频繁重载影响进行中请求 */
  private startHotReload(): void {
    let lastMtime = 0;
    this.reloadTimer = setInterval(() => {
      try {
        const stats = fs.statSync(this.rulesPath);
        if (stats.mtimeMs !== lastMtime && Date.now() - this.lastLoadedTime > 30_000) {
          const newRules = this.loadRules();
          this.rules = newRules;
          lastMtime = stats.mtimeMs;
          console.log(`[IntentRouter] 路由规则已热重载: ${this.rulesPath}`);
        }
      } catch {
        // 文件不存在或读取失败时静默忽略
      }
    }, 10_000);
  }

  public stop(): void {
    if (this.reloadTimer) {
      clearInterval(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  /**
   * 匹配规则（v2.1）
   * @param query 用户查询
   * @param maxMatched 最大命中规则数（覆盖 settings 中的配置）
   * @returns 匹配的规则列表（已按 priority 降序），以及可观测元数据
   */
  async match(
    query: string,
    maxMatched?: number,
  ): Promise<{
    matched: Array<{ rule: RouterRule; score: number }>;
    metadata: RouteMetadata;
  }> {
    const { rules, settings } = this.rules;
    const limit = maxMatched ?? settings.maxMatchedRules ?? 3;
    const threshold = settings.routerConfidenceThreshold ?? 70;
    const alwaysInclude = settings.alwaysIncludeAgents ?? [];
    const matched: Array<{ rule: RouterRule; score: number }> = [];
    const metadata: RouteMetadata = {
      triggeredLlmArbitration: false,
      ragIncludedBy: 'none',
      composeUsedRagPriority: false,
    };

    // 1. Pattern 匹配（按 YAML 顺序，规则已按 priority 降序排列）
    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (!rule.pattern) continue; // 空 pattern 为 LLM 兜底规则，跳过

      let score = 0;
      try {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(query)) {
          score = 1.0;
        }
      } catch {
        // 正则表达式无效时跳过
      }

      if (score >= rule.minScore) {
        matched.push({ rule, score });
        if (matched.length >= limit) break;
      }
    }

    // 2. 处理命中结果
    if (matched.length > 0) {
      matched.sort((a, b) => b.rule.priority - a.rule.priority);

      // 检查是否需要 LLM 置信度仲裁
      // 使用严格小于（<）而非小于等于（<=），避免 priority 恰好等于阈值时误触发
      // 例如 web-general 的 priority=70，阈值=70 时不应触发仲裁
      const highestPriority = matched[0].rule.priority;
      if (highestPriority < threshold) {
        metadata.triggeredLlmArbitration = true;
        console.log(
          `[IntentRouter] 最高命中 priority=${highestPriority} < 阈值=${threshold}，触发 LLM 仲裁`,
        );
        const llmResult = await this.arbitrateByLLM(query, matched, rules);
        matched.splice(0, matched.length, ...llmResult.matched);
        metadata.llmArbitrationAgent = llmResult.agent;
      }

      // 追加 alwaysIncludeAgents
      const currentAgents = new Set(matched.map((m) => m.rule.targetAgent));
      for (const agentId of alwaysInclude) {
        if (!currentAgents.has(agentId)) {
          // 查找对应规则（用最低优先级的匹配规则作为基础）
          const fallbackRule = matched[matched.length - 1]?.rule ?? rules[rules.length - 1];
          matched.push({
            rule: { ...fallbackRule, targetAgent: agentId },
            score: 0.0,
          });
          if (agentId === 'ragflow') {
            metadata.ragIncludedBy = 'always_include';
          }
        }
      }

      return { matched, metadata };
    }

    // 3. 无命中 → 检查 soft 规则是否应触发（priority < threshold 且无高优先级规则时）
    //    soft 规则已在规则列表中（priority=30），此处检查是否需要用它兜底
    const softRule = rules.find((r) => r.id === 'ragflow-soft' && r.enabled);
    if (softRule) {
      // soft 规则通过正则已经在上一步处理，如果没命中说明 query 不匹配 soft 模式
      // 直接走 LLM 兜底
    }

    // 4. 全部无匹配 → 调用 LLM 兜底分类
    const fallbackRule = rules.find((r) => r.targetAgent === 'llm-intent-classifier' && r.enabled);
    if (!fallbackRule || !this.llmConfig) {
      return { matched: [], metadata };
    }

    try {
      const llmAgent = await this.classifyByLLM(query, rules);
      matched.push(
        { rule: fallbackRule, score: 1.0 },
        { rule: { ...fallbackRule, targetAgent: llmAgent }, score: 1.0 },
      );
      metadata.ragIncludedBy = 'llm';
      return { matched, metadata };
    } catch (err) {
      console.error(`[IntentRouter] LLM 分类失败: ${err}`);
      return { matched: [{ rule: fallbackRule, score: 0.5 }], metadata };
    }
  }

  /**
   * LLM 置信度仲裁：当最高命中规则 priority ≤ 阈值时，由 LLM 重新决策
   */
  private async arbitrateByLLM(
    query: string,
    currentMatched: Array<{ rule: RouterRule; score: number }>,
    allRules: RouterRule[],
  ): Promise<{ matched: Array<{ rule: RouterRule; score: number }>; agent?: string }> {
    const availableAgents = [
      ...new Set(
        allRules
          .filter((r) => r.enabled && r.targetAgent !== 'llm-intent-classifier')
          .map((r) => r.targetAgent),
      ),
    ];

    const agentList = availableAgents.join(', ');
    const systemPrompt = `你是一个意图分类器。根据用户问题，判断应该由哪个 Agent 处理。
可选 Agent：${agentList}
当前已通过规则命中：${currentMatched.map((m) => m.rule.targetAgent).join(', ')}。
如果当前命中合理则保持原结果，如果明显错误请替换为正确的 Agent。
只返回 Agent 名称，不要任何其他内容。`;

    const llmCfg = this.llmConfig!;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);

    try {
      const llm = new ChatOpenAI({
        apiKey: llmCfg.apiKey,
        model: llmCfg.model,
        temperature: 0,
        streaming: false,
        configuration: { baseURL: llmCfg.baseURL },
      });

      const response = await llm.invoke(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `用户问题：${query}` },
        ],
        { signal: controller.signal },
      );

      const answer = (response as any).content?.toString().trim() ?? '';
      const finalAgent = availableAgents.includes(answer)
        ? answer
        : (availableAgents[0] ?? 'ragflow');

      // 构建仲裁结果：仅保留最终 Agent 对应的规则
      const finalRule = allRules.find((r) => r.targetAgent === finalAgent && r.enabled);
      if (finalRule) {
        return { matched: [{ rule: finalRule, score: 1.0 }], agent: finalAgent };
      }
      return { matched: [], agent: finalAgent };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.warn('[IntentRouter] LLM 仲裁超时（500ms），使用默认结果');
      } else {
        console.error(`[IntentRouter] LLM 仲裁失败: ${err.message}`);
      }
      // 仲裁失败时回退到当前最佳匹配
      return { matched: currentMatched, agent: currentMatched[0]?.rule.targetAgent };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** 调用轻量 LLM 对查询做意图分类 */
  private async classifyByLLM(query: string, allRules: RouterRule[]): Promise<string> {
    const availableAgents = [
      ...new Set(
        allRules
          .filter((r) => r.enabled && r.targetAgent !== 'llm-intent-classifier')
          .map((r) => r.targetAgent),
      ),
    ];

    const agentList = availableAgents.join(', ');
    const systemPrompt = `你是一个意图分类器。根据用户问题，判断应该由哪个 Agent 处理。
可选 Agent：${agentList}
只返回 Agent 名称，不要任何其他内容。`;

    const llmCfg = this.llmConfig!;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);

    try {
      const llm = new ChatOpenAI({
        apiKey: llmCfg.apiKey,
        model: llmCfg.model,
        temperature: 0,
        streaming: false,
        configuration: { baseURL: llmCfg.baseURL },
      });

      const response = await llm.invoke(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `用户问题：${query}` },
        ],
        { signal: controller.signal },
      );

      const answer = (response as any).content?.toString().trim() ?? '';
      return availableAgents.includes(answer) ? answer : (availableAgents[0] ?? 'ragflow');
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.warn('[IntentRouter] LLM 分类超时（500ms）');
      }
      return availableAgents[0] ?? 'ragflow';
    } finally {
      clearTimeout(timeout);
    }
  }

  /** 手动重新加载规则（调试用） */
  reload(): void {
    this.rules = this.loadRules();
    console.log(`[IntentRouter] 路由规则已重新加载`);
  }

  public getRules(): RouterRules {
    return this.rules;
  }
}
