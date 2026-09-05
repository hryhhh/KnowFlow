import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSearchTool } from './web-search.tool';

describe('WebSearchTool', () => {
  const mockSearch = vi.fn();
  let tool: WebSearchTool;

  beforeEach(() => {
    mockSearch.mockClear();
    tool = new WebSearchTool({ search: mockSearch } as any);
  });

  it('name 正确', () => {
    expect(tool.name).toBe('web_search');
  });

  it('execute 调用 provider.search 并格式化', async () => {
    mockSearch.mockResolvedValue([
      { title: '新闻A', snippet: '摘要A', uri: 'http://a.com', source: 'tavily' },
      { title: '新闻B', snippet: '摘要B', uri: 'http://b.com', source: 'tavily' },
    ]);
    const ctx = {
      runId: 'r1',
      sessionId: 's1',
      kbId: 'kb1',
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
    };
    const result = await tool.execute({ query: 'AI新闻' }, ctx);
    expect(mockSearch).toHaveBeenCalledWith('AI新闻', { max_results: 3 });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('新闻A');
    expect(result.content).toContain('摘要A');
    expect(result.structured?.count).toBe(2);
  });

  it('空结果返回"未找到相关结果"', async () => {
    mockSearch.mockResolvedValue([]);
    const ctx = {
      runId: 'r1',
      sessionId: 's1',
      kbId: 'kb1',
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
    };
    const result = await tool.execute({ query: '无任何结果' }, ctx);
    expect(result.content).toBe('未找到相关结果');
  });

  it('maxResults 参数传递正确', async () => {
    mockSearch.mockResolvedValue([]);
    const ctx = {
      runId: 'r1',
      sessionId: 's1',
      kbId: 'kb1',
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
    };
    await tool.execute({ query: 'x', maxResults: 5 }, ctx);
    expect(mockSearch).toHaveBeenCalledWith('x', { max_results: 5 });
  });
});
