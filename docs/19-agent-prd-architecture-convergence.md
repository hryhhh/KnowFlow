# Agent PRD — Phase 2：架构收敛

> 编号：PRD-P2 ｜ 上游路线图：[09-agent-evolution-roadmap.md](09-agent-evolution-roadmap.md) ｜ 通用约定见 09 号 §九  
> 范围：B1 Supervisor 统一双链路、B2 ToolBudget 落地、B3 失败自省重试、B4 Multi-hop 检索  
> 依赖：B3 的触发条件 (c) 依赖 PRD-P1 的 A2；B4 依赖 B1。B2/B3 可与 B1 并行。

---

## B1 Supervisor 统一双链路（本 Phase 核心）

### 现状与目标

现状：Orchestrator（静态正则路由 → Dispatcher 并行 → 固定合成策略）与 AgentRuntime（单 agent ReAct）两条执行路径并存。目标：**AgentRuntime 成为唯一执行路径**，三个既有 Agent 变为 supervisor 可调用的子代理工具；IntentRouter 降级为低延迟 fast-path，不再承担编排。

### 总体架构

```
POST /api/agents/routeStream
    │
    ├─ fast-path：正则高置信命中（最高命中 priority ≥ AGENT_ROUTER_CONFIDENCE_THRESHOLD
    │            且非 ragflow-soft / llm-fallback 规则）
    │            → 直接执行对应子代理（保留现状延迟，不走 LLM）
    │
    └─ supervisor 路径：其余全部查询
         AgentRuntime(ReAct) + 扩展工具集：
           原子工具（现有 5 个）
           + 子代理工具（新增 3 个，见下）
         系统提示含编排指引（取代 compose 策略）
```

### 子代理工具定义

| 工具名      | 包装对象       | 行为                                                          |
| ----------- | -------------- | ------------------------------------------------------------- |
| `agent_rag` | RagFlowAgent   | 内部调用 `retrieveAndChat` 非流式内核，返回答案文本 + sources |
| `agent_db`  | DbQueryAgent   | 内部含模板选择逻辑（resolveTemplate），返回格式化结果         |
| `agent_web` | WebSearchAgent | 内部走 SearchProvider + 缓存，返回摘要列表                    |

```typescript
// packages/agents/src/tools/builtin/subagent.tool.ts（新建）
export class SubagentTool implements Tool {
  constructor(
    private readonly agent: Agent, // 复用 LegacyAgentAdapter 的执行语义
    readonly name: string, // agent_rag / agent_db / agent_web
    readonly description: string, // 含"何时派发给我"的编排指引
  ) {}
  // execute(): ToolResult.structured = { status, sources }（与 LegacyAgentAdapter 一致）
}
```

- 子代理与原子工具并存：supervisor 既可以 `agent_rag` 整体派发，也可以用 `rag_search` 做细粒度检索后自行推理；
- 子代理调用在 `agent_traces.steps` 记录 `type: 'subagent_call'`（data: `{ agent, durationMs, status }`）；
- SSE 事件：子代理开始/结束时推**新增事件** `subagent_start` / `subagent_done`（payload `{ agent }` / `{ agent, durationMs, status }`）。**不复用** Legacy 链路的 `agent_start` / `agent_done`——Runtime 链路已推 run 级 `agent_start`（agent='AgentRuntime'），且前端 AgentThoughtPanel 以 `agent_completed` 判停并取 runId、按 tool_call/tool_result 配对推断执行中状态，混入同名事件会打乱该状态机；新事件按 09 号 §9.2 登记至 02 号 §4.5 / 12 号 §3.6，前端面板渲染改造计入工作量。

### 同轮工具并行执行（已确认采纳，新改动）

现状 ReactLoop 对单轮多个 tool_calls **顺序执行**（`for...await`）。supervisor 单轮并行派发多个子代理的核心收益正是并行，本项将 ReactLoop 同轮多 tool_calls 改为 `Promise.all` 并行执行，并明确以下语义：

1. `tool_call` SSE 事件在批次执行前全部推送，`tool_result` 按**完成顺序**推送（前端面板按 tool_call/tool_result 配对渲染，不假设顺序）；
2. `trace.steps` 按完成顺序记录，`tool_call` 步骤保留发起序号以便排序；
3. 与 B2 预算的交互：预算校验在**批次派发前**执行，已并行发起的工具不中断，超限拒绝对后续批次生效；
4. 与整体超时（AbortSignal）交互不变：并行批次共享同一 signal；
5. 单 tool_call 请求行为不变（回归红线：`AGENT_SUPERVISOR_ENABLED=false` 下现有测试零修改通过——并行执行仅在同一轮出现 ≥ 2 个 tool_calls 时触发路径差异，需专项单测覆盖现有顺序语义不受影响的单工具场景）。

### 系统提示中的编排指引（取代 compose 策略）

```
编排指引：
- 知识库类问题优先派发 agent_rag；其结果有效时以其为主体作答，其他结果作补充。
- 明确统计类问题派发 agent_db；实时/新闻类派发 agent_web。
- 混合类问题可并行派发多个子代理（单轮多 tool_calls）。
- 子代理结果之间出现矛盾时，知识库资料优先，并在答案中说明分歧。
```

`AGENT_COMPOSE_STRATEGY` 保留读取但标记 deprecated（日志提示"仅 fast-path 单代理执行时无意义，将在下版本移除"）。

### 开关与迁移（三态）

| `AGENT_SUPERVISOR_ENABLED` | 行为                                                    |
| -------------------------- | ------------------------------------------------------- |
| `false`（默认）            | 现状双链路，行为逐字节不变                              |
| `true`                     | fast-path + supervisor；Orchestrator 多代理并行合成停用 |

**开关矩阵**：supervisor 依赖 Runtime 执行内核——`AGENT_SUPERVISOR_ENABLED=true` 而 `AGENT_RUNTIME_ENABLED=false` 时，**隐含启用 Runtime**（启动时 warn 提示该依赖），env 校验层同步提示；不允许出现"supervisor 开但走 Orchestrator"的组合。

- 代码层面：`Orchestrator`/`Dispatcher` 保留，职责收窄为"fast-path 单代理执行 + 超时 + 降级"；多代理并行合成分支删除（删除前该分支代码由 fast-path 停用标志覆盖 ≥ 一个版本）；
- 回退：`AGENT_SUPERVISOR_ENABLED=false` 即恢复现状，无需回滚代码。

### 环境变量

| 变量                           | 默认                               | 说明                                                   |
| ------------------------------ | ---------------------------------- | ------------------------------------------------------ |
| `AGENT_SUPERVISOR_ENABLED`     | `false`                            | 见上表                                                 |
| `AGENT_SUBAGENT_TOOLS_ENABLED` | `true`（仅 supervisor 模式下生效） | 是否向 supervisor 注册子代理工具（允许纯原子工具实验） |

### 验收标准

- [ ] `AGENT_SUPERVISOR_ENABLED=false` 时现有全部测试不改通过（回归红线）；
- [ ] 开关矩阵：supervisor=true 且 runtime=false 组合下按 Runtime 链路执行并输出 warn（单测）；
- [ ] fast-path 用例（评测集 routing 子集）端到端延迟不高于现状 p95 + 10%（同集 × 100 次取 p95；supervisor 路径首期只报告不设门槛）；
- [ ] 混合类问题（"本月新增客户数及最新相关报告"）supervisor 单轮并行派发 `agent_db` + `agent_web`，trace 中两个 subagent_call；
- [ ] 子代理失败时 supervisor 能改用原子工具或明示原因（评测集含注入失败用例）；
- [ ] `agent_traces` 完整记录 subagent_call 与最终答案；前端 AgentThoughtPanel 正常渲染 `subagent_start` / `subagent_done` 事件。

### 工作量

11~~12 人日（接口与开关 2、SubagentTool 与 trace 3、fast-path 判定 1、同轮并行执行改造 1、提示调优与评测 2、前端面板渲染与事件登记 1、回归 1~~2）。

---

## B2 ToolBudget 落地

### 现状

`ToolBudget` 在 `tools/base-tool.ts` 声明但无任何消费方；ReAct 轮数有上限（5），token 无上限。

### 设计

- `AgentContext.create()` 构建 budget 并注入 `context.budget`：
  - `maxToolCalls`（env `AGENT_TOOL_BUDGET_CALLS`，默认 **0 = 不限制**，遵守 09 号 §9.1"默认=现状行为"；灰度验证后再考虑默认收紧至 20 并登记）；
  - `maxTotalTokens`（env `AGENT_TOOL_BUDGET_TOKENS`，默认 **0 = 不限制**，统计 TraceCollector 累计 prompt+completion；灰度后考虑 100000）；
- 检查时机：`ReactLoop` 每轮 tool_calls **批次派发前**（同轮并行执行时已发起的工具不中断，超限拒绝对后续批次生效——见 B1 并行执行语义）；`TraceCollector` 增加 `getTokensUsed()` 读取器；
- 超限行为：**不中断**——停止执行后续工具，向消息历史追加系统提示"工具预算已用尽，请基于已有信息直接回答"，随后**恰好一次**收尾 LLM 调用（**不带 tools**，复用 ReactLoop 现有 truncated 收尾路径）；若该收尾调用仍返回 tool_calls，直接以已有文本收尾，不再循环；超限尝试的工具返回 `isError: true, error.code = 'BUDGET_EXCEEDED'`；
- run 状态置 `truncated`，同时 `trace.summary.budget.exhausted = true`（与 maxRounds 耗尽的 truncated 可区分，供监控与告警）。
- `trace.summary` 记录 `budget: { toolCallsUsed, tokensUsed, limits, exhausted? }`。

### 验收标准

- [ ] 单测：calls 超限 / tokens 超限 / 均未超限三路径；
- [ ] 超限 run 收尾 llm_call **恰好 1 次**且不带 tools（mock 断言消息序列）；最终仍有答案（非报错中断），状态 truncated 且 `summary.budget.exhausted=true`；
- [ ] 预算内行为与现状一致。

### 工作量

1.5 人日。

---

## B3 失败自省重试

### 触发条件（满足其一，且未触发过自省）

1. 本轮全部 tool_call 结果 `isError=true` 或 content 为空；
2. 最终答案长度 < 20 且匹配 `/(无法|抱歉|不能回答)/`（启发式，可配置关闭）。**已知误伤面**：合法短拒绝（如"抱歉，知识库中没有相关资料"）会触发一轮无谓自省，trace 记录触发原因以便评估误报率；`AGENT_SELF_CORRECT_HEURISTIC=false` 可单独关闭；
3. A2 faithfulness gate 判定不过（仅非流式链路）。

### 流程

1. 向消息历史追加 user 消息（模板）：
   `上一步尝试未成功（原因：{失败摘要，≤200 字}）。请更换策略：可改用其他工具、调整参数或变换检索词；若确认无法完成，请明确说明缺失的信息。`
2. 重试预算：`AGENT_SELF_CORRECT_ROUNDS`（默认 **0 = 关闭**，遵守 09 号 §9.1；灰度后翻 1 并登记），消耗在 `AGENT_REACT_MAX_ROUNDS` 之内；轮数已耗尽时自省不触发，`trace.steps` 记录 `type: 'self_correct', data: { skipped: 'rounds_exhausted' }`；
3. 自省后仍失败 → 维持现有 `AGENT_RUNTIME_FALLBACK` 回退逻辑；
4. `trace.steps` 记录 `type: 'self_correct'`（data: `{ trigger, round }`）。

### 环境变量

| 变量                           | 默认   | 说明                                        |
| ------------------------------ | ------ | ------------------------------------------- |
| `AGENT_SELF_CORRECT_ROUNDS`    | `0`    | 自省重试轮数，0 = 关闭（灰度后翻 1 并登记） |
| `AGENT_SELF_CORRECT_HEURISTIC` | `true` | 是否启用触发条件 2 的启发式                 |

### 验收标准

- [ ] 单测：mock LLM 序列（首轮工具全败 → 自省 → 次轮成功），断言消息序列与状态；
- [ ] rounds=0 时行为与现状一致；
- [ ] trace 含 self_correct 步骤且 finalAnswer 正常。

### 工作量

2 人日。

---

## B4 Multi-hop 检索

### 前置

B1 已上线（多跳依赖 supervisor 多轮派发能力）。

### 增量设计

ReAct 天然支持多轮，本项不做新机制，只做三件事：

1. **检索词改写钩子**：`rag_search` 参数增加 `rewrite?: boolean`——服务端在检索前做一次轻量改写（复用 PRD-P3 的 C4 实现；若 C4 未上线则本参数忽略）；
2. **系统提示多跳指引**：追加"若首次检索未命中，请从结果片段中提取新线索（人名/型号/术语）组成新查询再次检索，最多 2 轮"；
3. **评测集 multi-hop 子集**：≥ 8 条需两跳的用例（如"XX 公司的 YY 产品的主要竞争对手是谁"），进入 A1 指标统计。

### 验收标准

- [ ] multi-hop 子集 pass 率 ≥ 60%（Phase 2 收尾基线）；
- [ ] 单跳问题不因多跳指引产生多余工具调用（轨迹用例回归）。

### 工作量

1 人日（指引与用例）＋ C4 联动另计。

---

## Phase 2 汇总

| 项   | 工作量     | 依赖                                                  |
| ---- | ---------- | ----------------------------------------------------- |
| B1   | 11~12 人日 | A1（验收基线）                                        |
| B2   | 1.5 人日   | 无                                                    |
| B3   | 2 人日     | A2（触发条件 c 可选）                                 |
| B4   | 1 人日     | B1                                                    |
| 合计 | 约 16 人日 | B2/B3 可先行；B1 完成后统一跑评测并更新 12 号能力清单 |
