import { describe, it, expect, vi } from 'vitest';
import { ReactLoop } from './react-loop';
import { AgentContext } from './agent-context';
import { ToolRegistry } from '../tools/tool-registry';

/** A2：ReactLoop 收集 rag_search 结果到 context.ragContexts（faithfulness 比对材料） */

function makeMockTool(name: string, content: string) {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {}, required: [] },
    execute: vi.fn().mockResolvedValue({
      toolCallId: 'tc-1',
      content,
      isError: false,
      durationMs: 10,
      structured: { count: 1, sources: [{ sourceFile: 'a.md', score: 0.9 }] },
    }),
  };
}

function createContext(tools: ToolRegistry) {
  return AgentContext.create({
    query: 'hello',
    kbId: 'kb-1',
    sessionId: 'sess-1',
    traceId: 'trace-1',
    messages: [],
    searchParams: {},
    llmConfig: { apiKey: 'key', model: 'gpt-4', baseURL: '' },
    tools,
    emitEvent: vi.fn(),
  });
}

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

class TestableReactLoop extends ReactLoop {
  private readonly responses: Array<unknown>;
  private callIndex = 0;

  constructor(responses: Array<unknown>, maxRounds?: number) {
    super(maxRounds);
    this.responses = responses;
  }

  protected async callLLM(): Promise<any> {
    const body = this.responses[Math.min(this.callIndex++, this.responses.length - 1)];
    return {
      content: (body as any).content ?? '',
      toolCalls: (body as any).toolCalls ?? [],
      model: 'gpt-4',
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 1,
    };
  }
}

describe('ReactLoop ragContexts 收集（A2）', () => {
  it('rag_search 成功结果进入 ragContexts；其他工具与失败结果不进入', async () => {
    const registry = new ToolRegistry();
    registry.register(makeMockTool('rag_search', '[1] 检索片段内容'));
    registry.register(makeMockTool('web_search', '网页摘要'));
    const failingRag = {
      name: 'rag_search_fail',
      description: 'failing rag tool',
      parameters: { type: 'object', properties: {}, required: [] },
      execute: vi.fn().mockResolvedValue({
        toolCallId: 'tc-2',
        content: '检索失败',
        isError: true,
        durationMs: 5,
      }),
    };
    registry.register(failingRag as any);

    const ctx = createContext(registry);
    const loop = new TestableReactLoop([
      {
        content: '',
        toolCalls: [
          { id: '1', toolName: 'rag_search', arguments: { query: 'q' } },
          { id: '2', toolName: 'web_search', arguments: { query: 'q' } },
          { id: '3', toolName: 'rag_search_fail', arguments: { query: 'q' } },
        ],
      },
      { content: '最终答案', toolCalls: [] },
    ]);

    const result = await loop.execute(ctx);

    expect(result.status).toBe('completed');
    expect(ctx.ragContexts).toEqual(['[1] 检索片段内容']);
  });

  it('ragContexts 上限 10 条', async () => {
    const registry = new ToolRegistry();
    const mockTool = makeMockTool('rag_search', '片段');
    // 每轮都调用一次 rag_search，11 轮后应封顶在 10 条
    registry.register(mockTool);

    const ctx = createContext(registry);
    const rounds = Array.from({ length: 11 }, (_, i) => ({
      content: '',
      toolCalls: [{ id: String(i), toolName: 'rag_search', arguments: { query: 'q' } }],
    }));
    rounds.push({ content: '答案', toolCalls: [] });
    const loop = new TestableReactLoop(rounds, 15);

    await loop.execute(ctx);
    expect(ctx.ragContexts).toHaveLength(10);
  });

  it('无 rag_search 调用时 ragContexts 为空', async () => {
    const registry = new ToolRegistry();
    registry.register(makeMockTool('web_search', '摘要'));

    const ctx = createContext(registry);
    const loop = new TestableReactLoop([{ content: '直接回答', toolCalls: [] }]);

    await loop.execute(ctx);
    expect(ctx.ragContexts).toEqual([]);
  });
});
