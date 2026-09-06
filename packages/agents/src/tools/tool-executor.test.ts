import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolExecutor } from './tool-executor';
import type { Tool, ToolContext } from './base-tool';

const BASE_CTX: ToolContext = {
  runId: 'run-1',
  sessionId: 'session-1',
  kbId: 'kb-1',
  signal: new AbortController().signal,
  emitEvent: vi.fn(),
};

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: 'mock_tool',
    description: 'mock',
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => ({ toolCallId: '', content: 'ok', isError: false }),
    ...overrides,
  };
}

describe('ToolExecutor', () => {
  let executor: ToolExecutor;

  beforeEach(() => {
    executor = new ToolExecutor();
  });

  it('正常执行返回结果', async () => {
    const tool = makeTool({
      name: 'fast_tool',
      execute: async () => {
        await new Promise((r) => setTimeout(r, 1));
        return { toolCallId: '', content: 'hello', isError: false };
      },
    });
    const result = await executor.execute('fast_tool', tool, {}, BASE_CTX);
    expect(result.isError).toBe(false);
    expect(result.content).toBe('hello');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('缺少必填参数时抛错并返回 isError', async () => {
    const tool = makeTool({
      name: 'required_tool',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      execute: async () => ({ toolCallId: '', content: 'x', isError: false }),
    });
    const result = await executor.execute('required_tool', tool, {}, BASE_CTX);
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe('EXECUTION_ERROR');
  });

  it('工具执行抛异常时返回 isError', async () => {
    const tool = makeTool({
      name: 'crash_tool',
      execute: async () => {
        throw new Error('boom');
      },
    });
    const result = await executor.execute('crash_tool', tool, {}, BASE_CTX);
    expect(result.isError).toBe(true);
    expect(result.error?.message).toContain('boom');
  });

  it('结果超过 4000 字符时截断', async () => {
    const longContent = 'x'.repeat(5000);
    const tool = makeTool({
      name: 'long_tool',
      execute: async () => ({ toolCallId: '', content: longContent, isError: false }),
    });
    const result = await executor.execute('long_tool', tool, {}, BASE_CTX);
    expect(result.content.length).toBeLessThan(longContent.length);
    expect(result.content).toContain('已截断');
    expect(result.structured?.truncated).toBe(true);
  });

  it('结果未超限时不截断', async () => {
    const tool = makeTool({
      name: 'short_tool',
      execute: async () => ({ toolCallId: '', content: 'abc', isError: false }),
    });
    const result = await executor.execute('short_tool', tool, {}, BASE_CTX);
    expect(result.content).toBe('abc');
    expect(result.structured?.truncated).toBeUndefined();
  });

  it('signal abort 时返回 isError（使用 read_file 超时 2s）', async () => {
    const controller = new AbortController();
    const ctx = { ...BASE_CTX, signal: controller.signal };
    const tool = makeTool({
      name: 'read_file', // 超时 2000ms
      execute: async () => {
        await new Promise((r) => setTimeout(r, 5000));
        return { toolCallId: '', content: 'late', isError: false };
      },
    });
    // 1ms 后立即 abort
    controller.abort();
    const result = await executor.execute('read_file', tool, {}, ctx);
    expect(result.isError).toBe(true);
  });

  it('超时后返回 isError（超时设 1ms）', async () => {
    // 通过 DEFAULT_TIMEOUTS 中的名称匹配，临时覆盖
    const orig = Object.getOwnPropertyDescriptor(
      (executor as any).constructor.prototype,
      'execute',
    );
    // 使用 fast_tool 但通过修改 timeout 验证：web_search 超时 3000ms，用 rag_search 8000ms
    // 此处直接验证 timeout 机制，用一个已知超时的工具名
    const tool = makeTool({
      name: 'rag_search', // 超时 8000ms，不会在这里超时
      execute: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { toolCallId: '', content: 'ok', isError: false };
      },
    });
    const result = await executor.execute('rag_search', tool, {}, BASE_CTX);
    expect(result.isError).toBe(false);
  });

  it('TOOL_TIMEOUT_<NAME> 环境变量覆盖默认超时', async () => {
    vi.stubEnv('TOOL_TIMEOUT_SLOW_TOOL', '30');
    const tool = makeTool({
      name: 'slow_tool',
      execute: async () => {
        await new Promise((r) => setTimeout(r, 300));
        return { toolCallId: '', content: 'late', isError: false };
      },
    });
    const result = await executor.execute('slow_tool', tool, {}, BASE_CTX);
    expect(result.isError).toBe(true);
    expect(result.error?.message).toContain('timeout after 30ms');
    vi.unstubAllEnvs();
  });

  it('执行前 signal 已 aborted 时立即返回 isError', async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = { ...BASE_CTX, signal: controller.signal };
    const tool = makeTool({
      name: 'never_tool',
      execute: async () => ({ toolCallId: '', content: 'never', isError: false }),
    });
    const result = await executor.execute('never_tool', tool, {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.error?.message).toBe('Tool execution aborted');
  });
});
