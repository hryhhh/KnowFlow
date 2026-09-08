# Agent PRD — Phase 1：质量护栏与评测

> 编号：PRD-P1 ｜ 上游路线图：[09-agent-evolution-roadmap.md](09-agent-evolution-roadmap.md) ｜ 通用约定见 09 号 §九  
> 范围：A1 评测体系、A2 答案 faithfulness、A3 检索质量闸门、A4 temperature 收紧、A5 minScore 语义统一  
> 依赖：无外部依赖（A2/A3 的阈值参数依赖 A1 产出后再标定，但实现可先行）

---

## A1 Agent 评测体系

### 背景

现有 `packages/rag-engine/__tests__/fixtures/eval-queries.json` 仅覆盖检索召回。路由规则、ReAct 系统提示、工具描述的变更均无回归手段。

### 目标

建立可重复执行的 Agent 评测：30~50 条 golden set，三项指标，本地一键运行、CI 可选门禁、支持与基线报告对比。

### Golden Set 设计

位置：`tests/eval/golden/agent-eval-cases.json`（新目录，与 `tests/e2e/` 平级）。

```jsonc
{
  "id": "route-001", // 唯一 ID，前缀分类：route- / traj- / answer-
  "category": "routing", // routing | tool_trajectory | answer_quality
  "query": "本月新增客户多少",
  "kbId": "eval-kb", // 需要检索的用例指向评测知识库（setup 脚本创建）
  "env": {
    // 用例级环境覆盖（runner 注入 process.env）
    "AGENTS_ENABLED": "true",
    "AGENT_RUNTIME_ENABLED": "false",
  },
  "expected": {
    "agents": ["db-query"], // routing 用例：期望命中的目标 Agent 集合
    // alwaysIncludeAgents 注入项（如 ragflow）不计入比对
    "tools": ["rag_search"], // tool_trajectory 用例：期望工具名按序出现
    "mustContain": ["新增客户"], // answer 用例：答案必须包含的事实点（judge 辅助）
    "referenceAnswer": "本月新增客户 128 名。", // answer 用例：参考答案
    "refuse": false, // true = 期望拒答（配合 A3 闸门用例）
  },
}
```

规模要求：routing ≥ 20（含换问法/干扰用例），tool_trajectory ≥ 10，answer_quality ≥ 10。

> **内容前置投入（已确认）**：golden set 的真实问法、参考答案与期望路由轨迹需业务方提供（约 1~2 人日）——这是 A2/A3 阈值、B1 验收、D5 调优所有标定的可信度来源，Phase 1 启动前安排；开发侧仅搭 runner 与校验结构。

### 评测 Runner

- 脚本：`tests/eval/run-agent-eval.ts`（tsx 执行），入口命令 `pnpm eval:agent`（根 package.json）。
- 执行方式：直接调用 `@knowbase-x/agents` 的 `IntentRouter.match()`（routing 类）与 `AgentRuntime.run()`（其余类），不走 HTTP，避免依赖服务进程。
- 前置：`tests/eval/setup.ts` 创建评测知识库 `eval-kb` 并从 `test-data/` 摄入固定小语料（幂等：先删后建）。**语料文件名不得命中 pipeline 的测试文件过滤规则**（`/^gen-test-|\.test\.|\.spec\./`，见 `pipeline.ts` 检索后过滤），否则会被静默滤出检索；setup 完成后须断言每条语料均可被检索命中。
- 判定逻辑（`tests/eval/metrics.ts`）：
  - **路由命中率**：`match()` 返回的 targetAgent 集合与 `expected.agents` 完全一致（剔除 alwaysInclude 注入项）记 pass；
  - **轨迹匹配**：`trace.steps` 中 tool_call 的工具名序列包含 `expected.tools` 且相对顺序一致，额外工具数 ≤ 1 记 pass；
  - **LLM-as-judge**：rubric 五分制（事实忠实性 / 问题覆盖 / 拒答正确性，各 1~5 分），judge prompt 注入参考答案与 mustContain；pass = **事实忠实性 ≥ 4 且三维均分 ≥ 4**。judge 模型复用 `LLM_MODEL`，temperature 固定 0；judge 输出 JSON 强校验，解析失败该用例记 error、**不计入指标分母**（避免静默偏差）。**已知局限（已确认接受）**：judge 与被评模型同族（qwen），存在自评偏差，首期登记此局限；如需消除，后续引入独立 judge 模型配置（约 +0.5 人日，暂不排期）。
- 输出：`tests/eval/report/agent-eval-<timestamp>.json`（逐用例结果 + 三指标汇总）+ 控制台摘要表。
- 基线对比：`pnpm eval:agent -- --baseline tests/eval/report/baseline.json`；任一指标下降超过 2 个百分点 → exit 1（回归门槛）。

### CI 集成

- 新增独立 job（现有 CI 配置文件中追加），仅当 secrets 提供 `LLM_API_KEY` 时执行 `pnpm eval:agent`，否则打印 SKIP 警告；**不**挂入 `pnpm test:ci` 的失败门禁（首期观察期），报告以 artifact 上传；job 设 `concurrency: 1` 且仅 main 分支与手动触发（`workflow_dispatch`），控制 LLM 调用成本。
- 成本量级（估算，需知情确认）：单次全量评测 ≈ 40 用例 ×（生成 + judge）≈ 8 万 tokens ≈ $0.2/次（qwen3.7-plus 价目）；D5 网格 9 组 × 2 次 ≈ $4；CI 每次触发 <$0.5。
- **观察期转正（已确认）**：Phase 1 收尾、baseline 归档且连续两次运行无异常波动后，`--baseline` 对比转为 CI 必需门禁（移入 required job）。
- 评测知识库与业务数据隔离：`eval-kb` 使用独立命名前缀，setup/teardown 保证不污染。

### 验收标准

- [ ] golden set ≥ 40 条且三类齐备；
- [ ] `pnpm eval:agent` 本地一键跑通，产出报告；
- [ ] baseline 对比能拦截人为注入的路由规则退化（验证方式：故意改错一条规则后重跑，exit 1）；
- [ ] CI job 在无 Key 环境下 SKIP 不失败。

### 工作量

3~4 人日（dataset 1.5、runner+metrics 1.5、CI 0.5）。

---

## A2 答案 Faithfulness 校验

### 背景与约束

流式链路中 token 已实时推给用户，**无法撤回**。因此本期定位为**标注层**而非拦截层：在回答完成后附加校验结果，供前端与 Trace 呈现；同步非流式链路（`/api/agents/route`、后续 D1）可选 `gate` 模式。

**校验不阻塞完成事件**：`done` / `agent_completed` 先行发出，faithfulness 结果校验完成后以独立事件异步追加、并增量写入 trace（`TraceService` 需支持对已落库 trace 追加 step）。避免答案已流完但连接因校验（最长 3s 超时 + LLM 时延）继续挂起、被用户误判为卡死。

### 前置 spike（0.5 人日，已确认列为 A2 第一任务）

用 20 条真实问答样本（中文为主）人工核对原子陈述抽取质量与逐条比对效果，确认"单次调用完成抽取+比对"的结构与 3s 超时的可行性，标定 `FAITHFULNESS_MIN_SCORE` 初始值；spike 结论归档后进入实现——mock 单测无法验证抽取质量，此步不可省略。

### 设计

- 新模块：`packages/rag-engine/src/llm/faithfulness.ts`

```typescript
export interface FaithfulnessResult {
  score: number; // 0~1，supported 比例
  claims: Array<{
    text: string; // 从答案中抽取的原子陈述
    supported: boolean;
    evidenceIndexes: number[]; // 支撑该陈述的检索结果序号
  }>;
}

/** LLM 抽取答案原子陈述 → 逐条与检索材料比对。任何异常抛给调用方由开关层吞掉 */
export async function checkFaithfulness(
  answer: string,
  contexts: string[],
  config: LLMConfig,
): Promise<FaithfulnessResult>;
```

- 接入点（两处，共用上述函数，均在完成事件**之后**异步执行）：
  1. 传统 RAG：`pipeline.retrieveAndChat()` 的 `callbacks.onDone()` 之后；
  2. Runtime：`agent-chat.service.ts` `agent_completed` 事件之后。
- 新 SSE 事件：`faithfulness`，value 为 `FaithfulnessResult`（增量事件，旧客户端忽略）。
- Trace：`agent_traces.steps` 新增 `type: 'faithfulness'` 记录。
- gate 模式仅在非流式链路生效：score < 阈值时返回错误响应（code 422，message 提示答案可信度不足）。

### 环境变量（`env.ts` 注册）

| 变量                      | 默认       | 说明                                                           |
| ------------------------- | ---------- | -------------------------------------------------------------- |
| `FAITHFULNESS_ENABLED`    | `false`    | 总开关，关闭时零额外调用                                       |
| `FAITHFULNESS_MODE`       | `annotate` | `annotate` \| `gate`（gate 仅非流式生效）                      |
| `FAITHFULNESS_MIN_SCORE`  | `0.8`      | gate 模式拒答阈值                                              |
| `FAITHFULNESS_TIMEOUT_MS` | `3000`     | 校验超时；超时/异常时无结果事件并记 warn（不影响已完成的回答） |

### 验收标准

- [ ] 单测：mock LLM 返回，覆盖全支撑 / 部分支撑 / 超时 / 异常四路径；
- [ ] enabled 时 trace 出现 faithfulness 步骤（完成事件后增量追加），SSE 收到事件；disabled 时行为与现状逐字节一致；
- [ ] `done` / `agent_completed` 不被校验阻塞：mock 校验耗时 5s 时完成事件仍即时发出；
- [ ] 前端呈现：消息尾部渲染支撑度徽标、Trace 详情页展示 claims 列表（计入本项工作量）；
- [ ] gate 模式在流式链路被显式忽略并打 warn（防止误配置）。

### 工作量

3 人日（前置 spike 0.5、校验与接入 1.5、trace 增量追加 0.5、前端徽标与 Trace 页展示 0.5）。

---

## A3 检索质量闸门

### 设计（区分两条链路，语义不同）

1. **传统 RAG / fast-path（硬闸）**：`pipeline.retrieveAndChat()` 检索完成后，若结果为空或 top1 分数 < 阈值：
   - **首期仅对 vector / hybrid+linear 模式生效**（其分数天然处于 [0,1]）；keyword（ts_rank 无界）与 hybrid+RRF 在 A5 归一化默认翻 `on` 之前量纲不可比，只记 warn **不拦截**，A5 翻默认后再放开；
   - 不调用 LLM，推 `process` 事件 `{ stage: 'no_result', label: '未找到相关信息…' }`；
   - 直接以固定文案流式输出（"当前知识库中未找到与问题相关的资料，请调整问法或补充文档。"）后 `done`；
   - `usage_logs` 照常记录（status=success，duration 为检索耗时），并写入 `gate_reason = 'retrieval_quality_gate'`（新列，随 D4 的 usage_logs 迁移同批；看板可区分闸门拒答，不破坏现有 status 语义）。
2. **Runtime 链路（软信号）**：`rag_search` 工具在 top1 分数 < 阈值时**不拦截**，而是在 `ToolResult.structured` 增加 `lowQuality: true` 与 `maxScore`，content 前缀提示"检索结果相关度较低（最高 0.21）"——把换写法/换工具的决策留给模型（这正是 ReAct 的价值，硬闸会剥夺它）。

### 环境变量

| 变量                               | 默认    | 说明                                                                                                                      |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `RETRIEVAL_QUALITY_GATE_ENABLED`   | `false` | 总开关（默认关闭 = 现状行为，遵守 09 号 §9.1；经 A1 评测标定后灰度翻默认并登记）                                          |
| `RETRIEVAL_QUALITY_GATE_THRESHOLD` | `0.35`  | top1 分数阈值；**实现先取该默认值，A1 评测产出后回填标定并更新此处**；A5 归一化翻 `on` 前仅对 vector / hybrid+linear 生效 |

阈值语义跟随 A5 统一后的归一化分数（vector / linear / 归一化后的 keyword、RRF 同一量纲）；**A5 off 期间 keyword / hybrid+RRF 模式不启用硬闸**（见上）。

### 验收标准

- [ ] 单测：4 种 retrievalMode × 开关 2 态 × top1 高/低 × A5 on/off 关键组合（≥ 20 组断言），其中必须包含专项断言——**A5 off 时 keyword / hybrid+RRF 模式仅 warn 不拦截，A5 on 时四模式一致拦截**；
- [ ] 闸门触发时不产生 LLM 调用（mock 计数为 0），usage_logs 有记录；
- [ ] Runtime 链路收到 lowQuality 信号后能继续后续轮次（集成测 1 例）。

### 工作量

1.5 人日。

---

## A4 temperature 收紧

### 改动点

| 文件                                                              | 改动                                                                                                                                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/rag-engine/src/llm/chat-service.ts:36`                  | 硬编码默认 `0.7` 改为读取 `DEFAULT_LLM_TEMPERATURE`（env 缺省时 = 0.7，保持现状行为）                                                                                      |
| `packages/rag-engine/src/types.ts`                                | `SearchParams` 增加 `temperature?: number`（0~2）                                                                                                                          |
| `apps/server/src/common/search-params.ts`                         | `normalizeSearchParams()` 透传 `temperature ?? env.rag.llmTemperature`                                                                                                     |
| `apps/server/src/config/env.ts`                                   | 新增 `DEFAULT_LLM_TEMPERATURE`（默认 `0.7` = 现状值；经 A1 评测对比无退化后于 Phase 1 收尾翻默认为 `0.1`，并按 09 号 §9.1 登记结论、同步 `.env.example` 与 12 号能力清单） |
| `apps/server/src/modules/retrieval/dto/search.dto.ts` 及 chat DTO | `@Min(0) @Max(2)` 可选字段                                                                                                                                                 |
| `apps/server/src/config/rag-config.provider.ts`                   | RAG_CONFIG 增加 llmTemperature                                                                                                                                             |

检索链路（`/api/retrieval/search`）不接受 temperature（不生成答案）；chat / agents 链路接受。

### 验收标准

- [ ] 未传时实际调用 LLM 的 temperature = `DEFAULT_LLM_TEMPERATURE` 当前值（默认 0.7；翻默认后为 0.1，单测断言 ChatOpenAI 构造参数）；
- [ ] 请求级覆盖生效且越界值 422。

### 工作量

0.5 人日。

---

## A5 minScore 语义统一

### 现状问题

minScore 仅对 vector 与 hybrid+linear 生效；keyword（ts_rank）与 hybrid+RRF 分数无固定范围，同一阈值跨模式语义不一致（详见 17 号 §3.1）。

### 设计

统一目标：**过滤与展示分数一律归一化到 [0,1]**，原始分保留在 debug。

1. `sparse-retriever.ts`：批次内 min-max 归一化，`score = (rank - min) / (max - min)`（batch 仅 1 条、或全同分 max=min 时一律记 1.0）；原始 rank 写入 `metadata.scoreRaw`；
2. `fusion/index.ts`（注意 rrfFuse / linearFuse 同在此文件，无独立 rrf.ts）：输出分数追加归一化字段 `normalizedScore = fused / maxFused`（原 fused 分保留于 metadata）；
3. `pipeline.applyMinScore()` 改用归一化分数过滤（四模式同一语义）；`retrieveAndChat` 对外 SourceRef.score 输出归一化分；
4. debug 输出（`SearchDebugInfo.items`）增加 `scoreFusedRaw` / `scoreSparseRaw`；
5. **灰度开关**：`RETRIEVAL_SPARSE_SCORE_NORMALIZATION` = `off`（默认）| `on`（按 09 号 §9.1 检索类前缀约定命名）。off 时行为与现状完全一致；A1 评测对比 on/off 无退化后，Phase 1 收尾将默认值切为 `on` 并在此文档记录结论。**翻 on 前置核对（已确认流程）**：核对现网调用方（外部业务系统/脚本）对分数语义与 minScore 默认行为的依赖，有依赖则先行通知再翻默认。

### 验收标准

- [ ] 单测：归一化公式边界（单条/全同分/空批次）；
- [ ] `RETRIEVAL_SPARSE_SCORE_NORMALIZATION=off` 时所有现有测试不修改即通过（回归保证）；
- [ ] on 状态下 4 模式 minScore=0.5 过滤行为一致（集成测）。

### 工作量

2 人日。

---

## Phase 1 汇总

| 项   | 工作量     | 依赖                                                      |
| ---- | ---------- | --------------------------------------------------------- |
| A1   | 3~4 人日   | 无（golden set 内容需业务方 1~2 人日投入，启动前安排）    |
| A2   | 3 人日     | 无（阈值标定依赖 A1；前置 spike 先行）                    |
| A3   | 1.5 人日   | A5（阈值量纲）                                            |
| A4   | 0.5 人日   | 无                                                        |
| A5   | 2 人日     | 无                                                        |
| 合计 | 约 11 人日 | A1 完成后统一标定 A2/A3 阈值并跑一次全量评测作为 baseline |
