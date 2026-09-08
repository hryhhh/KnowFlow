/**
 * A1 评测指标：路由命中率 / 工具轨迹匹配 / LLM-as-judge 答案分 + baseline 回归对比。
 * 全部为纯函数（judge 除外），便于单测与 runner 复用。
 */
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { LLMConfig } from '@knowbase-x/rag-engine';

/** 单类指标汇总 */
export interface CategoryMetric {
  total: number;
  passed: number;
  passRate: number; // 0~1（error 用例不计入分母）
  errors: number;
}

/** 整体评测报告 */
export interface EvalReport {
  timestamp: string;
  durationMs: number;
  routing: CategoryMetric;
  tool_trajectory: CategoryMetric;
  answer_quality: CategoryMetric;
  cases: Array<{
    id: string;
    category: string;
    query: string;
    passed: boolean | null; // null = error
    error?: string;
    detail?: Record<string, unknown>;
  }>;
}

// ---------------------------------------------------------------------------
// 路由命中率：match() 返回的 targetAgent 集合与 expected.agents 完全一致（集合等价）
// alwaysIncludeAgents 注入项不出现在 match() 结果中，无需剔除
// ---------------------------------------------------------------------------
export function evaluateRouting(matchedTargets: string[], expectedAgents: string[]): boolean {
  const normalize = (arr: string[]) => [...new Set(arr)].sort();
  const a = normalize(matchedTargets);
  const b = normalize(expectedAgents);
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

// ---------------------------------------------------------------------------
// 轨迹匹配：trace 中 tool_call 的工具名序列包含 expected.tools 且相对顺序一致，
// 额外工具数 ≤ 1（PRD-P1 A1）
// ---------------------------------------------------------------------------
export function evaluateTrajectory(toolNames: string[], expectedTools: string[]): boolean {
  // 相对顺序子序列匹配
  let cursor = 0;
  for (const name of toolNames) {
    if (name === expectedTools[cursor]) cursor++;
  }
  const orderMatched = cursor >= expectedTools.length;
  const extraTools = toolNames.length - expectedTools.length;
  return orderMatched && extraTools <= 1;
}

// ---------------------------------------------------------------------------
// LLM-as-judge：rubric 五分制（事实忠实性 / 问题覆盖 / 拒答正确性）
// pass = 事实忠实性 ≥ 4 且三维均分 ≥ 4（judge temperature=0；解析失败记 error 不计入分母）
// ---------------------------------------------------------------------------
export interface JudgeVerdict {
  faithfulness: number;
  coverage: number;
  refusal: number;
  reason: string;
  passed: boolean;
}

const JUDGE_SYSTEM_PROMPT = `你是严格的问答质量评审员。给定【用户问题】【参考答案】【必须包含的事实点】【检索到的参考资料】【待评答案】，按三个维度打分（1~5 整数）：
- faithfulness（事实忠实性）：待评答案与参考答案/事实点/参考资料是否一致，无编造；
- coverage（问题覆盖）：是否回答了用户问题的核心；
- refusal（拒答正确性）：若参考答案表明应拒答（资料中无相关信息），答案明确说明无法回答得高分；若应回答却胡编得低分。
重要：判断"编造"必须以【检索到的参考资料】为准——答案中的信息只要能被参考资料支撑即视为忠实，即使参考答案未提及。
只输出严格 JSON：{"faithfulness":n,"coverage":n,"refusal":n,"reason":"一句话"}`;

export async function judgeAnswer(args: {
  question: string;
  answer: string;
  referenceAnswer: string;
  mustContain: string[];
  expectRefuse: boolean;
  /** rag_search 返回的参考资料（用于判定"编造"，A1 修正：judge 必须能看到检索材料） */
  contexts?: string[];
  config: LLMConfig;
}): Promise<JudgeVerdict> {
  const llm = new ChatOpenAI({
    apiKey: args.config.apiKey,
    model: args.config.model,
    temperature: 0,
    configuration: { baseURL: args.config.baseURL },
  });

  const contextsBlock =
    args.contexts && args.contexts.length > 0
      ? args.contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')
      : '（未提供）';

  const user = [
    `【用户问题】${args.question}`,
    `【参考答案】${args.referenceAnswer}`,
    `【必须包含的事实点】${args.mustContain.length ? args.mustContain.join('；') : '（无）'}`,
    `【期望行为】${args.expectRefuse ? '应当拒答（资料中无相关信息）' : '应当给出准确回答'}`,
    `【检索到的参考资料】\n${contextsBlock}`,
    `【待评答案】${args.answer || '（空）'}`,
  ].join('\n\n');

  const res = await llm.invoke([new SystemMessage(JUDGE_SYSTEM_PROMPT), new HumanMessage(user)]);
  const raw = typeof res.content === 'string' ? res.content : String(res.content);

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('judge 输出中未找到 JSON');
  const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;

  const clamp = (v: unknown) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 3;
  };
  const faithfulness = clamp(parsed.faithfulness);
  const coverage = clamp(parsed.coverage);
  const refusal = clamp(parsed.refusal);
  const avg = (faithfulness + coverage + refusal) / 3;
  return {
    faithfulness,
    coverage,
    refusal,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    passed: faithfulness >= 4 && avg >= 4,
  };
}

// ---------------------------------------------------------------------------
// 汇总与 baseline 对比：任一指标下降超过 2 个百分点 → 回归（exit 1）
// ---------------------------------------------------------------------------
export function summarize(cases: EvalReport['cases']): {
  routing: CategoryMetric;
  tool_trajectory: CategoryMetric;
  answer_quality: CategoryMetric;
} {
  const bucket = (category: string): CategoryMetric => {
    const list = cases.filter((c) => c.category === category && c.passed !== null);
    const errors = cases.filter((c) => c.category === category && c.passed === null).length;
    const passed = list.filter((c) => c.passed === true).length;
    return {
      total: list.length,
      passed,
      passRate: list.length ? passed / list.length : 0,
      errors,
    };
  };
  return {
    routing: bucket('routing'),
    tool_trajectory: bucket('tool_trajectory'),
    answer_quality: bucket('answer_quality'),
  };
}

export function compareWithBaseline(
  current: { routing: number; tool_trajectory: number; answer_quality: number },
  baseline: { routing: number; tool_trajectory: number; answer_quality: number },
  threshold = 0.02,
): { ok: boolean; regressions: string[] } {
  const regressions: string[] = [];
  for (const key of ['routing', 'tool_trajectory', 'answer_quality'] as const) {
    const drop = baseline[key] - current[key];
    if (drop > threshold) {
      regressions.push(
        `${key}: ${(baseline[key] * 100).toFixed(1)}% → ${(current[key] * 100).toFixed(1)}%（下降 ${(drop * 100).toFixed(1)}pp > ${threshold * 100}pp）`,
      );
    }
  }
  return { ok: regressions.length === 0, regressions };
}
