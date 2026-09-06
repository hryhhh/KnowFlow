import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DbQueryTool } from './db-query.tool';

describe('DbQueryTool', () => {
  const mockExecute = vi.fn();
  let tool: DbQueryTool;

  beforeEach(() => {
    mockExecute.mockClear();
    tool = new DbQueryTool(mockExecute);
  });

  it('name 正确', () => {
    expect(tool.name).toBe('query_database');
  });

  it('execute 调用 executeFn 并格式化结果', async () => {
    mockExecute.mockResolvedValue([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]);
    const ctx = {
      runId: 'r1',
      sessionId: 's1',
      kbId: 'kb1',
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
    };
    const result = await tool.execute({ templateId: 'kb_stats', params: ['kb-1'] }, ctx);
    expect(mockExecute).toHaveBeenCalledWith('kb_stats', ['kb-1'], 100);
    expect(result.isError).toBe(false);
    expect(result.content).toContain('Alice');
    expect(result.structured?.rowCount).toBe(2);
  });

  it('单行单列特殊格式化', async () => {
    mockExecute.mockResolvedValue([{ total: 42 }]);
    const ctx = {
      runId: 'r1',
      sessionId: 's1',
      kbId: 'kb1',
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
    };
    const result = await tool.execute({ templateId: 'kb_stats' }, ctx);
    expect(result.content).toContain('总计 42 条');
  });

  it('空结果返回"查询结果为空"', async () => {
    mockExecute.mockResolvedValue([]);
    const ctx = {
      runId: 'r1',
      sessionId: 's1',
      kbId: 'kb1',
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
    };
    const result = await tool.execute({ templateId: 'kb_stats' }, ctx);
    expect(result.content).toBe('查询结果为空');
  });
});
