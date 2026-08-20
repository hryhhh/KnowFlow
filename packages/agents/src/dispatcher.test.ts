import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Dispatcher } from './index.js';
import type { Agent, AgentResult, ComposeStrategy, RouterRule } from './types.js';

function makeAgent(id: string, status: 'ok' | 'error' = 'ok', content = 'result'): Agent {
  return {
    id,
    name: id,
    execute: vi.fn().mockResolvedValue({
      id: `${id}-1`,
      agent: id,
      status,
      content,
      elapsedMs: 10,
    } as AgentResult),
  };
}

function makeRule(target: string, priority = 10): RouterRule {
  return {
    id: `rule-${target}`,
    pattern: target,
    intent: target,
    targetAgent: target,
    priority,
    minScore: 0,
    enabled: true,
  };
}

describe('Dispatcher dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs matching agents', async () => {
    const dispatcher = new Dispatcher([makeAgent('agent-a'), makeAgent('agent-b')]);
    const rules = [
      { rule: makeRule('agent-a'), score: 1.0 },
      { rule: makeRule('agent-b'), score: 1.0 },
    ];
    const results = await dispatcher.dispatch(
      rules,
      { query: 'test', kbId: 'kb-1', traceId: 't1' },
      5000,
    );
    expect(results).toHaveLength(2);
    expect(results[0].agent).toBe('agent-a');
    expect(results[1].agent).toBe('agent-b');
  });

  it('deduplicates same target agent', async () => {
    const agentA = makeAgent('agent-a');
    const dispatcher = new Dispatcher([agentA]);
    const rules = [
      { rule: makeRule('agent-a', 10), score: 1.0 },
      { rule: makeRule('agent-a', 5), score: 1.0 },
    ];
    const results = await dispatcher.dispatch(
      rules,
      { query: 'test', kbId: 'kb-1', traceId: 't1' },
      5000,
    );
    expect(agentA.execute).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it('handles missing agent gracefully', async () => {
    const dispatcher = new Dispatcher([]);
    const rules = [{ rule: makeRule('nonexistent'), score: 1.0 }];
    const results = await dispatcher.dispatch(
      rules,
      { query: 'test', kbId: 'kb-1', traceId: 't1' },
      5000,
    );
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('error');
    expect(results[0].content).toContain('not found');
  });

  it('returns error for failing agent', async () => {
    const failingAgent: Agent = {
      id: 'bad-agent',
      name: 'bad',
      execute: vi.fn().mockRejectedValue(new Error('crash')),
    };
    const dispatcher = new Dispatcher([failingAgent]);
    const rules = [{ rule: makeRule('bad-agent'), score: 1.0 }];
    const results = await dispatcher.dispatch(
      rules,
      { query: 'test', kbId: 'kb-1', traceId: 't1' },
      5000,
    );
    expect(results[0].status).toBe('error');
    expect(results[0].error?.message).toContain('crash');
  });

  it('returns timeout result for slow agent', async () => {
    let resolveFn: () => void;
    const slowPromise = new Promise((resolve) => {
      resolveFn = resolve;
    });
    const slowAgent: Agent = {
      id: 'slow-agent',
      name: 'slow',
      execute: vi.fn().mockReturnValue(slowPromise),
    };
    const dispatcher = new Dispatcher([slowAgent]);
    const rules = [{ rule: makeRule('slow-agent'), score: 1.0 }];
    const results = await dispatcher.dispatch(
      rules,
      { query: 'test', kbId: 'kb-1', traceId: 't1' },
      10,
    );
    resolveFn!();
    expect(results[0].status).toBe('error');
  });
});

describe('Dispatcher compose', () => {
  it('concat strategy joins results by priority', () => {
    const dispatcher = new Dispatcher([makeAgent('high'), makeAgent('low')], 'concat');
    const results: AgentResult[] = [
      { id: 'r2', agent: 'low', status: 'ok', content: 'low result', elapsedMs: 10 },
      { id: 'r1', agent: 'high', status: 'ok', content: 'high result', elapsedMs: 10 },
    ];
    const rules = [
      { rule: makeRule('high', 20), score: 1.0 },
      { rule: makeRule('low', 10), score: 1.0 },
    ];
    const composed = dispatcher.compose(results, rules, 'query');
    expect(composed.content).toContain('high result');
    expect(composed.content.indexOf('high result')).toBeLessThan(
      composed.content.indexOf('low result'),
    );
  });

  it('skips error/timeout results in concat', () => {
    const dispatcher = new Dispatcher([], 'concat');
    const results: AgentResult[] = [
      { id: 'r1', agent: 'a', status: 'ok', content: 'good', elapsedMs: 10 },
      {
        id: 'r2',
        agent: 'b',
        status: 'error',
        content: '',
        error: { message: 'fail' },
        elapsedMs: 5,
      },
      { id: 'r3', agent: 'c', status: 'timeout', content: '', elapsedMs: 5000 },
    ];
    const rules = [
      { rule: makeRule('a', 10), score: 1.0 },
      { rule: makeRule('b', 10), score: 1.0 },
      { rule: makeRule('c', 10), score: 1.0 },
    ];
    const composed = dispatcher.compose(results, rules, 'query');
    expect(composed.content).toContain('good');
    expect(composed.content).not.toContain('fail');
  });

  it('rag-priority prefers RAGFlow when valid', () => {
    const dispatcher = new Dispatcher([], 'rag-priority');
    const results: AgentResult[] = [
      { id: 'r1', agent: 'ragflow', status: 'ok', content: 'RAG answer', elapsedMs: 100 },
      { id: 'r2', agent: 'web-search', status: 'ok', content: 'web result', elapsedMs: 50 },
    ];
    const rules = [{ rule: makeRule('web-search', 10), score: 1.0 }];
    const composed = dispatcher.compose(results, rules, 'query');
    expect(composed.content).toContain('RAGFlow');
    expect(composed.content).toContain('RAG answer');
  });

  it('rag-priority falls back to concat when RAG is empty', () => {
    const dispatcher = new Dispatcher([], 'rag-priority');
    const results: AgentResult[] = [
      {
        id: 'r1',
        agent: 'ragflow',
        status: 'ok',
        content: '抱歉，没有找到相关信息',
        elapsedMs: 100,
      },
      { id: 'r2', agent: 'web-search', status: 'ok', content: 'web result', elapsedMs: 50 },
    ];
    const rules = [{ rule: makeRule('web-search', 10), score: 1.0 }];
    const composed = dispatcher.compose(results, rules, 'query');
    expect(composed.content).not.toContain('RAGFlow');
  });

  it('llm-summarize returns structured prompt', () => {
    const dispatcher = new Dispatcher([], 'llm-summarize');
    const results: AgentResult[] = [
      { id: 'r1', agent: 'a', status: 'ok', content: 'result a', elapsedMs: 10 },
    ];
    const composed = dispatcher.compose(results, [], 'test-query');
    expect(composed.content).toContain('llm-summarize');
    expect(composed.content).toContain('test-query');
    expect(composed.content).toContain('result a');
  });

  it('rerank-and-merge deduplicates sources', () => {
    const dispatcher = new Dispatcher([], 'rerank-and-merge');
    const results: AgentResult[] = [
      {
        id: 'r1',
        agent: 'a',
        status: 'ok',
        content: 'c',
        elapsedMs: 10,
        sources: [{ uri: 'https://a.com', title: 'A' }],
      },
      {
        id: 'r2',
        agent: 'b',
        status: 'ok',
        content: 'd',
        elapsedMs: 10,
        sources: [{ uri: 'https://a.com', title: 'A again' }],
      },
    ];
    const composed = dispatcher.compose(results, [], 'query');
    expect(composed.content).toContain('1 sources');
  });

  it('empty results return empty content', () => {
    const dispatcher = new Dispatcher([], 'concat');
    const composed = dispatcher.compose([], [], 'query');
    expect(composed.content).toBe('');
  });
});
