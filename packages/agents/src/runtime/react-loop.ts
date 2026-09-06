import type { ToolRegistry } from '../tools/tool-registry';
import type { ToolCall, ToolResult } from '../tools/base-tool';
import { ToolExecutor } from '../tools/tool-executor';
import type { AgentContext } from './agent-context';
import type { LLMResponse } from '../types';
import type { ChatMessage } from './agent-context';
import { parsePositiveInt, sleep } from '../utils';
/**
 * ReactLoop — ReAct 推理循环
 *
 * 循环执行：LLM 推理 → 提取 tool_calls → 执行工具 → 追加消息 → 重复
 * 直到 LLM 不再请求工具调用（返回最终答案）或达到 maxRounds 上限。
 *
 * 直接调用 OpenAI API，不依赖 @langchain/core。
 */
export class ReactLoop {
  private readonly maxRounds: number;

  constructor() {
    this.maxRounds = parsePositiveInt(process.env.AGENT_REACT_MAX_ROUNDS, 5);
  }

  async execute(context: AgentContext): Promise<{
    status: 'completed' | 'truncated' | 'aborted';
    finalAnswer: string;
    context: AgentContext;
  }> {
    let messages: ChatMessage[] = context.messages;

    for (let round = 0; round < this.maxRounds; round++) {
      context.state.round = round + 1;

      if (context.signal.aborted) {
        return { status: 'aborted', finalAnswer: '', context };
      }

      // 1. 调用 LLM
      const llmResponse = await this.callLLM(messages, context);
      context.trace.recordLLMCall(
        llmResponse.model,
        llmResponse.inputTokens,
        llmResponse.outputTokens,
        llmResponse.latencyMs,
      );
      context.state.totalTokens += llmResponse.inputTokens + llmResponse.outputTokens;

      const toolCalls = llmResponse.toolCalls;

      // LLM 决定调用工具时附带的文本即其推理说明（PRD-15：reasoning_summary）
      if (toolCalls.length > 0 && llmResponse.content) {
        context.emitEvent({
          type: 'reasoning_summary',
          timestamp: Date.now(),
          data: { summary: llmResponse.content.slice(0, 200) },
        });
      }

      if (toolCalls.length === 0) {
        context.trace.recordFinalAnswer(llmResponse.content);
        return { status: 'completed', finalAnswer: llmResponse.content, context };
      }

      // 2. 执行所有工具调用（串行）
      // 未知工具 / 非法参数都生成占位错误结果而不是跳过：
      // OpenAI 协议要求每个 tool_call 必须有配对的 tool 消息，缺失会导致下一轮请求 400
      const toolResults: Array<{ call: ToolCall; result: ToolResult }> = [];

      for (const toolCall of toolCalls) {
        context.emitEvent({
          type: 'tool_call',
          timestamp: Date.now(),
          data: { toolName: toolCall.toolName, args: toolCall.arguments },
        });

        const tool = context.tools.get(toolCall.toolName);
        let result: ToolResult;
        if (!tool) {
          context.emitEvent({
            type: 'tool_result',
            timestamp: Date.now(),
            data: {
              toolName: toolCall.toolName,
              result: '未知工具',
              durationMs: 0,
              isError: true,
            },
          });
          result = {
            toolCallId: toolCall.id,
            content: `错误：未知工具 "${toolCall.toolName}"。请从可用工具列表中选择后重试。`,
            isError: true,
            error: { message: `Unknown tool: ${toolCall.toolName}`, code: 'UNKNOWN_TOOL' },
            durationMs: 0,
          };
        } else {
          context.state.toolCallCount++;
          const executor = new ToolExecutor();
          result = await executor.execute(toolCall.toolName, tool, toolCall.arguments, {
            runId: context.runId,
            sessionId: context.sessionId,
            kbId: context.kbId,
            signal: context.signal,
            emitEvent: context.emitEvent,
          });
        }

        context.trace.recordToolCall(
          toolCall.toolName,
          toolCall.arguments,
          result.content,
          result.durationMs ?? 0,
          result.isError,
        );

        // 检索类工具把来源列表推给前端（sources 事件）
        const sources = result.structured?.sources;
        if (Array.isArray(sources) && sources.length > 0) {
          context.emitEvent({
            type: 'sources',
            timestamp: Date.now(),
            data: { sources },
          });
        }

        // 推送 tool_result 事件（截断至 200 字符）
        context.emitEvent({
          type: 'tool_result',
          timestamp: Date.now(),
          data: {
            toolName: toolCall.toolName,
            result: result.content.slice(0, 200),
            durationMs: result.durationMs,
            isError: result.isError,
          },
        });

        toolResults.push({ call: toolCall, result });
      }

      // 3. 追加消息到历史
      messages = this.appendToolRound(messages, toolCalls, toolResults);
    }

    const lastContent = messages[messages.length - 1]?.content ?? '';
    return { status: 'truncated', finalAnswer: lastContent, context };
  }

  /**
   * 直接调用 OpenAI Chat Completions API
   * 兼容第三方兼容 OpenAI 协议的 LLM 服务（通过 baseURL 配置）。
   *
   * protected 访问修饰符便于测试时覆盖。
   */
  protected async callLLM(messages: ChatMessage[], context: AgentContext): Promise<LLMResponse> {
    const startTime = Date.now();

    const baseURL = context.llmConfig.baseURL
      ? context.llmConfig.baseURL.replace(/\/$/, '')
      : 'https://api.openai.com';

    // 避免 baseURL 已含 /v1 时重复拼接（如阿里云百炼：.../compatible-mode/v1）
    const apiBase = baseURL.endsWith('/v1') ? baseURL : `${baseURL}/v1`;

    // 单轮 LLM 调用超时（默认 15s，不超过整体超时）
    const roundTimeout = Math.min(
      15_000,
      parsePositiveInt(process.env.AGENT_RUNTIME_TIMEOUT_MS, 30000),
    );
    const roundController = new AbortController();
    const roundTimer = setTimeout(() => roundController.abort(), roundTimeout);
    const onOverallAbort = () => roundController.abort();
    context.signal.addEventListener('abort', onOverallAbort, { once: true });

    let response: Response;
    try {
      response = await this.fetchChatCompletionsWithRetry(
        apiBase,
        {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${context.llmConfig.apiKey}`,
        },
        JSON.stringify({
          model: context.llmConfig.model,
          messages: messages as any,
          temperature: 0.3,
          tools: context.tools.getAllDefinitions().map((t) => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          })),
        }),
        roundController.signal,
      );
    } catch (err) {
      throw new Error(`LLM 调用失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(roundTimer);
      context.signal.removeEventListener('abort', onOverallAbort);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          role: string;
          content: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = data.choices?.[0];
    const latencyMs = Date.now() - startTime;

    // 解析工具调用。LLM 生成的 arguments 可能不是合法 JSON（PRD-15 边界情况），
    // 此时降级为一个标记参数交由工具/参数校验报错，不中断整个 ReAct 循环
    const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? [])
      .filter(
        (tc): tc is { id: string; function: { name: string; arguments: string } } =>
          !!tc?.function?.name,
      )
      .map((tc) => {
        let args: Record<string, any>;
        try {
          args =
            typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : (tc.function.arguments ?? {});
        } catch {
          args = { __invalid_arguments: tc.function.arguments };
        }
        return { id: tc.id, toolName: tc.function.name, arguments: args };
      });

    const rawUsage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };

    return {
      content: choice?.message?.content ?? '',
      toolCalls,
      model: context.llmConfig.model,
      inputTokens: rawUsage.prompt_tokens ?? 0,
      outputTokens: rawUsage.completion_tokens ?? 0,
      latencyMs,
    };
  }

  /**
   * 调用 chat/completions，对网络错误、429、5xx、404 重试 1 次（PRD-12 §六 风险缓解）。
   * 400/422 属请求协议错误，重试无意义，直接返回交由上层抛错。
   */
  private async fetchChatCompletionsWithRetry(
    apiBase: string,
    headers: Record<string, string>,
    body: string,
    signal: AbortSignal,
  ): Promise<Response> {
    const MAX_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (signal.aborted) throw new Error('LLM 调用已中止');
      try {
        const response = await fetch(`${apiBase}/chat/completions`, {
          method: 'POST',
          headers,
          body,
          signal,
        });
        if (response.ok) return response;
        const retryable =
          response.status === 429 || response.status === 404 || response.status >= 500;
        if (!retryable || attempt === MAX_ATTEMPTS) return response;
      } catch (err) {
        // 整体超时/用户中止时不重试
        if (signal.aborted || attempt === MAX_ATTEMPTS) throw err;
      }
      await sleep(500);
    }
    throw new Error('unreachable');
  }

  /**
   * 将工具调用结果追加到消息历史
   */
  private appendToolRound(
    messages: ChatMessage[],
    toolCalls: ToolCall[],
    results: Array<{ call: ToolCall; result: ToolResult }>,
  ): ChatMessage[] {
    const newMessages = [...messages];

    // assistant 的工具调用消息（新版 OpenAI 格式）
    newMessages.push({
      role: 'assistant',
      content: null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.toolName,
          arguments: JSON.stringify(tc.arguments),
        },
      })),
    });

    // 每个工具的结果消息
    for (const { call, result } of results) {
      newMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result.content,
      });
    }

    return newMessages;
  }
}
