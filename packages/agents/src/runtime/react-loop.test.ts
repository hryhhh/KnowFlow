import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReactLoop } from './react-loop';
import { AgentContext } from './agent-context';
import { ToolRegistry } from '../tools/tool-registry';

// ---- helpers ----

function makeMockTool(name: string) {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {}, required: [] },
    execute: vi.fn().mockResolvedValue({
      toolCallId: 'tc-1',
      content: `${name} result`,
      isError: false,
      durationMs: 10,
    }),
  };
}

function createContext(overrides: Partial<Parameters<typeof AgentContext.create>[0]> = {}) {
  const registry = new ToolRegistry();
  registry.register(makeMockTool('test_tool'));

  return AgentContext.create({
    query: 'hello',
    kbId: 'kb-1',
    sessionId: 'sess-1',
    traceId: 'trace-1',
    messages: [],
    searchParams: {},
    llmConfig: { apiKey: 'key', model: 'gpt-4', baseURL: '' },
    tools: registry,
    emitEvent: vi.fn(),
    ...overrides,
  });
}

/** 构造 OpenAI Chat Completions 响应体 */
function buildResponse(body: unknown) {
  return JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'gpt-4',
    choices: [{ index: 0, message: body, finish_reason: 'tool_calls' as any }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  });
}

/** 创建带自定义 fetch 的 TestableReactLoop */
class TestableReactLoop extends ReactLoop {
  private readonly fetchFn: () => Promise<Response>;
  private callCount = 0;

  constructor(fetchFn: () => Promise<Response>, maxRounds?: number) {
    super(maxRounds);
    this.fetchFn = fetchFn;
  }

  protected async callLLM(messages: any, context: any): Promise<any> {
    // 复用父类的构建逻辑，但替换 fetch
    const startTime = Date.now();
    const baseURL = context.llmConfig.baseURL
      ? context.llmConfig.baseURL.replace(/\/$/, '')
      : 'https://api.openai.com';
    const response = await this.fetchFn();
    const data = await response.json();
    const choice = data.choices?.[0];
    const latencyMs = Date.now() - startTime;

    const toolCalls = (choice?.message?.tool_calls ?? [])
      .filter((tc: any) => !!tc?.function?.name)
      .map((tc: any) => ({
        id: tc.id,
        toolName: tc.function.name,
        arguments:
          typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments,
      }));

    const rawUsage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
    this.callCount++;

    return {
      content: choice?.message?.content ?? '',
      toolCalls,
      model: context.llmConfig.model,
      inputTokens: rawUsage.prompt_tokens ?? 0,
      outputTokens: rawUsage.completion_tokens ?? 0,
      latencyMs,
    };
  }
}

// ---- tests ----

describe('ReactLoop', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function makeLoop(fetchFn: () => Promise<Response>, maxRounds?: number): TestableReactLoop {
    return new TestableReactLoop(fetchFn, maxRounds);
  }

  it('LLM 无 tool_call → 返回 completed + finalAnswer', async () => {
    let callCount = 0;
    const fetchFn = () => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            JSON.parse(
              buildResponse({
                role: 'assistant',
                content: '最终答案',
                tool_calls: undefined,
              }),
            ),
          ),
        text: () => Promise.resolve(''),
      } as Response);
    };

    const loop = makeLoop(fetchFn);
    const ctx = createContext();
    const result = await loop.execute(ctx);

    expect(result.status).toBe('completed');
    expect(result.finalAnswer).toBe('最终答案');
    expect(ctx.state.round).toBe(1);
    expect(ctx.trace.steps).toHaveLength(2);
    expect(ctx.trace.steps[0].type).toBe('llm_call');
    expect(ctx.trace.steps[1].type).toBe('final_answer');
  });

  it('LLM 有 tool_call → 执行工具并继续下一轮', async () => {
    let callCount = 0;
    const fetchFn = () => {
      callCount++;
      const body =
        callCount === 1
          ? {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'tc-1',
                  function: { name: 'test_tool', arguments: JSON.stringify({ query: 'search' }) },
                },
              ],
            }
          : { role: 'assistant', content: '答案来自工具', tool_calls: undefined };
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(JSON.parse(buildResponse(body))),
        text: () => Promise.resolve(''),
      } as Response);
    };

    const loop = makeLoop(fetchFn);
    const ctx = createContext();
    const result = await loop.execute(ctx);

    expect(result.status).toBe('completed');
    expect(result.finalAnswer).toBe('答案来自工具');
    expect(ctx.state.round).toBe(2);
    expect(ctx.trace.steps.map((s) => s.type)).toEqual([
      'llm_call',
      'tool_call',
      'llm_call',
      'final_answer',
    ]);
  });

  it('LLM 连续多次 tool_call → 超出 maxRounds 返回 truncated', async () => {
    let callCount = 0;
    const fetchFn = () => {
      callCount++;
      const body = {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: `tc-${callCount}`, function: { name: 'test_tool', arguments: JSON.stringify({}) } },
        ],
      };
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(JSON.parse(buildResponse(body))),
        text: () => Promise.resolve(''),
      } as Response);
    };

    const loop = makeLoop(fetchFn, 3);
    const ctx = createContext();
    const result = await loop.execute(ctx);

    expect(result.status).toBe('truncated');
    expect(ctx.state.round).toBe(3);
    // 3 轮 × 2 步（llm_call + tool_call）= 6 条，加收尾调用 llm_call + final_answer = 8 条
    expect(ctx.trace.steps).toHaveLength(8);
    // 收尾 mock 仍返回 tool_calls（content 为空）→ finalAnswer 走固定提示而非原始工具输出
    expect(result.finalAnswer).toContain('已达最大推理轮数');
  });

  it('signal.aborted → 立即返回 aborted', async () => {
    const ctx = createContext();
    const controller = new AbortController();
    controller.abort();
    (ctx as any).signal = controller.signal;

    const loop = makeLoop(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
      } as Response),
    );

    const result = await loop.execute(ctx);

    expect(result.status).toBe('aborted');
    expect(result.finalAnswer).toBe('');
    // callLLM 不应被调用（提前返回）
    expect(loop['callCount']).toBe(0);
  });

  it('未知工具 → 生成占位错误结果并继续循环（保证 tool 消息配对）', async () => {
    let callCount = 0;
    const fetchFn = () => {
      callCount++;
      const body =
        callCount === 1
          ? {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'tc-1', function: { name: 'unknown_tool', arguments: JSON.stringify({}) } },
              ],
            }
          : { role: 'assistant', content: '答案', tool_calls: undefined };
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(JSON.parse(buildResponse(body))),
        text: () => Promise.resolve(''),
      } as Response);
    };

    const emitSpy = vi.fn();
    const loop = makeLoop(fetchFn);
    const ctx = createContext({ emitEvent: emitSpy });
    const result = await loop.execute(ctx);

    expect(result.status).toBe('completed');
    expect(result.finalAnswer).toBe('答案');
    // 占位结果不算实际执行
    expect(ctx.state.toolCallCount).toBe(0);
    // trace 记录 isError 的 tool_call，便于排查
    const toolSteps = ctx.trace.steps.filter((s) => s.type === 'tool_call');
    expect(toolSteps).toHaveLength(1);
    expect(toolSteps[0].data.isError).toBe(true);
    expect(toolSteps[0].data.toolName).toBe('unknown_tool');
    // 前端收到 isError 的 tool_result 事件
    const toolResultEvent = emitSpy.mock.calls
      .map((c) => c[0])
      .find((e) => e.type === 'tool_result');
    expect(toolResultEvent.data.isError).toBe(true);
  });

  it('LLM 返回 tool_calls 且附带文本时推送 reasoning_summary', async () => {
    let callCount = 0;
    const fetchFn = () => {
      callCount++;
      const body =
        callCount === 1
          ? {
              role: 'assistant',
              content: '我需要先查询知识库',
              tool_calls: [
                {
                  id: 'tc-1',
                  function: { name: 'test_tool', arguments: JSON.stringify({ query: 'x' }) },
                },
              ],
            }
          : { role: 'assistant', content: '答案', tool_calls: undefined };
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(JSON.parse(buildResponse(body))),
        text: () => Promise.resolve(''),
      } as Response);
    };

    const emitSpy = vi.fn();
    const loop = makeLoop(fetchFn);
    const ctx = createContext({ emitEvent: emitSpy });
    await loop.execute(ctx);

    const summaryEvents = emitSpy.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === 'reasoning_summary');
    expect(summaryEvents).toHaveLength(1);
    expect(summaryEvents[0].data.summary).toBe('我需要先查询知识库');
  });

  it('工具结果包含 structured.sources 时推送 sources 事件', async () => {
    let callCount = 0;
    const fetchFn = () => {
      callCount++;
      const body =
        callCount === 1
          ? {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'tc-1',
                  function: { name: 'rag_search', arguments: JSON.stringify({ query: 'x' }) },
                },
              ],
            }
          : { role: 'assistant', content: '答案', tool_calls: undefined };
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(JSON.parse(buildResponse(body))),
        text: () => Promise.resolve(''),
      } as Response);
    };

    const registry = new ToolRegistry();
    registry.register({
      name: 'rag_search',
      description: 'rag tool',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn().mockResolvedValue({
        toolCallId: 'tc-1',
        content: '检索结果',
        isError: false,
        structured: { count: 1, sources: [{ sourceFile: 'a.pdf', score: 0.9 }] },
      }),
    });
    const emitSpy = vi.fn();
    const loop = makeLoop(fetchFn);
    const ctx = createContext({ tools: registry, emitEvent: emitSpy });
    await loop.execute(ctx);

    const sourcesEvents = emitSpy.mock.calls.map((c) => c[0]).filter((e) => e.type === 'sources');
    expect(sourcesEvents).toHaveLength(1);
    expect(sourcesEvents[0].data.sources).toEqual([{ sourceFile: 'a.pdf', score: 0.9 }]);
  });

  // ---- 真实 callLLM（mock 全局 fetch）：重试与容错 ----

  it('畸形 arguments JSON 不崩溃，工具消息正确配对（真实 callLLM）', async () => {
    let call = 0;
    const bodies = [
      buildResponse({
        role: 'assistant',
        content: '查询中',
        tool_calls: [{ id: 'tc-1', function: { name: 'test_tool', arguments: '{bad json' } }],
      }),
      buildResponse({ role: 'assistant', content: '最终答案', tool_calls: undefined }),
    ];
    const fetchMock = vi.fn().mockImplementation(() => {
      const body = bodies[call++];
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(JSON.parse(body)),
        text: () => Promise.resolve(''),
      } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    const loop = new ReactLoop();
    const ctx = createContext();
    const result = await loop.execute(ctx);

    expect(result.status).toBe('completed');
    expect(result.finalAnswer).toBe('最终答案');
    // 第二轮请求中 tc-1 必须有配对的 role:'tool' 消息（OpenAI 协议要求）
    const secondRequest = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(
      secondRequest.messages.some((m: any) => m.role === 'tool' && m.tool_call_id === 'tc-1'),
    ).toBe(true);
  });

  it('LLM 500 后自动重试一次并成功（真实 callLLM）', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('server error'),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            JSON.parse(
              buildResponse({ role: 'assistant', content: '重试后成功', tool_calls: undefined }),
            ),
          ),
        text: () => Promise.resolve(''),
      } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const loop = new ReactLoop();
    const ctx = createContext();
    const result = await loop.execute(ctx);

    expect(result.status).toBe('completed');
    expect(result.finalAnswer).toBe('重试后成功');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('LLM 404 触发重试，重试仍失败则整次运行报错（真实 callLLM）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve(''),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const loop = new ReactLoop();
    const ctx = createContext();
    await expect(loop.execute(ctx)).rejects.toThrow('LLM API error 404');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('LLM 400 先定向重试一次（去 stream_options），仍 400 则失败（真实 callLLM）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('bad request'),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const loop = new ReactLoop();
    const ctx = createContext();
    await expect(loop.execute(ctx)).rejects.toThrow('LLM API error 400');
    // 第一次含 stream_options 400 后，定向重试一次（去掉 stream_options），仍 400 则放弃
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).stream_options).toBeUndefined();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).stream).toBe(true);
  });

  it('AGENT_LLM_STREAMING=false 时 400 不重试，直接失败（真实 callLLM）', async () => {
    vi.stubEnv('AGENT_LLM_STREAMING', 'false');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('bad request'),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const loop = new ReactLoop();
    const ctx = createContext();
    await expect(loop.execute(ctx)).rejects.toThrow('LLM API error 400');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBeUndefined();
  });

  it('AGENT_LLM_STREAMING=false 时请求体不含 stream 字段（真实 callLLM）', async () => {
    vi.stubEnv('AGENT_LLM_STREAMING', 'false');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve(
          JSON.parse(
            buildResponse({ role: 'assistant', content: '非流式答案', tool_calls: undefined }),
          ),
        ),
      text: () => Promise.resolve(''),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const loop = new ReactLoop();
    const ctx = createContext();
    const result = await loop.execute(ctx);

    expect(result.status).toBe('completed');
    expect(result.finalAnswer).toBe('非流式答案');
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody.stream).toBeUndefined();
  });

  it('tool_calls: [] → 视为无 tool_call，返回 completed', async () => {
    const fetchFn = () =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            JSON.parse(
              buildResponse({
                role: 'assistant',
                content: '直接回答',
                tool_calls: [],
              }),
            ),
          ),
        text: () => Promise.resolve(''),
      } as Response);

    const loop = makeLoop(fetchFn);
    const ctx = createContext();
    const result = await loop.execute(ctx);

    expect(result.status).toBe('completed');
    expect(result.finalAnswer).toBe('直接回答');
  });
});

// ---- 流式解析（真实 callLLM + SSE mock）----

describe('ReactLoop 流式解析', () => {
  beforeEach(() => {
    process.env.AGENT_REACT_MAX_ROUNDS = '3';
  });

  afterEach(() => {
    delete process.env.AGENT_REACT_MAX_ROUNDS;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** 构造 OpenAI SSE 响应（content-type: text/event-stream），body 按 chunk 分片送达 */
  function sseResponse(bodies: string[]): Response {
    const encoder = new TextEncoder();
    const queue = bodies.map((b) => encoder.encode(b));
    const reader = {
      read: () =>
        Promise.resolve(
          queue.length ? { done: false, value: queue.shift() } : { done: true, value: undefined },
        ),
      cancel: () => Promise.resolve(),
      releaseLock: () => {},
    };
    return {
      ok: true,
      status: 200,
      headers: {
        get: (key: string) => (key.toLowerCase() === 'content-type' ? 'text/event-stream' : null),
      },
      body: { getReader: () => reader },
    } as unknown as Response;
  }

  function jsonStreamingDisabledResponse(body: object): Response {
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(''),
    } as unknown as Response;
  }

  function sseEvents(events: object[]): string {
    return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
  }

  function delta(content?: string, toolCalls?: any[]) {
    return {
      choices: [
        {
          delta: {
            ...(content !== undefined && { content }),
            ...(toolCalls && { tool_calls: toolCalls }),
          },
        },
      ],
    };
  }

  it('纯文本流：answer_delta 逐片发出，无 answer_reset，答案完整', async () => {
    const body = sseEvents([delta('你'), delta('好'), delta('，世界')]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([body])));

    const emitSpy = vi.fn();
    const loop = new ReactLoop();
    const ctx = createContext({ emitEvent: emitSpy });
    const result = await loop.execute(ctx);

    expect(result.status).toBe('completed');
    expect(result.finalAnswer).toBe('你好，世界');
    const deltas = emitSpy.mock.calls.map((c) => c[0]).filter((e) => e.type === 'answer_delta');
    expect(deltas.map((e) => e.data.delta)).toEqual(['你', '好', '，世界']);
    expect(emitSpy.mock.calls.map((c) => c[0]).some((e) => e.type === 'answer_reset')).toBe(false);
  });

  it('跨 chunk 截断的 SSE 行正确缓冲重组', async () => {
    const full = sseEvents([delta('片段一'), delta('片段二')]);
    const mid = Math.floor(full.length / 2);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(sseResponse([full.slice(0, mid), full.slice(mid)])),
    );

    const loop = new ReactLoop();
    const ctx = createContext();
    const result = await loop.execute(ctx);

    expect(result.finalAnswer).toBe('片段一片段二');
  });

  it('流式 tool_calls 按 index 分片聚合 arguments', async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve(
          sseResponse([
            sseEvents([
              delta(undefined, [
                { index: 0, id: 'tc-1', function: { name: 'test_tool', arguments: '' } },
              ]),
              delta(undefined, [{ index: 0, function: { arguments: '{"qu' } }]),
              delta(undefined, [{ index: 0, function: { arguments: 'ery":"x"}' } }]),
            ]),
          ]),
        );
      }
      // 第二轮回非流式 JSON（无 content-type）→ 走非流式解析
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            JSON.parse(
              buildResponse({ role: 'assistant', content: '答案', tool_calls: undefined }),
            ),
          ),
        text: () => Promise.resolve(''),
      } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    const emitSpy = vi.fn();
    const loop = new ReactLoop();
    const ctx = createContext({ emitEvent: emitSpy });
    const result = await loop.execute(ctx);

    expect(result.status).toBe('completed');
    expect(result.finalAnswer).toBe('答案');
    const toolStep = ctx.trace.steps.find((s: any) => s.type === 'tool_call');
    expect(toolStep.data.input).toEqual({ query: 'x' });
    // 无 content 流出 → 不应补发 answer_reset
    expect(emitSpy.mock.calls.map((c) => c[0]).some((e) => e.type === 'answer_reset')).toBe(false);
  });

  it('工具轮次流出了 content 时补发 answer_reset，且先于 reasoning_summary', async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve(
          sseResponse([
            sseEvents([
              delta('我先查一下'),
              delta(undefined, [
                { index: 0, id: 'tc-1', function: { name: 'test_tool', arguments: '{}' } },
              ]),
            ]),
          ]),
        );
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            JSON.parse(
              buildResponse({ role: 'assistant', content: '答案', tool_calls: undefined }),
            ),
          ),
        text: () => Promise.resolve(''),
      } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    const emitSpy = vi.fn();
    const loop = new ReactLoop();
    const ctx = createContext({ emitEvent: emitSpy });
    await loop.execute(ctx);

    const types = emitSpy.mock.calls.map((c) => c[0].type);
    expect(types).toContain('answer_delta');
    expect(types).toContain('answer_reset');
    expect(types.indexOf('answer_reset')).toBeLessThan(types.indexOf('reasoning_summary'));
    const summary = emitSpy.mock.calls.map((c) => c[0]).find((e) => e.type === 'reasoning_summary');
    expect(summary.data.summary).toBe('我先查一下');
  });

  it('末块 usage 单独到达时 tokens 正确记录', async () => {
    // OpenAI 协议中 usage 汇总块在 [DONE] 之前到达
    const body = sseEvents([
      delta('答案'),
      { choices: [], usage: { prompt_tokens: 123, completion_tokens: 45 } },
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([body])));

    const loop = new ReactLoop();
    const ctx = createContext();
    await loop.execute(ctx);

    expect(ctx.trace.steps[0].data.inputTokens).toBe(123);
    expect(ctx.trace.steps[0].data.outputTokens).toBe(45);
  });

  it('网关对 stream 请求直接回 JSON（content-type: application/json）→ 回退非流式解析', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonStreamingDisabledResponse(
            JSON.parse(
              buildResponse({ role: 'assistant', content: '网关回的 JSON', tool_calls: undefined }),
            ),
          ),
        ),
    );

    const emitSpy = vi.fn();
    const loop = new ReactLoop();
    const ctx = createContext({ emitEvent: emitSpy });
    const result = await loop.execute(ctx);

    expect(result.status).toBe('completed');
    expect(result.finalAnswer).toBe('网关回的 JSON');
    expect(emitSpy.mock.calls.map((c) => c[0]).some((e) => e.type === 'answer_delta')).toBe(false);
  });
});

// ---- truncated 收尾调用 ----

describe('ReactLoop truncated 收尾', () => {
  beforeEach(() => {
    process.env.AGENT_REACT_MAX_ROUNDS = '2';
  });

  afterEach(() => {
    delete process.env.AGENT_REACT_MAX_ROUNDS;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const toolCallJson = () =>
    JSON.parse(
      buildResponse({
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'tc-1', function: { name: 'test_tool', arguments: JSON.stringify({}) } },
        ],
      }),
    );

  it('达到 maxRounds 后发起不带 tools 的收尾调用，finalAnswer 为收尾文本', async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      call++;
      if (call <= 2) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(toolCallJson()),
          text: () => Promise.resolve(''),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            JSON.parse(
              buildResponse({
                role: 'assistant',
                content: '收尾答案，基于资料X',
                tool_calls: undefined,
              }),
            ),
          ),
        text: () => Promise.resolve(''),
      } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    const loop = new ReactLoop();
    const ctx = createContext();
    const result = await loop.execute(ctx);

    expect(result.status).toBe('truncated');
    expect(result.finalAnswer).toBe('收尾答案，基于资料X');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const finalizeBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    // 收尾请求不携带工具定义，且末条消息为收尾指令
    expect(finalizeBody.tools).toBeUndefined();
    const lastMsg = finalizeBody.messages[finalizeBody.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toContain('最大工具调用轮数');
    // trace 记录了收尾 LLM 调用与最终答案
    expect(ctx.trace.steps.some((s: any) => s.type === 'final_answer')).toBe(true);
  });

  it('收尾调用失败时返回固定提示，绝不输出原始工具结果', async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      call++;
      if (call <= 2) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(toolCallJson()),
          text: () => Promise.resolve(''),
        } as Response);
      }
      return Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve('server error'),
      } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    const loop = new ReactLoop();
    const ctx = createContext();
    const result = await loop.execute(ctx);

    expect(result.status).toBe('truncated');
    expect(result.finalAnswer).toContain('已达最大推理轮数');
    expect(result.finalAnswer).not.toContain('test_tool result');
    // 收尾请求 500 触发一次重试后放弃
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('AGENT_TRUNCATED_FINALIZE=false 时不发收尾请求，直接返回固定提示', async () => {
    vi.stubEnv('AGENT_TRUNCATED_FINALIZE', 'false');
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      call++;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(toolCallJson()),
        text: () => Promise.resolve(''),
      } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    const loop = new ReactLoop();
    const ctx = createContext();
    const result = await loop.execute(ctx);

    expect(result.status).toBe('truncated');
    expect(result.finalAnswer).toContain('已达最大推理轮数');
    expect(fetchMock).toHaveBeenCalledTimes(2); // 仅两轮工具调用，无收尾请求
  });
});
