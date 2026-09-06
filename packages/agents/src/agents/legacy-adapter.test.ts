import { describe, it, expect, vi } from 'vitest';
import { LegacyAgentAdapter } from './legacy-adapter';

describe('LegacyAgentAdapter', () => {
  const mockAgent = {
    id: 'test-agent',
    name: 'Test Agent',
    execute: vi.fn(),
  };

  it('name 和 description 正确设置', () => {
    const adapter = new LegacyAgentAdapter(mockAgent as any, 'legacy_tool', 'Legacy description');
    expect(adapter.name).toBe('legacy_tool');
    expect(adapter.description).toBe('Legacy description');
  });

  it('execute 调用 Agent.execute 并映射结果', async () => {
    mockAgent.execute.mockResolvedValue({
      id: 'r1',
      agent: 'test-agent',
      status: 'ok',
      content: 'answer',
      sources: [{ uri: 's1' }],
      elapsedMs: 100,
    });

    const adapter = new LegacyAgentAdapter(mockAgent as any, 'legacy_tool', 'desc');
    const ctx = {
      runId: 'run-1',
      sessionId: 'sess-1',
      kbId: 'kb-1',
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
    };

    const result = await adapter.execute({ query: 'hello' }, ctx);

    expect(mockAgent.execute).toHaveBeenCalledWith({
      query: 'hello',
      kbId: 'kb-1',
      traceId: 'run-1',
    });
    expect(result.isError).toBe(false);
    expect(result.content).toBe('answer');
    expect(result.structured?.status).toBe('ok');
  });

  it('Agent 返回 error 状态时 isError=true', async () => {
    mockAgent.execute.mockResolvedValue({
      id: 'r1',
      agent: 'test-agent',
      status: 'error',
      content: '',
      error: { message: 'fail' },
    });

    const adapter = new LegacyAgentAdapter(mockAgent as any, 'legacy_tool', 'desc');
    const ctx = {
      runId: 'run-1',
      sessionId: 'sess-1',
      kbId: 'kb-1',
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
    };

    const result = await adapter.execute({ query: 'x' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.error?.message).toBe('fail');
  });

  it('Agent 返回 timeout 状态时 isError=true', async () => {
    mockAgent.execute.mockResolvedValue({
      id: 'r1',
      agent: 'test-agent',
      status: 'timeout',
      content: '',
    });

    const adapter = new LegacyAgentAdapter(mockAgent as any, 'legacy_tool', 'desc');
    const ctx = {
      runId: 'run-1',
      sessionId: 'sess-1',
      kbId: 'kb-1',
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
    };

    const result = await adapter.execute({ query: 'x' }, ctx);
    expect(result.isError).toBe(true);
  });
});
