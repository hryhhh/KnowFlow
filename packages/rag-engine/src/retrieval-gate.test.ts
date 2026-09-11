import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./fusion/index.js', () => ({
  isSparseScoreNormalizationOn: vi.fn(),
}));

import {
  evaluateQualityGate,
  isQualityGateEnabled,
  getQualityGateThreshold,
  QUALITY_GATE_FIXED_ANSWER,
  type QualityGateVerdict,
} from './retrieval-gate.js';
import * as fusion from './fusion/index.js';

describe('检索质量闸门（A3）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RETRIEVAL_QUALITY_GATE_ENABLED;
    delete process.env.RETRIEVAL_QUALITY_GATE_THRESHOLD;
  });

  afterEach(() => {
    delete process.env.RETRIEVAL_QUALITY_GATE_ENABLED;
    delete process.env.RETRIEVAL_QUALITY_GATE_THRESHOLD;
  });

  // --- 开关与阈值 ---

  it('isQualityGateEnabled 默认 false', () => {
    expect(isQualityGateEnabled()).toBe(false);
  });

  it('isQualityGateEnabled 开启', () => {
    process.env.RETRIEVAL_QUALITY_GATE_ENABLED = 'true';
    expect(isQualityGateEnabled()).toBe(true);
  });

  it('getQualityGateThreshold 默认 0.35', () => {
    expect(getQualityGateThreshold()).toBe(0.35);
  });

  it('getQualityGateThreshold 自定义值', () => {
    process.env.RETRIEVAL_QUALITY_GATE_THRESHOLD = '0.5';
    expect(getQualityGateThreshold()).toBe(0.5);
  });

  it('getQualityGateThreshold 非法值回退默认', () => {
    process.env.RETRIEVAL_QUALITY_GATE_THRESHOLD = 'abc';
    expect(getQualityGateThreshold()).toBe(0.35);
  });

  // --- 常量导出 ---

  it('QUALITY_GATE_FIXED_ANSWER 非空', () => {
    expect(QUALITY_GATE_FIXED_ANSWER.length).toBeGreaterThan(0);
  });

  // --- evaluateQualityGate 核心逻辑 ---

  const goodResult = [{ score: 0.8 }];
  const badResult = [{ score: 0.2 }];
  const emptyResult: Array<{ score: number }> = [];

  it('闸门关闭时任何情况都不拦截', () => {
    const r = evaluateQualityGate(badResult, 'vector', 'rrf');
    expect(r).toEqual({ gated: false, top1: 0.2, warned: false });
  });

  it('闸门开启 + vector + top1 高于阈值 → 放行', () => {
    process.env.RETRIEVAL_QUALITY_GATE_ENABLED = 'true';
    const r = evaluateQualityGate(goodResult, 'vector', 'rrf');
    expect(r).toEqual({ gated: false, top1: 0.8, warned: false });
  });

  it('闸门开启 + vector + top1 低于阈值 → 拦截', () => {
    process.env.RETRIEVAL_QUALITY_GATE_ENABLED = 'true';
    const r = evaluateQualityGate(badResult, 'vector', 'rrf');
    expect(r).toEqual({ gated: true, top1: 0.2, warned: false });
  });

  it('闸门开启 + 空结果 → 拦截', () => {
    process.env.RETRIEVAL_QUALITY_GATE_ENABLED = 'true';
    const r = evaluateQualityGate(emptyResult, 'vector', 'rrf');
    expect(r).toEqual({ gated: true, top1: null, warned: false });
  });

  it('闸门开启 + hybrid+linear + top1 低于阈值 → 拦截（无需 A5）', () => {
    process.env.RETRIEVAL_QUALITY_GATE_ENABLED = 'true';
    const r = evaluateQualityGate(badResult, 'hybrid', 'linear');
    expect(r).toEqual({ gated: true, top1: 0.2, warned: false });
  });

  it('闸门开启 + keyword + A5 off → 仅 warn 不拦截', () => {
    process.env.RETRIEVAL_QUALITY_GATE_ENABLED = 'true';
    vi.mocked(fusion.isSparseScoreNormalizationOn).mockReturnValue(false);
    const r = evaluateQualityGate(badResult, 'keyword', 'rrf');
    expect(r.gated).toBe(false);
    expect(r.warned).toBe(true);
  });

  it('闸门开启 + hybrid+RRF + A5 off → 仅 warn 不拦截', () => {
    process.env.RETRIEVAL_QUALITY_GATE_ENABLED = 'true';
    vi.mocked(fusion.isSparseScoreNormalizationOn).mockReturnValue(false);
    const r = evaluateQualityGate(badResult, 'hybrid', 'rrf');
    expect(r.gated).toBe(false);
    expect(r.warned).toBe(true);
  });

  it('闸门开启 + keyword + A5 on → 拦截', () => {
    process.env.RETRIEVAL_QUALITY_GATE_ENABLED = 'true';
    vi.mocked(fusion.isSparseScoreNormalizationOn).mockReturnValue(true);
    const r = evaluateQualityGate(badResult, 'keyword', 'rrf');
    expect(r.gated).toBe(true);
    expect(r.warned).toBe(false);
  });

  it('闸门开启 + hybrid+RRF + A5 on → 拦截', () => {
    process.env.RETRIEVAL_QUALITY_GATE_ENABLED = 'true';
    vi.mocked(fusion.isSparseScoreNormalizationOn).mockReturnValue(true);
    const r = evaluateQualityGate(badResult, 'hybrid', 'rrf');
    expect(r.gated).toBe(true);
    expect(r.warned).toBe(false);
  });

  it('A5 off 时 keyword/hybrid+RRF 仅 warn 不拦截，A5 on 时四模式一致拦截', () => {
    process.env.RETRIEVAL_QUALITY_GATE_ENABLED = 'true';
    const threshold = getQualityGateThreshold();
    const badResults = badResult;

    // A5 off
    vi.mocked(fusion.isSparseScoreNormalizationOn).mockReturnValue(false);
    expect(evaluateQualityGate(badResults, 'keyword', 'rrf').gated).toBe(false);
    expect(evaluateQualityGate(badResults, 'hybrid', 'rrf').gated).toBe(false);

    // A5 on
    vi.mocked(fusion.isSparseScoreNormalizationOn).mockReturnValue(true);
    expect(evaluateQualityGate(badResults, 'keyword', 'rrf').gated).toBe(true);
    expect(evaluateQualityGate(badResults, 'hybrid', 'rrf').gated).toBe(true);
    expect(evaluateQualityGate(badResults, 'vector', 'rrf').gated).toBe(true);
    expect(evaluateQualityGate(badResults, 'hybrid', 'linear').gated).toBe(true);
  });
});
