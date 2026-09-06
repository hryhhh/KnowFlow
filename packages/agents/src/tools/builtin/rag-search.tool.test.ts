import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RagSearchTool } from './rag-search.tool';

describe('RagSearchTool', () => {
  const mockRetrieve = vi.fn();
  let tool: RagSearchTool;

  beforeEach(() => {
    mockRetrieve.mockClear();
    tool = new RagSearchTool(mockRetrieve);
  });

  it('name 和 description 正确', () => {
    expect(tool.name).toBe('rag_search');
    expect(tool.description).toContain('知识库');
  });

  it('execute 调用 retrieve 并格式化结果', async () => {
    mockRetrieve.mockResolvedValue([
      { content: '文档A内容', score: 0.9, sourceFile: 'a.pdf', metadata: {} },
      { content: '文档B内容', score: 0.7, sourceFile: 'b.txt', metadata: {} },
    ]);

    const ctx = {
      runId: 'r1',
      sessionId: 's1',
      kbId: 'kb1',
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
    };

    const result = await tool.execute({ query: '测试查询' }, ctx);

    expect(mockRetrieve).toHaveBeenCalledWith('测试查询', 'kb1', {
      topK: 5,
      minScore: 0.5,
    });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('文档A内容');
    expect(result.content).toContain('文档B内容');
    expect(result.structured?.count).toBe(2);
    expect(result.structured?.sources).toHaveLength(2);
  });

  it('空结果返回"未找到相关文档"', async () => {
    mockRetrieve.mockResolvedValue([]);
    const ctx = {
      runId: 'r1',
      sessionId: 's1',
      kbId: 'kb1',
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
    };
    const result = await tool.execute({ query: '无结果' }, ctx);
    expect(result.content).toBe('未找到相关文档');
    expect(result.structured?.count).toBe(0);
  });

  it('topK 超过 20 被限制为 20', async () => {
    mockRetrieve.mockResolvedValue([]);
    const ctx = {
      runId: 'r1',
      sessionId: 's1',
      kbId: 'kb1',
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
    };
    await tool.execute({ query: 'x', topK: 999 }, ctx);
    expect(mockRetrieve).toHaveBeenCalledWith('x', 'kb1', { topK: 20, minScore: 0.5 });
  });

  it('自定义 minScore 传递正确', async () => {
    mockRetrieve.mockResolvedValue([]);
    const ctx = {
      runId: 'r1',
      sessionId: 's1',
      kbId: 'kb1',
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
    };
    await tool.execute({ query: 'x', minScore: 0.8 }, ctx);
    expect(mockRetrieve).toHaveBeenCalledWith('x', 'kb1', { topK: 5, minScore: 0.8 });
  });
});
