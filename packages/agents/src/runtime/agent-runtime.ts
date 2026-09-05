import type { AgentRunParams, AgentRunResult } from '../types';
import { AgentContext } from './agent-context';
import { ReactLoop } from './react-loop';

/**
 * AgentRuntime — Agent 自主推理主入口
 *
 * 异常时返回 status='failed' + error 信息，不向上抛出，
 * 由调用方（AgentChatService）统一处理 trace 持久化。
 */
export class AgentRuntime {
  /**
   * 执行一次完整的 Agent 推理
   */
  async run(params: AgentRunParams): Promise<AgentRunResult> {
    const context = AgentContext.create(params);

    try {
      const loop = new ReactLoop();
      const result = await loop.execute(context);

      return {
        status: result.status,
        finalAnswer: result.finalAnswer,
        context: result.context,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      // 异常时也记录 trace，供线上排查
      try {
        context.trace.finalize('failed', errorMsg);
      } catch (_) {
        // ignore
      }

      return {
        status: 'failed',
        finalAnswer: '',
        context,
        error: errorMsg,
      };
    }
  }
}
