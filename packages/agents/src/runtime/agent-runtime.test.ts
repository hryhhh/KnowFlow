import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentRuntime } from './agent-runtime';
import { ReactLoop } from './react-loop';
import { AgentContext } from './agent-context';

describe('AgentRuntime', () => {
  let runtime: AgentRuntime;
  let mockExecute: ReturnType<typeof vi.fn>;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = new AgentRuntime();
    mockExecute = vi.spyOn(ReactLoop.prototype, 'execute');
    mockCreate = vi.spyOn(AgentContext, 'create');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('成功执行返回 completed 结果', async () => {
    const mockContext = {
      trace: {
        tokensUsed: { prompt: 100, completion: 50, total: 150 },
        state: { round: 2, toolCallCount: 1, totalTokens: 150 },
      },
      runId: 'run-1',
    };

    mockCreate.mockReturnValue(mockContext as any);
    mockExecute.mockResolvedValue({
      status: 'completed',
      finalAnswer: '答案是正确的',
      context: mockContext,
    });

    const result = await runtime.run({
      query: '测试问题',
      kbId: 'kb-1',
      sessionId: 'sess-1',
      traceId: 'trace-1',
      messages: [],
      searchParams: {},
      llmConfig: { apiKey: 'key', model: 'gpt-4', baseURL: '' },
      tools: {} as any,
      emitEvent: vi.fn(),
    });

    expect(result.status).toBe('completed');
    expect(result.finalAnswer).toBe('答案是正确的');
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockExecute).toHaveBeenCalledOnce();
  });

  it('执行失败时返回 failed 结果而非抛出异常', async () => {
    mockCreate.mockReturnValue({} as any);
    mockExecute.mockRejectedValue(new Error('LLM API error'));

    const result = await runtime.run({
      query: 'test',
      kbId: 'kb-1',
      sessionId: null,
      traceId: 'trace-1',
      messages: [],
      searchParams: {},
      llmConfig: { apiKey: 'key', model: 'gpt-4', baseURL: '' },
      tools: {} as any,
      emitEvent: vi.fn(),
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('LLM API error');
    expect(result.finalAnswer).toBe('');
  });
});
