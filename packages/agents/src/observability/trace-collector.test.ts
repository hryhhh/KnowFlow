import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TraceCollector, type AgentTrace } from './trace-collector';

describe('TraceCollector', () => {
  let collector: TraceCollector;

  beforeEach(() => {
    collector = new TraceCollector('run-1', 'trace-1', 'kb-1', 'session-1', '测试查询');
  });

  it('初始化时空步骤', () => {
    const trace = collector.finalize('completed');
    expect(trace.steps).toHaveLength(0);
    expect(trace.tokensUsed).toEqual({ prompt: 0, completion: 0, total: 0 });
    expect(trace.errorMsg).toBeNull();
  });

  it('recordLLMCall 正确累计 token', () => {
    collector.recordLLMCall('gpt-4', 100, 50, 200);
    collector.recordLLMCall('gpt-4', 200, 30, 150);

    const trace = collector.finalize('completed');
    expect(trace.tokensUsed).toEqual({ prompt: 300, completion: 80, total: 380 });
    expect(trace.summary.llmCalls).toBe(2);
  });

  it('recordToolCall 记录工具调用', () => {
    collector.recordToolCall('rag_search', { query: 'test' }, '结果内容', 500, false);

    const trace = collector.finalize('completed');
    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0].type).toBe('tool_call');
    expect(trace.steps[0].data.toolName).toBe('rag_search');
    expect(trace.summary.toolCalls).toBe(1);
  });

  it('recordFinalAnswer 记录最终答案', () => {
    collector.recordFinalAnswer('这是答案');
    const trace = collector.finalize('completed');
    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0].type).toBe('final_answer');
    expect(trace.steps[0].data.answerLength).toBe(4);
  });

  it('finalize 包含正确的 summary', () => {
    collector.recordLLMCall('model', 100, 50, 200);
    collector.recordToolCall('search', {}, 'result', 100, false);
    collector.recordFinalAnswer('answer');

    const trace = collector.finalize('completed');
    expect(trace.id).toBe('run-1');
    expect(trace.kbId).toBe('kb-1');
    expect(trace.sessionId).toBe('session-1');
    expect(trace.query).toBe('测试查询');
    expect(trace.status).toBe('completed');
    expect(trace.summary.llmCalls).toBe(1);
    expect(trace.summary.toolCalls).toBe(1);
    expect(trace.summary.tokensUsed).toEqual({ prompt: 100, completion: 50, total: 150 });
    expect(trace.summary.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('finalize 带 errorMsg 时设置 error', () => {
    const trace = collector.finalize('failed', 'something went wrong');
    expect(trace.status).toBe('failed');
    expect(trace.errorMsg).toBe('something went wrong');
  });

  it('steps 按顺序记录', () => {
    collector.recordLLMCall('m', 10, 5, 10);
    collector.recordToolCall('t', {}, 'r', 5, false);
    collector.recordFinalAnswer('a');

    const trace = collector.finalize('completed');
    expect(trace.steps.map((s) => s.type)).toEqual(['llm_call', 'tool_call', 'final_answer']);
  });
});
