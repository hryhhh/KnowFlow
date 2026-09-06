/**
 * AgentRuntime 机制默认值
 *
 * 判据（12-Factor）：不随部署环境变化的机制/产品默认值收编为常量；
 * 需要差异化时通过构造参数 / AgentContext.create options 显式注入（单元测试即用此路径）。
 */
export const RUNTIME_DEFAULTS = {
  /** ReAct 最大推理轮数 */
  maxRounds: 5,
  /** AgentRuntime 整体超时（毫秒） */
  timeoutMs: 30000,
};
