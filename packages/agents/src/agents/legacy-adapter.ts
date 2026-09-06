import type { Agent, AgentParams, AgentResult } from '../types';
import type { Tool, ToolContext, ToolResult } from '../tools/base-tool';

/**
 * LegacyAgentAdapter — 将现有 Agent 实现包装为 Tool
 *
 * 当 AGENT_RUNTIME_ENABLED=true 但某个 Tool 的专用实现尚未就绪时，
 * 用此适配器临时包装现有 Agent，作为降级路径。
 */
export class LegacyAgentAdapter implements Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters = {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  };

  constructor(
    private readonly agent: Agent,
    toolName: string,
    description: string,
  ) {
    this.name = toolName;
    this.description = description;
  }

  async execute(args: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    const result: AgentResult = await this.agent.execute({
      query: args.query,
      kbId: ctx.kbId,
      traceId: ctx.runId,
    });

    return {
      toolCallId: '',
      content: result.content,
      isError: result.status === 'error' || result.status === 'timeout',
      error: result.error
        ? { message: result.error.message, code: result.error.code ?? 'AGENT_ERROR' }
        : undefined,
      structured: { status: result.status, sources: result.sources },
    };
  }
}
