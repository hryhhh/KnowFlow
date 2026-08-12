import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { RouterRules, RouterRule, Agent } from "../types";
import { ChatOpenAI } from "@langchain/openai";

/**
 * IntentRouter — 基于 YAML 规则的意图路由器
 * 支持热重载（30s mtime 轮询）
 *
 * 匹配逻辑：
 *   1. 按 priority 降序匹配 pattern
 *   2. 如有匹配 → 返回命中规则
 *   3. 如无匹配 → 调用轻量 LLM 做意图分类兜底
 */
export class IntentRouter {
  private rules: RouterRules;
  private lastLoadedTime = 0;
  private rulesPath: string;
  private reloadTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param rulesPath 路由规则文件路径
   * @param llmConfig LLM 配置（用于兜底分类），未提供时跳过 LLM 兜底
   */
  constructor(
    rulesPath?: string,
    private readonly llmConfig?: { apiKey: string; model: string; baseURL: string },
  ) {
    this.rulesPath =
      rulesPath ??
      process.env.ROUTER_RULES_PATH ??
      path.resolve(process.cwd(), "config/router.rules.yml");
    this.rules = this.loadRules();
    this.startHotReload();
  }

  private loadRules(): RouterRules {
    const content = fs.readFileSync(this.rulesPath, "utf-8");
    this.lastLoadedTime = Date.now();
    return yaml.load(content) as RouterRules;
  }

  private startHotReload(): void {
    let lastMtime = 0;
    this.reloadTimer = setInterval(() => {
      try {
        const stats = fs.statSync(this.rulesPath);
        if (stats.mtimeMs !== lastMtime && Date.now() - this.lastLoadedTime > 30_000) {
          const newRules = this.loadRules();
          Object.assign(this.rules, newRules);
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
   * 匹配规则：
   * 1. 先按 pattern 匹配（优先级高）
   * 2. 如无匹配且配置了 LLM，调用 LLM 分类兜底
   */
  async match(
    query: string,
    maxMatched: number = 3,
  ): Promise<Array<{ rule: RouterRule; score: number }>> {
    const { rules, settings } = this.rules;
    const matched: Array<{ rule: RouterRule; score: number }> = [];

    // 1. Pattern 匹配
    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (!rule.pattern) continue; // 跳过兜底规则（pattern 为空）

      let score = 0;
      try {
        const regex = new RegExp(rule.pattern);
        if (regex.test(query)) {
          score = 1.0;
        }
      } catch {
        // 正则表达式无效时跳过
      }

      if (score >= rule.minScore) {
        matched.push({ rule, score });
        if (matched.length >= (settings.maxMatchedRules ?? maxMatched)) break;
      }
    }

    // 2. 如有匹配，直接返回
    if (matched.length > 0) {
      matched.sort((a, b) => b.rule.priority - a.rule.priority);
      return matched.slice(0, settings.maxMatchedRules ?? maxMatched);
    }

    // 3. 无匹配 → 调用 LLM 兜底分类
    const fallbackRule = rules.find((r) => r.targetAgent === "llm-intent-classifier" && r.enabled);
    if (!fallbackRule || !this.llmConfig) {
      // 无兜底规则或无 LLM 配置，返回空
      return [];
    }

    try {
      const llmAgent = await this.classifyByLLM(query, rules);
      // 将 LLM 分类结果转为规则匹配格式
      return [
        { rule: fallbackRule, score: 1.0 },
        { rule: { ...fallbackRule, targetAgent: llmAgent }, score: 1.0 },
      ];
    } catch (err) {
      console.error(`[IntentRouter] LLM 分类失败: ${err}`);
      // LLM 失败时降级到默认规则
      return [{ rule: fallbackRule, score: 0.5 }];
    }
  }

  /**
   * 调用轻量 LLM 对查询做意图分类
   * 返回目标 Agent 名称
   */
  private async classifyByLLM(
    query: string,
    allRules: RouterRule[],
  ): Promise<string> {
    const availableAgents = [
      ...new Set(allRules.filter((r) => r.enabled && r.targetAgent !== "llm-intent-classifier").map((r) => r.targetAgent)),
    ];

    const agentList = availableAgents.join(", ");
    const systemPrompt = `你是一个意图分类器。根据用户问题，判断应该由哪个 Agent 处理。
可选 Agent：${agentList}
只返回 Agent 名称，不要任何其他内容。`;

    const userPrompt = `用户问题：${query}`;

    if (!this.llmConfig) return availableAgents[0] ?? "ragflow";
    const llm = new ChatOpenAI({
      apiKey: this.llmConfig.apiKey,
      model: this.llmConfig.model,
      temperature: 0,
      streaming: false,
      configuration: { baseURL: this.llmConfig.baseURL },
    });

    const response = await llm.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    const answer = (response as any).content?.toString().trim() ?? "";
    // 返回清理后的 Agent 名称
    return availableAgents.includes(answer) ? answer : availableAgents[0] ?? "ragflow";
  }

  /**
   * 重新加载规则（手动触发，用于调试）
   */
  reload(): void {
    this.rules = this.loadRules();
    console.log(`[IntentRouter] 路由规则已重新加载`);
  }

  public getRules(): RouterRules {
    return this.rules;
  }
}
