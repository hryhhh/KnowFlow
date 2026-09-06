/**
 * TraceCollector — 收集单次 Agent 执行的 trace 数据
 *
 * 在内存中记录每一步 LLM 调用、工具调用和最终答案，
 * 最终通过 finalize() 产出完整的 AgentTrace 对象。
 */

export interface AgentTraceStep {
  type: 'llm_call' | 'tool_call' | 'final_answer' | 'memory_load';
  timestamp: number;
  data: Record<string, any>;
}

export interface AgentTraceTokens {
  prompt: number;
  completion: number;
  total: number;
}

export interface AgentTraceSummary {
  totalDurationMs: number;
  llmCalls: number;
  toolCalls: number;
  tokensUsed: AgentTraceTokens;
}

export interface AgentTrace {
  id: string;
  sessionId: string;
  kbId: string;
  query: string;
  status: 'running' | 'completed' | 'failed' | 'truncated';
  startedAt: Date;
  completedAt: Date;
  steps: AgentTraceStep[];
  summary: AgentTraceSummary;
  tokensUsed: AgentTraceTokens;
  errorMsg: string | null;
}

/**
 * TraceCollector — 内存中收集 trace 步骤
 *
 * AGENT_TRACE_ENABLED=false 时仍正常收集（供本地调试），
 * 仅在 finalize 时检查是否持久化。
 */
export class TraceCollector {
  private readonly steps: AgentTraceStep[] = [];
  private readonly tokensUsed: AgentTraceTokens = { prompt: 0, completion: 0, total: 0 };
  private readonly startTime: number;

  constructor(
    private readonly runId: string,
    private readonly traceId: string,
    private readonly kbId: string,
    private readonly sessionId: string,
    private readonly query: string,
  ) {
    this.startTime = Date.now();
  }

  recordLLMCall(model: string, inputTokens: number, outputTokens: number, latencyMs: number): void {
    this.steps.push({
      type: 'llm_call',
      timestamp: Date.now(),
      data: { model, inputTokens, outputTokens, latencyMs },
    });
    this.tokensUsed.prompt += inputTokens;
    this.tokensUsed.completion += outputTokens;
    this.tokensUsed.total += inputTokens + outputTokens;
  }

  recordToolCall(
    toolName: string,
    input: any,
    output: string | null,
    durationMs: number,
    isError: boolean,
  ): void {
    this.steps.push({
      type: 'tool_call',
      timestamp: Date.now(),
      data: { toolName, input, durationMs, isError, outputLength: output?.length ?? 0 },
    });
  }

  recordFinalAnswer(answer: string): void {
    this.steps.push({
      type: 'final_answer',
      timestamp: Date.now(),
      data: { answerLength: answer.length },
    });
  }

  recordMemoryLoad(messageCount: number): void {
    this.steps.push({
      type: 'memory_load',
      timestamp: Date.now(),
      data: { messageCount },
    });
  }

  /**
   * 终结 trace，产出完整的 AgentTrace 对象
   * @param status 执行状态
   * @param errorMsg 错误信息（失败时有值）
   */
  finalize(status: 'completed' | 'failed' | 'truncated', errorMsg?: string): AgentTrace {
    const now = new Date();
    return {
      id: this.runId,
      sessionId: this.sessionId,
      kbId: this.kbId,
      query: this.query,
      status,
      startedAt: new Date(this.startTime),
      completedAt: now,
      steps: this.steps,
      summary: {
        totalDurationMs: now.getTime() - this.startTime,
        llmCalls: this.steps.filter((s) => s.type === 'llm_call').length,
        toolCalls: this.steps.filter((s) => s.type === 'tool_call').length,
        tokensUsed: { ...this.tokensUsed },
      },
      tokensUsed: { ...this.tokensUsed },
      errorMsg: errorMsg ?? null,
    };
  }
}
