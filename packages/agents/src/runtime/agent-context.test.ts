import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentContext } from './agent-context';
import { ToolRegistry } from '../tools/tool-registry';

function makeTool(name: string) {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => ({ toolCallId: '', content: '', isError: false }),
  };
}

function makeCtx(
  overrides: Partial<Parameters<typeof AgentContext.create>[0]> = {},
  options?: Parameters<typeof AgentContext.create>[1],
) {
  const registry = new ToolRegistry();
  registry.register(makeTool('test_tool'));

  return AgentContext.create(
    {
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
    },
    options,
  );
}

describe('AgentContext', () => {
  it('生成合法 UUID 格式的 runId', () => {
    const ctx = makeCtx();
    expect(ctx.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('sessionId 为空时使用 anonymous', () => {
    const ctx = makeCtx({ sessionId: null });
    expect(ctx.sessionId).toBe('anonymous');
  });

  it('状态初始值正确', () => {
    const ctx = makeCtx();
    expect(ctx.state).toEqual({ round: 0, toolCallCount: 0, totalTokens: 0 });
  });

  it('signal 初始未 abort', () => {
    const ctx = makeCtx();
    expect(ctx.signal.aborted).toBe(false);
  });

  it('messages 包含 system + user 消息', () => {
    const ctx = makeCtx({
      messages: [
        { role: 'user', content: '上一轮问题' },
        { role: 'assistant', content: '上一轮回答' },
      ],
    });
    expect(ctx.messages).toHaveLength(4); // system + user(上一轮) + assistant(上一轮) + user(当前)
    expect(ctx.messages[0].role).toBe('system');
    expect(ctx.messages[1].role).toBe('user');
    expect(ctx.messages[1].content).toBe('上一轮问题');
    expect(ctx.messages[2].role).toBe('assistant');
    expect(ctx.messages[2].content).toBe('上一轮回答');
    expect(ctx.messages[3].role).toBe('user');
    expect(ctx.messages[3].content).toBe('hello');
  });

  it('system prompt 包含工具描述和 kbId', () => {
    const ctx = makeCtx();
    const sysMsg = ctx.messages[0];
    expect(sysMsg.content).toContain('test_tool');
    expect(sysMsg.content).toContain('kb-1');
  });

  it('trace 不为空', () => {
    const ctx = makeCtx();
    expect(ctx.trace).toBeDefined();
    expect(ctx.trace.runId).toBe(ctx.runId);
  });

  it('timeout 超时后 signal.aborted = true', async () => {
    // 注入极短超时验证中止路径（整体超时已收编为 RUNTIME_DEFAULTS.timeoutMs，经 create options 覆盖）
    const ctx = makeCtx({}, { timeoutMs: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(ctx.signal.aborted).toBe(true);
  });
});
