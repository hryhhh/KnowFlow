import { randomUUID } from 'node:crypto';
import type { ToolRegistry } from '../tools/tool-registry';
import type { AgentEvent, AgentRunParams, LLMConfig } from '../types';
import { TraceCollector } from '../observability/trace-collector';
import { parsePositiveInt } from '../utils';

/** 一条聊天消息（plain object，与 OpenAI API 格式一致） */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

/**
 * AgentContext — ReAct 循环的运行时上下文
 *
 * 负责初始化：runId 生成、AbortController 超时、消息构建、System prompt 构建。
 */
export class AgentContext {
  readonly runId: string;
  readonly sessionId: string;
  readonly kbId: string;
  readonly traceId: string;
  readonly messages: ChatMessage[];
  readonly state: { round: number; toolCallCount: number; totalTokens: number };
  readonly signal: AbortSignal;
  readonly tools: ToolRegistry;
  readonly llmConfig: LLMConfig;
  readonly emitEvent: (event: AgentEvent) => void;
  readonly trace: TraceCollector;

  private constructor(params: AgentRunParams) {
    this.runId = randomUUID();

    // 创建 AbortController，绑定整体超时
    const timeoutMs = parsePositiveInt(process.env.AGENT_RUNTIME_TIMEOUT_MS, 30000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    controller.signal.addEventListener('abort', () => clearTimeout(timer));
    this.signal = controller.signal;

    this.sessionId = params.sessionId ?? 'anonymous';
    this.kbId = params.kbId;
    this.traceId = params.traceId;
    this.tools = params.tools as ToolRegistry;
    this.llmConfig = params.llmConfig;
    this.emitEvent = params.emitEvent;

    // 构建消息列表
    this.messages = this.buildMessages(params);

    // 运行状态
    this.state = { round: 0, toolCallCount: 0, totalTokens: 0 };

    // Trace 收集器
    this.trace = new TraceCollector(
      this.runId,
      this.traceId,
      this.kbId,
      this.sessionId,
      params.query,
    );
  }

  /** 静态工厂方法 */
  static create(params: AgentRunParams): AgentContext {
    return new AgentContext(params);
  }

  private buildMessages(params: AgentRunParams): ChatMessage[] {
    const systemPrompt = this.buildSystemPrompt(params.kbId, params.tools);
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

    // 注入对话历史
    for (const msg of params.messages) {
      messages.push({ role: msg.role, content: msg.content });
    }

    // 当前查询
    messages.push({ role: 'user', content: params.query });

    return messages;
  }

  private buildSystemPrompt(kbId: string, tools: ToolRegistry): string {
    const toolDefs = tools.getAllDefinitions();
    const toolDesc = toolDefs.map((t) => `- ${t.name}: ${t.description}`).join('\n');

    return [
      '你是一个智能助手，可以调用工具来获取信息和完成任务。',
      '你拥有以下工具：',
      toolDesc || '（暂无可用工具）',
      '请根据用户问题，自主决定调用哪些工具、调用几次，直到收集到足够信息后给出最终答案。',
      '如果工具调用无法获得有用信息，请直接告知用户并说明原因。',
      `当前知识库 ID: ${kbId}`,
    ].join('\n');
  }
}
