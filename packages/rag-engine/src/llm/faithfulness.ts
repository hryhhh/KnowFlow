import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { LLMConfig } from '../types.js';

/** 总开关（默认 false = 关闭时零额外调用） */
export function isFaithfulnessEnabled(): boolean {
  return process.env.FAITHFULNESS_ENABLED === 'true';
}

/** 运行模式（默认 annotate；gate 仅非流式链路生效） */
export function getFaithfulnessMode(): 'annotate' | 'gate' {
  const raw = process.env.FAITHFULNESS_MODE;
  return raw === 'gate' ? 'gate' : 'annotate';
}

/** gate 模式拒答阈值（默认 0.8） */
export function getFaithfulnessMinScore(): number {
  const raw = process.env.FAITHFULNESS_MIN_SCORE;
  if (raw === undefined || raw.trim() === '') return 0.8;
  const n = Number(raw);
  return Number.isNaN(n) ? 0.8 : n;
}

/** 校验超时（默认 3000ms；非法值回退默认） */
export function getFaithfulnessTimeoutMs(): number {
  const raw = process.env.FAITHFULNESS_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === '') return 3000;
  const n = Number(raw);
  return Number.isNaN(n) || n <= 0 ? 3000 : n;
}

export interface FaithfulnessClaim {
  /** 原子陈述（来自答案） */
  text: string;
  /** 是否能在检索材料中找到支撑 */
  supported: boolean;
  /** 支撑该陈述的检索结果序号（0-based，对应 contexts 下标） */
  evidenceIndexes: number[];
}

export interface FaithfulnessResult {
  /** 0~1，supported 比例；无陈述时记 1（无不可支撑陈述） */
  score: number;
  claims: FaithfulnessClaim[];
}

const SYSTEM_PROMPT = `你是事实核查助手。给定一段"答案"和若干编号"参考资料"，请把答案拆解为原子陈述（每条只包含一个事实点），逐条判断是否能被参考资料直接支撑。
输出严格的 JSON（不要输出任何其他文字或代码块标记），格式：
{"claims":[{"text":"陈述原文","supported":true,"evidenceIndexes":[1]}]}
要求：
- evidenceIndexes 为支撑该陈述的参考资料编号（从 1 开始）；无支撑时给空数组；
- 不确定/无法验证一律记 supported=false；
- 答案中的寒暄、过渡句不要拆为陈述。`;

/** 从模型输出中解析 JSON（容忍 ```json 代码块包裹） */
function parseClaimsJson(raw: string, contextCount: number): FaithfulnessClaim[] {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Faithfulness 输出中未找到 JSON');
  }
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
    claims: Array<{ text: string; supported?: boolean; evidenceIndexes?: unknown }>;
  };
  if (!Array.isArray(parsed.claims)) {
    throw new Error('Faithfulness 输出缺少 claims 数组');
  }
  const claims: FaithfulnessClaim[] = [];
  for (const c of parsed.claims) {
    if (typeof c.text !== 'string' || !c.text.trim()) continue;
    const indexes = Array.isArray(c.evidenceIndexes)
      ? c.evidenceIndexes
          .map((i) => Number(i) - 1) // 模型侧 1-based → contexts 0-based
          .filter((i) => Number.isInteger(i) && i >= 0 && i < contextCount)
      : [];
    claims.push({
      text: c.text.trim(),
      supported: c.supported === true,
      evidenceIndexes: indexes,
    });
  }
  return claims;
}

/**
 * 校验答案的忠实度。
 * @param answer 完整答案文本
 * @param contexts 检索材料（与答案中的引用编号对应）
 * @param config LLM 配置（temperature 固定 0）
 * @throws 任何 LLM/解析异常抛给调用方，由开关层吞掉
 */
export async function checkFaithfulness(
  answer: string,
  contexts: string[],
  config: LLMConfig,
): Promise<FaithfulnessResult> {
  if (!answer.trim() || contexts.length === 0) {
    return { score: 1, claims: [] };
  }
  const llm = new ChatOpenAI({
    apiKey: config.apiKey,
    model: config.model,
    temperature: 0,
    timeout: getFaithfulnessTimeoutMs(),
    configuration: { baseURL: config.baseURL },
  });
  const numberedContexts = contexts.map((c, i) => `[${i + 1}] ${c}`).join('\n\n');
  const response = await llm.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(`【答案】\n${answer}\n\n【参考资料】\n${numberedContexts}`),
  ]);
  const raw = typeof response.content === 'string' ? response.content : String(response.content);
  const claims = parseClaimsJson(raw, contexts.length);
  const supportedCount = claims.filter((c) => c.supported).length;
  const score = claims.length === 0 ? 1 : supportedCount / claims.length;
  return { score, claims };
}

/** gate 判定：score 是否达到放行阈值（仅非流式链路由调用方消费） */
export function isFaithfulnessGatePass(score: number): boolean {
  return score >= getFaithfulnessMinScore();
}

/**
 * 流式链路的标注钩子：在 onDone 之后异步调用。
 * - 总开关关闭 → 零开销直接返回；
 * - gate 模式在流式链路被显式忽略（warn）并按 annotate 处理；
 * - 任何异常吞掉（warn），不影响已完成的回答。
 */
export async function annotateFaithfulness(
  answer: string,
  contexts: string[],
  config: LLMConfig,
  onResult?: (result: FaithfulnessResult) => void,
): Promise<void> {
  try {
    if (!isFaithfulnessEnabled() || !answer.trim() || contexts.length === 0) return;
    if (getFaithfulnessMode() === 'gate') {
      console.warn('[Faithfulness] gate 模式在流式链路被忽略，按 annotate 处理');
    }
    const result = await checkFaithfulness(answer, contexts, config);
    onResult?.(result);
  } catch (err) {
    console.warn(
      `[Faithfulness] 校验失败（放行）: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
