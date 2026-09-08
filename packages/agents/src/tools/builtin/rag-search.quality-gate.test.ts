import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RagSearchTool } from './rag-search.tool.js';
import type { ToolContext } from '../base-tool';

/** A3：rag_search 软信号 —— lowQuality 标记与 content 前缀，不拦截 */

const ctx: ToolContext = {
  runId: 'run-1',
  kbId: 'kb-1',
} as unknown as ToolContext;

function makeTool(scores: number[]) {
  const retrieveFn = vi.fn().mockResolvedValue(
    scores.map((s, i) => ({
      content: `片段${i}`,
      score: s,
      sourceFile: `f${i}.md`,
      metadata: {},
    })),
  );
  return { tool: new RagSearchTool(retrieveFn), retrieveFn };
}

describe('RagSearchTool 检索质量软信号（A3）', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('闸门关闭（默认）时无前缀、无 lowQuality', async () => {
    delete process.env.RETRIEVAL_QUALITY_GATE_ENABLED;
    const { tool } = makeTool([0.1, 0.05]);

    const result = await tool.execute({ query: 'q' }, ctx);

    expect(result.content).not.toContain('相关度较低');
    expect(result.structured.lowQuality).toBeUndefined();
    expect(result.isError).toBe(false);
  });

  it('开启且 top1 低于阈值：content 加前缀，structured 携带 lowQuality + maxScore', async () => {
    vi.stubEnv('RETRIEVAL_QUALITY_GATE_ENABLED', 'true');
    const { tool } = makeTool([0.21, 0.1]);

    const result = await tool.execute({ query: 'q' }, ctx);

    expect(result.content).toMatch(/^检索结果相关度较低（最高 0\.21）。\n\n/);
    expect(result.structured.lowQuality).toBe(true);
    expect(result.structured.maxScore).toBe(0.21);
    expect(result.isError).toBe(false);
  });

  it('开启但 top1 达标：无前缀、无 lowQuality', async () => {
    vi.stubEnv('RETRIEVAL_QUALITY_GATE_ENABLED', 'true');
    const { tool } = makeTool([0.9]);

    const result = await tool.execute({ query: 'q' }, ctx);

    expect(result.content).not.toContain('相关度较低');
    expect(result.structured.lowQuality).toBeUndefined();
  });

  it('空结果：不产生 lowQuality（top1 为 null）', async () => {
    vi.stubEnv('RETRIEVAL_QUALITY_GATE_ENABLED', 'true');
    const { tool } = makeTool([]);

    const result = await tool.execute({ query: 'q' }, ctx);

    expect(result.content).toBe('未找到相关文档');
    expect(result.structured.lowQuality).toBeUndefined();
  });
});
