/**
 * A1 Agent 评测 Runner（pnpm eval:agent）
 *
 * - 直接调用 @knowbase-x/agents 的 IntentRouter.match()（routing）与 AgentRuntime.run()（其余），不走 HTTP
 * - 三类指标：路由命中率 / 工具轨迹匹配 / LLM-as-judge 答案分
 * - 报告：tests/eval/report/agent-eval-<timestamp>.json（+ latest.json）
 * - baseline 对比：--baseline <path>；任一指标下降 > 2pp → exit 1（回归门槛）
 * - 无 LLM_API_KEY 时打印 SKIP 并 exit 0（CI 观察期）
 */
import path from 'node:path';
import fs from 'node:fs';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env') });

import {
  AgentRuntime,
  IntentRouter,
  ToolRegistry,
  RagSearchTool,
  type AgentRunParams,
  type LLMConfig as AgentsLLMConfig,
} from '@knowbase-x/agents';
import {
  retrieve,
  type RAGPipelineConfig,
  type LLMConfig,
  type SearchParams,
} from '@knowbase-x/rag-engine';
import { EVAL_KB_ID, setupEvalKb, CORPUS_FILES } from './setup.js';
import {
  evaluateRouting,
  evaluateTrajectory,
  judgeAnswer,
  summarize,
  compareWithBaseline,
  type EvalReport,
} from './metrics.js';

// ---------------------------------------------------------------------------

const repoRoot = path.resolve(import.meta.dirname, '../..');
const REPORT_DIR = path.join(repoRoot, 'tests/eval/report');

interface GoldenCase {
  id: string;
  category: 'routing' | 'tool_trajectory' | 'answer_quality';
  query: string;
  kbId?: string;
  env?: Record<string, string>;
  expected: {
    agents?: string[];
    tools?: string[];
    mustContain?: string[];
    referenceAnswer?: string;
    refuse?: boolean;
  };
}

function loadGoldenCases(): GoldenCase[] {
  const file = path.join(repoRoot, 'tests/eval/golden/agent-eval-cases.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { cases: GoldenCase[] };
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error('golden set 为空');
  }
  return parsed.cases;
}

function buildRagConfig(): RAGPipelineConfig {
  return {
    pg: {
      host: process.env.DATABASE_HOST ?? 'localhost',
      port: Number(process.env.DATABASE_PORT ?? 5432),
      user: process.env.DATABASE_USER ?? 'postgres',
      password: process.env.DATABASE_PASSWORD ?? '123456',
      database: process.env.DATABASE_NAME ?? 'knowledge_rag',
    },
    llm: {
      apiKey: process.env.LLM_API_KEY ?? '',
      model: process.env.LLM_MODEL ?? 'qwen3.7-plus',
      baseURL: process.env.LLM_BASE_URL ?? '',
    },
    embedding: {
      apiKey: process.env.LLM_API_KEY ?? '',
      model: process.env.EMBEDDING_MODEL ?? 'text-embedding-v4',
      baseURL: process.env.LLM_BASE_URL ?? '',
      dimensions: Number(process.env.EMBEDDING_DIMENSIONS ?? 1024),
    },
  };
}

/** 与服务端 initTools 对齐的评测工具集（rag_search 注入 rag-engine retrieve）。
 * 检索参数显式 hybrid+rrf：deprecated 路径（useReranker→hybrid+linear）叠加 minScore=0.5
 * 会在组合词查询上过度过滤（A5 要解决的量纲问题），导致轨迹与答案用例系统性失真。 */
function buildToolRegistry(ragConfig: RAGPipelineConfig): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(
    new RagSearchTool(async (query, kbId, p) => {
      const result = await retrieve(
        query,
        kbId,
        {
          topK: p.topK,
          minScore: p.minScore,
          useReranker: false,
          denseWeight: 0.5,
          retrievalMode: 'hybrid',
          fusionMethod: 'rrf',
        } as SearchParams,
        ragConfig,
      );
      return result.results;
    }),
  );
  return registry;
}

/** 用例级环境覆盖（进入前应用，退出后恢复） */
async function withCaseEnv<T>(
  env: Record<string, string> | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(env ?? {})) {
    saved.set(k, process.env[k]);
    process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function runCase(
  testCase: GoldenCase,
  router: IntentRouter,
  runtime: AgentRuntime,
  registry: ToolRegistry,
  ragConfig: RAGPipelineConfig,
  judgeConfig: LLMConfig,
): Promise<{ passed: boolean | null; error?: string; detail?: Record<string, unknown> }> {
  return withCaseEnv(testCase.env, async () => {
    try {
      if (testCase.category === 'routing') {
        const { matched } = await router.match(testCase.query);
        // 评测口径（PRD A1）：剔除 alwaysInclude 注入项（score=0.0）与 llm-intent-classifier 元规则，
        // 仅保留真实命中的目标 Agent
        const targets = [
          ...new Set(
            matched
              .filter((m) => m.score > 0 && m.rule.targetAgent !== 'llm-intent-classifier')
              .map((m) => m.rule.targetAgent),
          ),
        ];
        const passed = evaluateRouting(targets, testCase.expected.agents ?? []);
        return { passed, detail: { matchedTargets: targets } };
      }

      // tool_trajectory / answer_quality：AgentRuntime（ReAct）
      // golden 中的 kbId 为标签 "eval-kb"，统一映射到固定 UUID（pg uuid 列类型要求）
      const resolvedKbId =
        !testCase.kbId || testCase.kbId === 'eval-kb' ? EVAL_KB_ID : testCase.kbId;
      const runtimeParams: AgentRunParams = {
        query: testCase.query,
        kbId: resolvedKbId,
        sessionId: null,
        traceId: `eval_${testCase.id}`,
        messages: [],
        searchParams: { topK: 8, minScore: 0.3 },
        llmConfig: ragConfig.llm as AgentsLLMConfig,
        tools: registry,
        emitEvent: () => {},
      };
      const result = await runtime.run(runtimeParams);

      const toolSteps = (result.context?.trace?.steps ?? []).filter(
        (s: any) => s.type === 'tool_call',
      );
      const toolNames = toolSteps.map((s: any) => s.data?.toolName).filter(Boolean) as string[];
      const toolOutputLengths = toolSteps.map((s: any) => s.data?.outputLength ?? 0);

      if (testCase.category === 'tool_trajectory') {
        const passed = evaluateTrajectory(toolNames, testCase.expected.tools ?? []);
        return { passed, detail: { toolNames, toolOutputLengths, status: result.status } };
      }

      // answer_quality：LLM-as-judge（judge 必须能看到检索材料，否则正确引用语料的答案会被误判为编造）
      const verdict = await judgeAnswer({
        question: testCase.query,
        answer: result.finalAnswer,
        referenceAnswer: testCase.expected.referenceAnswer ?? '',
        mustContain: testCase.expected.mustContain ?? [],
        expectRefuse: testCase.expected.refuse ?? false,
        contexts: result.context?.ragContexts ?? [],
        config: judgeConfig,
      });
      return {
        passed: verdict.passed,
        detail: {
          judge: verdict,
          toolNames,
          toolOutputLengths,
          finalAnswer: result.finalAnswer?.slice(0, 300),
        },
      };
    } catch (err) {
      // error 用例不计入分母（judge 解析失败 / 运行异常）
      return {
        passed: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const skipSetup = args.includes('--skip-setup');
  const baselineIdx = args.indexOf('--baseline');
  const baselinePath = baselineIdx !== -1 ? path.resolve(args[baselineIdx + 1]) : undefined;
  const onlyIdx = args.indexOf('--only');
  const onlyIds = onlyIdx !== -1 ? args[onlyIdx + 1].split(',') : undefined;
  const categoryIdx = args.indexOf('--category');
  const onlyCategory = categoryIdx !== -1 ? args[categoryIdx + 1] : undefined;

  if (!process.env.LLM_API_KEY) {
    console.warn('::warning:: LLM_API_KEY 未设置，跳过 Agent 评测（SKIP）');
    process.exit(0);
  }

  const startedAt = Date.now();
  const cases = loadGoldenCases();

  // 前置：评测知识库（幂等，先删后建；含冒烟断言）
  if (!skipSetup) {
    console.log('[eval] 准备评测知识库（eval-kb）…');
    await setupEvalKb();
  } else {
    console.log('[eval] 跳过评测知识库构建（--skip-setup）');
  }

  const ragConfig = buildRagConfig();
  const router = new IntentRouter(
    process.env.ROUTER_RULES_PATH ?? path.join(repoRoot, 'config/router.rules.yml'),
    {
      apiKey: process.env.LLM_API_KEY ?? '',
      model: process.env.LLM_MODEL ?? 'qwen3.7-plus',
      baseURL: process.env.LLM_BASE_URL ?? '',
    },
  );
  const registry = buildToolRegistry(ragConfig);
  const runtime = new AgentRuntime();
  const judgeConfig: LLMConfig = ragConfig.llm;

  const reportCases: EvalReport['cases'] = [];
  for (const testCase of cases) {
    if (onlyIds && !onlyIds.includes(testCase.id)) continue;
    if (onlyCategory && testCase.category !== onlyCategory) continue;
    process.stdout.write(`[eval] ${testCase.id} (${testCase.category}) … `);
    const outcome = await runCase(testCase, router, runtime, registry, ragConfig, judgeConfig);
    reportCases.push({
      id: testCase.id,
      category: testCase.category,
      query: testCase.query,
      passed: outcome.passed,
      error: outcome.error,
      detail: outcome.detail,
    });
    console.log(
      outcome.passed === null ? `ERROR: ${outcome.error}` : outcome.passed ? 'PASS' : 'FAIL',
    );
  }
  router.stop();

  const summary = summarize(reportCases);
  const report: EvalReport = {
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    ...summary,
    cases: reportCases,
  };

  // 报告归档
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(REPORT_DIR, `agent-eval-${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(REPORT_DIR, 'latest.json'), JSON.stringify(report, null, 2));

  // 控制台摘要表
  const fmt = (m: { passed: number; total: number; passRate: number; errors: number }) =>
    `${m.passed}/${m.total} (${(m.passRate * 100).toFixed(1)}%)${m.errors ? ` [${m.errors} error]` : ''}`;
  console.log('\n================ Agent Eval Summary ================');
  console.log(`路由命中率      : ${fmt(summary.routing)}`);
  console.log(`工具轨迹匹配    : ${fmt(summary.tool_trajectory)}`);
  console.log(`答案质量(judge) : ${fmt(summary.answer_quality)}`);
  console.log(`报告: ${reportPath}\n`);

  // baseline 回归门槛
  if (baselinePath) {
    if (!fs.existsSync(baselinePath)) {
      console.error(`[eval] baseline 文件不存在: ${baselinePath}`);
      process.exit(1);
    }
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
    const current = {
      routing: summary.routing.passRate,
      tool_trajectory: summary.tool_trajectory.passRate,
      answer_quality: summary.answer_quality.passRate,
    };
    const base = {
      routing: baseline.routing?.passRate ?? 0,
      tool_trajectory: baseline.tool_trajectory?.passRate ?? 0,
      answer_quality: baseline.answer_quality?.passRate ?? 0,
    };
    const cmp = compareWithBaseline(current, base);
    if (!cmp.ok) {
      console.error('[eval] ❌ 指标回归（下降超过 2pp）:');
      for (const r of cmp.regressions) console.error(`  - ${r}`);
      process.exit(1);
    }
    console.log('[eval] ✓ baseline 对比通过（无 >2pp 回归）');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[eval] 运行失败:', err);
    process.exit(1);
  });

// 引用（供 setup 的常量一致性检查与未来扩展使用）
void CORPUS_FILES;
