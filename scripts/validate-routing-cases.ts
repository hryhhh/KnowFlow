/** A1 本地验证：22 条 routing 用例与真实 IntentRouter 的一致性（不修改任何文件） */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
import { IntentRouter } from '@knowbase-x/agents';
import { evaluateRouting } from '../tests/eval/metrics';
import golden from '../tests/eval/golden/agent-eval-cases.json';

async function main() {
  const router = new IntentRouter('config/router.rules.yml', {
    apiKey: process.env.LLM_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? 'qwen3.7-plus',
    baseURL: process.env.LLM_BASE_URL ?? '',
  });

  let pass = 0;
  let fail = 0;
  for (const c of golden.cases.filter((x) => x.category === 'routing')) {
    const { matched } = await router.match(c.query);
    // 与 runner 一致：剔除 alwaysInclude 注入（score=0）与 llm-intent-classifier 元规则
    const targets = [
      ...new Set(
        matched
          .filter((m) => m.score > 0 && m.rule.targetAgent !== 'llm-intent-classifier')
          .map((m) => m.rule.targetAgent),
      ),
    ];
    const ok = evaluateRouting(targets, c.expected.agents!);
    if (ok) pass++;
    else {
      fail++;
      console.log(`✗ ${c.id} "${c.query}"`);
      console.log(`   期望: [${c.expected.agents!.join(',')}] 实际: [${targets.join(',')}]`);
    }
  }
  router.stop();
  console.log(`\n路由用例验证: ${pass}/${pass + fail} 通过`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
