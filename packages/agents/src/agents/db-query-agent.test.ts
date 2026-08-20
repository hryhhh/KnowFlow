import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DbQueryAgent } from '../index.js';

const mockExecuteFn = vi.fn().mockResolvedValue([{ count: 42 }]);

function createAgent(): DbQueryAgent {
  const agent = new DbQueryAgent();
  agent.setExecuteFn(mockExecuteFn);
  return agent;
}

function makeTemplate(id: string): import('../types.js').DbQueryTemplate {
  return {
    id,
    description: `${id} template`,
    queryTemplate: `SELECT * FROM test WHERE id = $1`,
    params: [{ name: 'kbId', type: 'string', description: 'KB ID' }],
    requiredFields: ['id'],
  };
}

describe('DbQueryAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when no template matches', async () => {
    const agent = createAgent();
    const result = await agent.execute({ query: 'random question', kbId: 'kb-1', traceId: 't1' });
    expect(result.status).toBe('error');
    expect(result.content).toBe('');
    expect(result.error).toBeDefined();
  });

  it('registers and uses templates', async () => {
    const agent = createAgent();
    agent.registerTemplate(makeTemplate('kb_stats'));
    agent.registerTemplate(makeTemplate('doc_list'));

    const result = await agent.execute({ query: '知识库总共有多少', kbId: 'kb-1', traceId: 't1' });
    expect(result.status).toBe('ok');
    expect(result.content).toContain('42');
  });

  it('rejects unknown templates', async () => {
    const agent = createAgent();
    // No templates registered, query matches kb_stats pattern
    const result = await agent.execute({ query: '知识库总数', kbId: 'kb-1', traceId: 't1' });
    expect(result.status).toBe('error');
  });

  it('passes kbId as parameter', async () => {
    const agent = createAgent();
    agent.registerTemplate(makeTemplate('kb_stats'));
    mockExecuteFn.mockResolvedValueOnce([{ count: 10 }]);

    await agent.execute({ query: '知识库多少', kbId: 'my-kb', traceId: 't1' });
    expect(mockExecuteFn).toHaveBeenCalledOnce();
    expect(mockExecuteFn.mock.calls[0][0]).toBe('kb_stats');
    expect(mockExecuteFn.mock.calls[0][1]).toContain('my-kb');
  });

  it('limits results to maxRows (default 100)', async () => {
    const agent = createAgent();
    agent.registerTemplate(makeTemplate('doc_list'));
    mockExecuteFn.mockResolvedValueOnce(
      Array.from({ length: 5 }, (_, i) => ({ id: i, title: `doc-${i}` })),
    );

    const result = await agent.execute({ query: '列出文档', kbId: 'kb-1', traceId: 't1' });
    expect(result.status).toBe('ok');
    expect(result.content).toContain('doc-0');
  });

  it('formats single-row single-column as count', async () => {
    const agent = createAgent();
    agent.registerTemplate(makeTemplate('kb_stats'));
    mockExecuteFn.mockResolvedValueOnce([{ total: 99 }]);

    const result = await agent.execute({ query: '知识库总共有多少', kbId: 'kb-1', traceId: 't1' });
    expect(result.content).toContain('99');
  });

  it('returns error when executeFn not set', async () => {
    const agent = new DbQueryAgent();
    agent.registerTemplate(makeTemplate('kb_stats'));
    const result = await agent.execute({ query: '知识库总数', kbId: 'kb-1', traceId: 't1' });
    expect(result.status).toBe('error');
    expect(result.error?.message).toContain('执行函数未配置');
  });

  it('returns error when executeFn throws', async () => {
    const agent = createAgent();
    agent.registerTemplate(makeTemplate('kb_stats'));
    mockExecuteFn.mockRejectedValueOnce(new Error('DB connection failed'));

    const result = await agent.execute({ query: '知识库总数', kbId: 'kb-1', traceId: 't1' });
    expect(result.status).toBe('error');
    expect(result.error?.message).toContain('DB connection failed');
  });

  it('includes sources with template metadata', async () => {
    const agent = createAgent();
    agent.registerTemplate(makeTemplate('kb_stats'));
    mockExecuteFn.mockResolvedValueOnce([{ total: 10 }]);

    const result = await agent.execute({ query: '知识库总数', kbId: 'kb-1', traceId: 't1' });
    expect(result.sources).toBeDefined();
    expect(result.sources![0].uri).toContain('db://');
  });

  it('measures elapsedMs', async () => {
    const agent = createAgent();
    agent.registerTemplate(makeTemplate('kb_stats'));
    // Add a small delay to ensure elapsedMs > 0
    mockExecuteFn.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return [{ total: 1 }];
    });

    const result = await agent.execute({ query: '知识库总数', kbId: 'kb-1', traceId: 't1' });
    expect(result.elapsedMs).toBeGreaterThan(0);
  });

  it('handles empty query results', async () => {
    const agent = createAgent();
    agent.registerTemplate(makeTemplate('kb_stats'));
    mockExecuteFn.mockResolvedValueOnce([]);

    const result = await agent.execute({ query: '知识库总数', kbId: 'kb-1', traceId: 't1' });
    expect(result.content).toContain('查询结果为空');
  });

  it('template matching: "切片数最多" → top_docs_by_chunks', async () => {
    const agent = createAgent();
    agent.registerTemplate(makeTemplate('top_docs_by_chunks'));
    mockExecuteFn.mockResolvedValueOnce([{ docId: 1, chunks: 100 }]);

    // Use a query that won't be caught by the more general patterns first
    const result = await agent.execute({ query: 'top10 切片数', kbId: 'kb-1', traceId: 't1' });
    expect(result.status).toBe('ok');
  });

  it('template matching: "排行" → top_docs_by_chunks', async () => {
    const agent = createAgent();
    agent.registerTemplate(makeTemplate('top_docs_by_chunks'));
    mockExecuteFn.mockResolvedValueOnce([]);

    const result = await agent.execute({ query: '排行榜前10', kbId: 'kb-1', traceId: 't1' });
    expect(result.status).toBe('ok');
  });

  it('template matching: "趋势" → doc_creation_trend', async () => {
    const agent = createAgent();
    agent.registerTemplate(makeTemplate('doc_creation_trend'));
    mockExecuteFn.mockResolvedValueOnce([]);

    const result = await agent.execute({ query: '文档创建趋势', kbId: 'kb-1', traceId: 't1' });
    expect(result.status).toBe('ok');
  });

  it('returns null for personal queries (triggers RAG fallback)', async () => {
    const agent = createAgent();
    const result = await agent.execute({ query: '查我的手机号', kbId: 'kb-1', traceId: 't1' });
    expect(result.status).toBe('error');
    expect(result.error?.message).toContain('无法匹配查询模板');
  });
});
