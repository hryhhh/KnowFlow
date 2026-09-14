import { isSparseScoreNormalizationOn } from './fusion/index.js';

/**
 * A3 检索质量闸门（RETRIEVAL_QUALITY_GATE_*，见 docs/18-agent-prd-quality-guardrails.md）
 *
 * - 硬闸：retrieveAndChat 在结果为空或 top1 低于阈值时跳过 LLM，直接输出固定拒答文案；
 *   首期仅对分数天然处于 [0,1] 的模式生效（vector / hybrid+linear），
 *   keyword（ts_rank 无界）与 hybrid+RRF 在 A5 归一化翻 on 前只记 warn 不拦截。
 * - 软信号：rag_search 工具（packages/agents）用同一阈值打 lowQuality 标记，不拦截。
 */
export const QUALITY_GATE_FIXED_ANSWER =
  '当前知识库中未找到与问题相关的资料，请调整问法或补充文档。';

/** 闸门总开关（默认 false = 现状行为；经 A1 评测标定后灰度翻默认并登记） */
export function isQualityGateEnabled(): boolean {
  return process.env.RETRIEVAL_QUALITY_GATE_ENABLED === 'true';
}

/** top1 分数阈值（默认 0.35；A1 评测产出后回填标定） */
export function getQualityGateThreshold(): number {
  const raw = process.env.RETRIEVAL_QUALITY_GATE_THRESHOLD;
  if (raw === undefined || raw.trim() === '') return 0.35;
  const n = Number(raw);
  return Number.isNaN(n) ? 0.35 : n;
}

/** 该模式是否具备硬闸量纲前提 */
function hardGateEligible(mode: string, fusionMethod: string): boolean {
  if (mode === 'vector') return true;
  if (mode === 'hybrid') {
    if (fusionMethod === 'linear') return true;
    // RRF 融合分在 A5 归一化 on 后才映射到 [0,1]
    if (fusionMethod === 'rrf') return isSparseScoreNormalizationOn();
  }
  if (mode === 'keyword') return isSparseScoreNormalizationOn();
  // 兜底分支与 vector 同语义
  return true;
}

export interface QualityGateVerdict {
  /** true = 命中硬闸（结果为空或 top1 低于阈值），调用方应跳过 LLM */
  gated: boolean;
  top1: number | null;
  /** 量纲不可比（keyword / hybrid+RRF 且 A5 off）：不拦截但记 warn */
  warned: boolean;
}

/**
 * 评估检索质量闸门。results 须为 minScore 过滤后的最终候选（按分数降序）。
 */
export function evaluateQualityGate(
  results: Array<{ score: number }>,
  mode: string,
  fusionMethod: string,
): QualityGateVerdict {
  const top1 = results.length > 0 ? results[0].score : null;
  if (!isQualityGateEnabled()) {
    return { gated: false, top1, warned: false };
  }
  // 空结果：任何模式都命中硬闸
  if (top1 === null) {
    return { gated: true, top1, warned: false };
  }
  const threshold = getQualityGateThreshold();
  if (top1 >= threshold) {
    return { gated: false, top1, warned: false };
  }
  if (hardGateEligible(mode, fusionMethod)) {
    return { gated: true, top1, warned: false };
  }
  console.warn(
    `[QualityGate] top1=${top1.toFixed(2)} 低于阈值 ${threshold}，但 ${mode}` +
      `${fusionMethod ? `+${fusionMethod}` : ''} 分数量纲未归一化（A5 off），仅记录不拦截`,
  );
  return { gated: false, top1, warned: true };
}
