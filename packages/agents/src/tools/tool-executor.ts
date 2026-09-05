import type { Tool, ToolContext, ToolResult } from './base-tool';

/** 各工具的默认超时（毫秒） */
const DEFAULT_TIMEOUTS: Record<string, number> = {
  rag_search: 8000,
  query_database: 5000,
  web_search: 3000,
  read_file: 2000,
  call_http_api: 5000,
};

/** 结果截断阈值 */
const RESULT_TRUNCATE_LIMIT = 4000;

/**
 * ToolExecutor — 统一执行工具调用
 *
 * 负责：超时控制、参数校验、结果截断、异常捕获。
 * 任何未捕获异常都返回 isError=true，不向上抛出。
 */
export class ToolExecutor {
  /**
   * 执行工具，统一包裹超时/校验/截断/异常处理
   * @param toolName 工具名称（用于超时错误消息）
   * @param tool 目标工具
   * @param args LLM 生成的参数
   * @param ctx 执行上下文
   */
  async execute(
    toolName: string,
    tool: Tool,
    args: Record<string, any>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const timeout = this.resolveTimeout(toolName);

    try {
      // 参数校验（仅检查 required 字段）
      if (tool.parameters?.required?.length) {
        this.validateArgs(args, tool.parameters);
      }

      const result = await this.runWithTimeout(
        tool.execute(args, ctx),
        timeout,
        ctx.signal,
        toolName,
      );

      result.durationMs = Date.now() - startTime;

      // 结果截断
      if (result.content.length > RESULT_TRUNCATE_LIMIT) {
        result.content =
          result.content.slice(0, RESULT_TRUNCATE_LIMIT) + '\n…（已截断，原始结果过长）';
        result.structured = { ...result.structured, truncated: true };
      }

      return result;
    } catch (err) {
      return {
        toolCallId: '',
        content: '',
        isError: true,
        error: {
          message: err instanceof Error ? err.message : String(err),
          code: 'EXECUTION_ERROR',
        },
        durationMs: Date.now() - startTime,
      };
    }
  }

  /** 校验必填参数 */
  private validateArgs(args: Record<string, any>, schema: Record<string, any>): void {
    const required: string[] = schema.required ?? [];
    for (const field of required) {
      if (args[field] === undefined || args[field] === null) {
        throw new Error(`Missing required argument: ${field}`);
      }
    }
  }

  /** 环境变量 TOOL_TIMEOUT_<NAME>（毫秒）可覆盖默认超时（PRD-13 §2.3） */
  private resolveTimeout(toolName: string): number {
    const envValue = parseInt(process.env[`TOOL_TIMEOUT_${toolName.toUpperCase()}`] ?? '', 10);
    if (Number.isFinite(envValue) && envValue > 0) return envValue;
    return DEFAULT_TIMEOUTS[toolName] ?? 5000;
  }

  /** 带超时的 Promise 执行 */
  private runWithTimeout<T>(
    promise: Promise<T>,
    ms: number,
    signal: AbortSignal,
    toolName: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Tool execution aborted'));
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        reject(new Error(`Tool ${toolName} timeout after ${ms}ms`));
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('Tool execution aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (v) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          reject(e);
        },
      );
    });
  }
}
