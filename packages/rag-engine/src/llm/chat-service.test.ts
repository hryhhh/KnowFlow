import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMConfig, StreamCallbacks, RetrievalResult } from '../types.js';

const config: LLMConfig = {
  apiKey: 'test-key',
  model: 'gpt-4o-mini',
  baseURL: 'https://api.test.com',
  temperature: 0.7,
};

function makeStream(yields: Array<{ content: string }>) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const y of yields) {
        yield y;
      }
    },
  };
}

async function setupMocks() {
  const mockStreamFn = vi.fn();
  const MockChatOpenAI = vi.fn(function ChatOpenAI(this: any) {
    this.stream = mockStreamFn;
  }) as ReturnType<typeof vi.fn> & { prototype: any };
  MockChatOpenAI.mockImplementation(function ChatOpenAI(this: any) {
    this.stream = mockStreamFn;
  });

  const smSpy = vi.fn(function SystemMessage(this: any, text: string) {
    this.content = text;
  });
  const hmSpy = vi.fn(function HumanMessage(this: any, text: string) {
    this.content = text;
  });

  vi.doMock('@langchain/openai', () => ({ ChatOpenAI: MockChatOpenAI }));
  vi.doMock('@langchain/core/messages', () => ({
    SystemMessage: smSpy,
    HumanMessage: hmSpy,
  }));

  return { mockStreamFn, smSpy, hmSpy, MockChatOpenAI };
}

// --- buildContext ---
describe('buildContext', () => {
  it('returns placeholder when results are empty', async () => {
    const { buildContext } = await import('./chat-service.js');
    expect(buildContext([])).toBe('（暂无可用参考资料）');
  });

  it('formats multiple results with correct prefixes, sourceFile and score', async () => {
    const { buildContext } = await import('./chat-service.js');
    const results: RetrievalResult[] = [
      { content: '第一条内容', score: 0.95, sourceFile: 'a.md', metadata: {} },
      { content: '第二条内容', score: 0.8, sourceFile: 'b.md', metadata: {} },
    ];
    const ctx = buildContext(results);
    expect(ctx).toContain('[1] 第一条内容');
    expect(ctx).toContain('(来源: a.md, 相关度: 0.95)');
    expect(ctx).toContain('[2] 第二条内容');
    expect(ctx).toContain('(来源: b.md, 相关度: 0.8)');
  });

  it('works with a single result', async () => {
    const { buildContext } = await import('./chat-service.js');
    const ctx = buildContext([
      { content: '唯一致果', score: 1.0, sourceFile: 'single.md', metadata: {} },
    ] as RetrievalResult[]);
    expect(ctx).toBe('[1] 唯一致果\n(来源: single.md, 相关度: 1)');
  });
});

// --- streamChat ---
describe('streamChat', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it('calls onToken for each chunk and onDone on success', async () => {
    const { mockStreamFn, smSpy, hmSpy, MockChatOpenAI } = await setupMocks();
    mockStreamFn.mockResolvedValueOnce(makeStream([{ content: 'Hello' }, { content: ' world' }]));

    const { streamChat, DEFAULT_SYSTEM_PROMPT } = await import('./chat-service.js');
    const { SystemMessage, HumanMessage } = await import('@langchain/core/messages');
    const { ChatOpenAI } = await import('@langchain/openai');

    const callbacks: StreamCallbacks = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onSources: vi.fn(),
    };

    await streamChat({ query: 'Hi', context: 'Ctx' }, config, callbacks);

    expect(callbacks.onToken).toHaveBeenCalledWith('Hello');
    expect(callbacks.onToken).toHaveBeenCalledWith(' world');
    expect(callbacks.onDone).toHaveBeenCalledOnce();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(ChatOpenAI).toHaveBeenCalledWith({
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature,
      streaming: true,
      configuration: { baseURL: config.baseURL },
    });
    expect(SystemMessage).toHaveBeenCalledWith(DEFAULT_SYSTEM_PROMPT);
    expect(HumanMessage).toHaveBeenCalledWith('参考资料：\nCtx\n\n用户问题：Hi');
  });

  it('calls onError when LLM stream throws', async () => {
    const { mockStreamFn } = await setupMocks();
    mockStreamFn.mockRejectedValueOnce(new Error('API error'));

    const { streamChat } = await import('./chat-service.js');

    const callbacks: StreamCallbacks = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onSources: vi.fn(),
    };

    await streamChat({ query: 'Test', context: 'Context' }, config, callbacks);

    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'API error' }),
    );
    expect(callbacks.onDone).not.toHaveBeenCalled();
  });

  it('uses custom systemPrompt when provided', async () => {
    const { mockStreamFn } = await setupMocks();
    mockStreamFn.mockResolvedValueOnce(makeStream([{ content: 'done' }]));

    const { streamChat } = await import('./chat-service.js');
    const { SystemMessage, HumanMessage } = await import('@langchain/core/messages');

    const customPrompt = '你是一个专业的 Python 助手。';
    const callbacks: StreamCallbacks = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onSources: vi.fn(),
    };

    await streamChat(
      { query: 'Test', context: 'Context', systemPrompt: customPrompt },
      config,
      callbacks,
    );

    expect(SystemMessage).toHaveBeenCalledWith(customPrompt);
    expect(HumanMessage).toHaveBeenCalledWith('参考资料：\nContext\n\n用户问题：Test');
  });

  it('filters out empty token chunks', async () => {
    const { mockStreamFn } = await setupMocks();
    mockStreamFn.mockResolvedValueOnce(
      makeStream([{ content: 'first' }, { content: '' }, { content: '  ' }, { content: 'last' }]),
    );

    const { streamChat } = await import('./chat-service.js');

    const callbacks: StreamCallbacks = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onSources: vi.fn(),
    };

    await streamChat({ query: 'Hi', context: 'Ctx' }, config, callbacks);

    // Empty string is falsy so filtered; whitespace-only string is truthy so not filtered
    expect(callbacks.onToken).not.toHaveBeenCalledWith('');
    expect(callbacks.onToken).toHaveBeenCalledWith('first');
    expect(callbacks.onToken).toHaveBeenCalledWith('  ');
    expect(callbacks.onToken).toHaveBeenCalledWith('last');
  });

  it('uses default system prompt when not provided', async () => {
    const { mockStreamFn } = await setupMocks();
    mockStreamFn.mockResolvedValueOnce(makeStream([{ content: 'ok' }]));

    const { streamChat, DEFAULT_SYSTEM_PROMPT } = await import('./chat-service.js');
    const { SystemMessage } = await import('@langchain/core/messages');

    const callbacks: StreamCallbacks = {
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onSources: vi.fn(),
    };

    await streamChat({ query: 'Test', context: 'Context' }, config, callbacks);

    expect(SystemMessage).toHaveBeenCalledWith(DEFAULT_SYSTEM_PROMPT);
    expect(callbacks.onDone).toHaveBeenCalledOnce();
  });
});
