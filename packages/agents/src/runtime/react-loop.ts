import type { ToolRegistry } from '../tools/tool-registry';
import type { ToolCall, ToolResult } from '../tools/base-tool';
import { ToolExecutor } from '../tools/tool-executor';
import type { AgentContext } from './agent-context';
import type { LLMResponse } from '../types';
import type { ChatMessage } from './agent-context';
import { parsePositiveInt, sleep } from '../utils';
import { RUNTIME_DEFAULTS } from './runtime-defaults';

/** OpenAI Chat Completions 非流式响应体（流式路径聚合完成后整形为同构结构复用解析） */
interface OpenAIChatResponse {
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
}
/**
 * ReactLoop — ReAct 推理循环
 *
 * 循环执行：LLM 推理 → 提取 tool_calls → 执行工具 → 追加消息 → 重复
 * 直到 LLM 不再请求工具调用（返回最终答案）或达到 maxRounds 上限。
 *
 * 直接调用 OpenAI API，不依赖 @langchain/core。
 */
export class ReactLoop {
  constructor(
    /** ReAct 最大推理轮数，缺省取 RUNTIME_DEFAULTS.maxRounds（测试注入更小值以验证截断路径） */
    private readonly maxRounds: number = RUNTIME_DEFAULTS.maxRounds,
  ) {}

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

      // 流式路径中，工具轮次的 content 分片已作为 answer_delta 推进了前端答案区；
      // 确认本轮是工具调用后补发 answer_reset 让前端清空答案区，
      // 文本随后由 reasoning_summary 事件重新呈现
      if (toolCalls.length > 0 && llmResponse.streamedContent) {
        context.emitEvent({ type: 'answer_reset', timestamp: Date.now() });
      }

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

    // 达到 maxRounds 上限：发起收尾调用，基于已检索资料作答，
    // 而不是把最后一个工具的原始输出当答案
    return this.finalizeTruncated(messages, context);
  }

  /**
   * truncated 收尾：追加收尾指令后发起一次不带 tools 的 LLM 调用，
   * 强制模型仅依据已检索到的资料作答（流式，answer_delta 正常推出）。
   * 收尾失败或被 AGENT_TRUNCATED_FINALIZE=false 关闭时返回固定提示，
   * 任何情况下不再把原始工具结果当答案返回。
   */
  private async finalizeTruncated(
    messages: ChatMessage[],
    context: AgentContext,
  ): Promise<{ status: 'truncated' | 'aborted'; finalAnswer: string; context: AgentContext }> {
    const fallbackNotice = '已达最大推理轮数，未能完成回答。请调整问题后重试。';

    if (context.signal.aborted) {
      return { status: 'aborted', finalAnswer: '', context };
    }

    if (process.env.AGENT_TRUNCATED_FINALIZE === 'false') {
      return { status: 'truncated', finalAnswer: fallbackNotice, context };
    }

    try {
      const finalizeMessages: ChatMessage[] = [
        ...messages,
        {
          role: 'user',
          content:
            '已达到最大工具调用轮数。请仅根据以上检索到的资料，直接回答用户最初提出的问题；' +
            '如资料不足以完整回答，请说明已确认的部分与缺失的部分，不要编造。',
        },
      ];
      const llmResponse = await this.callLLM(finalizeMessages, context, { includeTools: false });
      context.trace.recordLLMCall(
        llmResponse.model,
        llmResponse.inputTokens,
        llmResponse.outputTokens,
        llmResponse.latencyMs,
      );
      context.state.totalTokens += llmResponse.inputTokens + llmResponse.outputTokens;

      const answer = llmResponse.content.trim();
      context.trace.recordFinalAnswer(answer);
      return { status: 'truncated', finalAnswer: answer || fallbackNotice, context };
    } catch (_err) {
      // 收尾调用失败也不能把原始工具结果吐给用户
      return { status: 'truncated', finalAnswer: fallbackNotice, context };
    }
  }

  /**
   * 调用 OpenAI Chat Completions API（默认流式，AGENT_LLM_STREAMING=false 时回退非流式）
   * 兼容第三方兼容 OpenAI 协议的 LLM 服务（通过 baseURL 配置）。
   *
   * 流式路径：content 分片即时通过 answer_delta 事件推出，实现答案逐字输出；
   * 部分网关对 stream 请求仍返回 JSON（content-type 非 text/event-stream），自动走非流式解析。
   *
   * @param options.includeTools 请求是否携带工具定义（truncated 收尾调用传 false，强制文本作答）
   *
   * protected 访问修饰符便于测试时覆盖。
   */
  protected async callLLM(
    messages: ChatMessage[],
    context: AgentContext,
    options?: { includeTools?: boolean },
  ): Promise<LLMResponse> {
    const startTime = Date.now();

    const baseURL = context.llmConfig.baseURL
      ? context.llmConfig.baseURL.replace(/\/$/, '')
      : 'https://api.openai.com';

    // 避免 baseURL 已含 /v1 时重复拼接（如阿里云百炼：.../compatible-mode/v1）
    const apiBase = baseURL.endsWith('/v1') ? baseURL : `${baseURL}/v1`;

    // 单轮 LLM 调用超时（默认 15s，不超过整体超时）。
    // 流式路径下该超时只约束首块到达（TTFB），流开始后由流式整体上限接管
    const roundTimeout = Math.min(15_000, RUNTIME_DEFAULTS.timeoutMs);
    const roundController = new AbortController();
    const roundTimer = setTimeout(() => roundController.abort(), roundTimeout);
    const onOverallAbort = () => roundController.abort();
    context.signal.addEventListener('abort', onOverallAbort, { once: true });

    const streamingEnabled = process.env.AGENT_LLM_STREAMING !== 'false';
    const includeTools = options?.includeTools ?? true;
    const payload: Record<string, unknown> = {
      model: context.llmConfig.model,
      messages: messages as any,
      temperature: 0.3,
    };
    if (includeTools) {
      payload.tools = context.tools.getAllDefinitions().map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }
    if (streamingEnabled) {
      payload.stream = true;
      payload.stream_options = { include_usage: true };
    }

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${context.llmConfig.apiKey}`,
    };

    try {
      let response = await this.fetchChatCompletionsWithRetry(
        apiBase,
        headers,
        JSON.stringify(payload),
        roundController.signal,
      );

      // 部分 OpenAI 兼容服务不支持 stream_options（400），去掉该字段定向重试一次
      if (!response.ok && response.status === 400 && payload.stream_options) {
        delete payload.stream_options;
        response = await this.fetchChatCompletionsWithRetry(
          apiBase,
          headers,
          JSON.stringify(payload),
          roundController.signal,
        );
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LLM API error ${response.status}: ${text}`);
      }

      const contentType = response.headers?.get?.('content-type') ?? '';
      if (streamingEnabled && contentType.includes('text/event-stream')) {
        return await this.consumeStreamResponse(response, context, startTime, roundTimer);
      }

      const data = (await response.json()) as OpenAIChatResponse;
      return this.toLLMResponse(data, context, startTime, false);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('LLM API error')) throw err;
      throw new Error(`LLM 调用失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(roundTimer);
      context.signal.removeEventListener('abort', onOverallAbort);
    }
  }

  /**
   * 消费 OpenAI SSE 流式响应：按行解析 data 分片，增量拼接 content 与 tool_calls
   * （流式 tool_calls 的 arguments 按 index 分段到达，需聚合后解析）。
   * content 分片即时通过 answer_delta 事件推出。
   */
  private async consumeStreamResponse(
    response: Response,
    context: AgentContext,
    startTime: number,
    ttfbTimer: NodeJS.Timeout,
  ): Promise<LLMResponse> {
    const reader = response.body?.getReader?.();
    if (!reader) throw new Error('LLM 流式响应体不可读');

    // 首块到达后 TTFB 超时不再适用，改用流式整体上限（默认 60s）
    const streamTimeoutMs = parsePositiveInt(process.env.AGENT_LLM_STREAM_TIMEOUT_MS, 60_000);
    let streamTimer: NodeJS.Timeout | null = null;

    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let finished = false;
    // 流式 tool_calls 按 index 分片到达，聚合后再解析
    const toolCallAcc = new Map<number, { id: string; name: string; args: string }>();
    let usage = { prompt_tokens: 0, completion_tokens: 0 };

    try {
      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!streamTimer) {
          clearTimeout(ttfbTimer);
          streamTimer = setTimeout(() => {
            reader.cancel().catch(() => {});
          }, streamTimeoutMs);
        }
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') {
            finished = true;
            break;
          }
          let chunk: {
            usage?: { prompt_tokens?: number; completion_tokens?: number };
            choices?: Array<{ delta?: { content?: string | null; tool_calls?: any[] } }>;
          };
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue; // 忽略无法解析的行（部分网关心跳/注释行）
          }
          if (chunk?.usage) {
            usage = {
              prompt_tokens: chunk.usage.prompt_tokens ?? 0,
              completion_tokens: chunk.usage.completion_tokens ?? 0,
            };
          }
          const delta = chunk?.choices?.[0]?.delta;
          if (delta?.content) {
            content += delta.content;
            context.emitEvent({
              type: 'answer_delta',
              timestamp: Date.now(),
              data: { delta: delta.content },
            });
          }
          if (Array.isArray(delta?.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = typeof tc.index === 'number' ? tc.index : 0;
              const acc = toolCallAcc.get(idx) ?? { id: '', name: '', args: '' };
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name += tc.function.name;
              if (typeof tc.function?.arguments === 'string') acc.args += tc.function.arguments;
              toolCallAcc.set(idx, acc);
            }
          }
        }
      }
    } finally {
      if (streamTimer) clearTimeout(streamTimer);
      reader.releaseLock();
    }

    const rawToolCalls = [...toolCallAcc.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, acc]) => acc.name)
      .map(([index, acc]) => ({
        id: acc.id || `stream-tc-${index}`,
        function: { name: acc.name, arguments: acc.args },
      }));

    // 复用非流式的响应整形路径；usage 缺失时为 0（与现状一致）。
    // streamedContent 仅在本轮确有 content 分片流出时为 true，
    // 纯工具调用流（无文本）无需前端清空答案区
    const streamData = {
      choices: [{ message: { role: 'assistant', content, tool_calls: rawToolCalls } }],
      usage,
    };
    return this.toLLMResponse(streamData, context, startTime, content.length > 0);
  }

  /** 剥离 OpenAI 响应壳，映射 LLMResponse；非法 arguments JSON 降级为占位参数交由工具校验报错 */
  private toLLMResponse(
    data: {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id?: string;
            function?: { name?: string; arguments?: string | object };
          }>;
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    },
    context: AgentContext,
    startTime: number,
    streamedContent: boolean,
  ): LLMResponse {
    const choice = data.choices?.[0];
    const latencyMs = Date.now() - startTime;

    const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? [])
      .filter(
        (tc): tc is { id?: string; function: { name: string; arguments: string | object } } =>
          !!tc?.function?.name,
      )
      .map((tc, i) => {
        let args: Record<string, any>;
        try {
          args =
            typeof tc.function.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : (tc.function.arguments ?? {});
        } catch {
          args = { __invalid_arguments: tc.function.arguments };
        }
        return { id: tc.id || `tc-${i}`, toolName: tc.function.name, arguments: args };
      });

    const rawUsage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };

    return {
      content: choice?.message?.content ?? '',
      toolCalls,
      model: context.llmConfig.model,
      inputTokens: rawUsage.prompt_tokens ?? 0,
      outputTokens: rawUsage.completion_tokens ?? 0,
      latencyMs,
      streamedContent,
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
