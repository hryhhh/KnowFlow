import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LLMConfig } from '../types.js';

const cfg: LLMConfig = {
  apiKey: 'test-key',
  model: 'gpt-4o-mini',
  baseURL: 'https://api.test.com',
};

describe('Faithfulness 校验模块', () => {
  let invokeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    invokeMock = vi.fn();

    // ChatOpenAI 必须是 class/constructor，mock invoke 方法
    const MockChatOpenAI = vi.fn(function ChatOpenAI(this: any) {
      this.invoke = invokeMock;
    }) as unknown as typeof import('@langchain/openai').ChatOpenAI;

    // SystemMessage / HumanMessage 也必须是 constructor
    function SystemMessage(this: any, text: string) { this.content = text; }
    function HumanMessage(this: any, text: string) { this.content = text; }

    vi.doMock('@langchain/openai', () => ({ ChatOpenAI: MockChatOpenAI }));
    vi.doMock('@langchain/core/messages', () => ({ SystemMessage, HumanMessage }));
  });

  afterEach(() => {
    delete process.env.FAITHFULNESS_ENABLED;
    delete process.env.FAITHFULNESS_MODE;
    delete process.env.FAITHFULNESS_MIN_SCORE;
    delete process.env.FAITHFULNESS_TIMEOUT_MS;
    vi.unmock('@langchain/openai');
    vi.unmock('@langchain/core/messages');
  });

  async function loadModule() {
    return import('./faithfulness.js');
  }

  // --- 开关与环境变量 ---

  it('isFaithfulnessEnabled 默认 false', async () => {
    const mod = await loadModule();
    expect(mod.isFaithfulnessEnabled()).toBe(false);
  });

  it('isFaithfulnessEnabled 开启', async () => {
    process.env.FAITHFULNESS_ENABLED = 'true';
    const mod = await loadModule();
    expect(mod.isFaithfulnessEnabled()).toBe(true);
  });

  it('getFaithfulnessMode 默认 annotate', async () => {
    const mod = await loadModule();
    expect(mod.getFaithfulnessMode()).toBe('annotate');
  });

  it('getFaithfulnessMode gate 模式', async () => {
    process.env.FAITHFULNESS_MODE = 'gate';
    const mod = await loadModule();
    expect(mod.getFaithfulnessMode()).toBe('gate');
  });

  it('getFaithfulnessMinScore 默认 0.8', async () => {
    const mod = await loadModule();
    expect(mod.getFaithfulnessMinScore()).toBe(0.8);
  });

  it('getFaithfulnessMinScore 自定义值', async () => {
    process.env.FAITHFULNESS_MIN_SCORE = '0.6';
    const mod = await loadModule();
    expect(mod.getFaithfulnessMinScore()).toBe(0.6);
  });

  it('getFaithfulnessTimeoutMs 默认 3000', async () => {
    const mod = await loadModule();
    expect(mod.getFaithfulnessTimeoutMs()).toBe(3000);
  });

  it('getFaithfulnessTimeoutMs 自定义值', async () => {
    process.env.FAITHFULNESS_TIMEOUT_MS = '5000';
    const mod = await loadModule();
    expect(mod.getFaithfulnessTimeoutMs()).toBe(5000);
  });

  // --- gate 判定 ---

  it('isFaithfulnessGatePass score >= 阈值返回 true', async () => {
    const mod = await loadModule();
    expect(mod.isFaithfulnessGatePass(0.9)).toBe(true);
  });

  it('isFaithfulnessGatePass score < 阈值返回 false', async () => {
    const mod = await loadModule();
    expect(mod.isFaithfulnessGatePass(0.5)).toBe(false);
  });

  it('isFaithfulnessGatePass score 等于阈值返回 true', async () => {
    const mod = await loadModule();
    expect(mod.isFaithfulnessGatePass(0.8)).toBe(true);
  });

  // --- checkFaithfulness ---

  it('空答案返回 score=1，不调 LLM', async () => {
    const mod = await loadModule();
    const result = await mod.checkFaithfulness('', ['ctx1'], cfg);
    expect(result.score).toBe(1);
    expect(result.claims).toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('空上下文返回 score=1，不调 LLM', async () => {
    const mod = await loadModule();
    const result = await mod.checkFaithfulness('hello', [], cfg);
    expect(result.score).toBe(1);
    expect(result.claims).toEqual([]);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('全部陈述支撑 → score=1', async () => {
    invokeMock.mockResolvedValue({
      content: '{"claims":[{"text":"A 是 B","supported":true,"evidenceIndexes":[1]}]}',
    });
    const mod = await loadModule();
    const result = await mod.checkFaithfulness('A 是 B。', ['这是参考资料'], cfg);
    expect(result.score).toBe(1);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].text).toBe('A 是 B');
    expect(result.claims[0].supported).toBe(true);
    expect(result.claims[0].evidenceIndexes).toEqual([0]);
  });

  it('部分陈述无支撑 → score=0.5', async () => {
    invokeMock.mockResolvedValue({
      content: '{"claims":[{"text":"X","supported":false,"evidenceIndexes":[]},{"text":"Y","supported":true,"evidenceIndexes":[1]}]}',
    });
    const mod = await loadModule();
    const result = await mod.checkFaithfulness('X 且 Y。', ['ref1'], cfg);
    expect(result.score).toBeCloseTo(0.5, 1);
    expect(result.claims).toHaveLength(2);
    expect(result.claims[0].supported).toBe(false);
    expect(result.claims[1].supported).toBe(true);
  });

  it('JSON 被 ```json 包裹也能解析', async () => {
    invokeMock.mockResolvedValue({
      content: '```json\n{"claims":[{"text":"Z","supported":true,"evidenceIndexes":[1]}]}\n```',
    });
    const mod = await loadModule();
    const result = await mod.checkFaithfulness('Z', ['ref'], cfg);
    expect(result.score).toBe(1);
    expect(result.claims[0].text).toBe('Z');
  });

  it('LLM 异常时抛错给调用方', async () => {
    invokeMock.mockRejectedValue(new Error('API error'));
    const mod = await loadModule();
    await expect(mod.checkFaithfulness('answer', ['ctx'], cfg)).rejects.toThrow('API error');
  });

  // --- annotateFaithfulness（流式标注钩子） ---

  it('开关关闭时不调用 LLM，直接返回', async () => {
    const mod = await loadModule();
    const onResult = vi.fn();
    await mod.annotateFaithfulness('answer', ['ctx'], cfg, onResult);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('开关开启时调用 LLM 并回调结果', async () => {
    process.env.FAITHFULNESS_ENABLED = 'true';
    invokeMock.mockResolvedValue({
      content: '{"claims":[{"text":"A","supported":true,"evidenceIndexes":[1]}]}',
    });
    const mod = await loadModule();
    const onResult = vi.fn();
    await mod.annotateFaithfulness('A', ['ctx'], cfg, onResult);
    expect(invokeMock).toHaveBeenCalledOnce();
    expect(onResult).toHaveBeenCalledOnce();
    expect(onResult.mock.calls[0][0].score).toBe(1);
  });

  it('gate 模式在流式链路打 warn 并按 annotate 处理', async () => {
    process.env.FAITHFULNESS_ENABLED = 'true';
    process.env.FAITHFULNESS_MODE = 'gate';
    invokeMock.mockResolvedValue({
      content: '{"claims":[{"text":"A","supported":true,"evidenceIndexes":[1]}]}',
    });
    const mod = await loadModule();
    const onResult = vi.fn();
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mod.annotateFaithfulness('A', ['ctx'], cfg, onResult);
    expect(spyWarn).toHaveBeenCalledWith(
      '[Faithfulness] gate 模式在流式链路被忽略，按 annotate 处理',
    );
    expect(onResult).toHaveBeenCalledOnce();
    spyWarn.mockRestore();
  });

  it('LLM 异常时吞掉并 warn，不影响调用方', async () => {
    process.env.FAITHFULNESS_ENABLED = 'true';
    invokeMock.mockRejectedValue(new Error('timeout'));
    const mod = await loadModule();
    const onResult = vi.fn();
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mod.annotateFaithfulness('A', ['ctx'], cfg, onResult);
    expect(onResult).not.toHaveBeenCalled();
    expect(spyWarn).toHaveBeenCalledWith(expect.stringContaining('timeout'));
    spyWarn.mockRestore();
  });
});
