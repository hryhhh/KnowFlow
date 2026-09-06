/**
 * 业务默认常量（单一事实来源）
 *
 * 判据（12-Factor）：会随部署环境变化的才进 env（见 env.ts）；
 * 产品行为与机制默认值收编为此处常量，变更走代码评审而非改配置。
 * 未来若多客户部署需要按环境差异化个别值，再把对应键加回 env.ts
 * 与 validateEnv，消费方从 DEFAULTS 换回 env.* 即可。
 */

/** 检索默认参数 */
export const RETRIEVAL_DEFAULTS = {
  /** 相似度最低分阈值 */
  minScore: 0.7,
  /** hybrid 模式 dense 候选过滤阈值，null 表示不施加 */
  minDenseScore: 0.3,
  /** 每路候选倍数（硬上限 10） */
  candidateMultiplier: 3,
  /** 检索结果缓存 TTL（毫秒），0 表示禁用 */
  resultCacheTtlMs: 300000,
};

/** Agent 编排默认参数 */
export const AGENT_DEFAULTS = {
  /** LLM 仲裁触发阈值（百分制） */
  routerConfidenceThreshold: 70,
  /** 合成策略：rag-priority | concat | llm-summarize | rerank-and-merge */
  composeStrategy: 'rag-priority',
  /** 允许并行执行 Agent */
  routerAllowParallel: true,
  /** 强制包含的 Agent */
  alwaysIncludeAgents: ['ragflow'],
  /** 注入对话历史的最新消息数 */
  memoryMaxMessages: 6,
};

/** Web Search 机制参数 */
export const WEB_SEARCH_DEFAULTS = {
  /** 结果缓存 TTL（秒） */
  cacheTtlSeconds: 300,
  /** Provider 请求超时（毫秒） */
  providerTimeoutMs: 5000,
};
