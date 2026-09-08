# Agent 演进路线图（最终优化方案）

> 版本：v1.0  
> 日期：2026-09-06  
> 来源：整合 [12-agent-upgrade-overview.md](12-agent-upgrade-overview.md) 的"后续规划"与 [17-rag-optimizations.md](17-rag-optimizations.md) 的优化清单，结合 2026-09-06 代码现状评估重新排期。  
> 定位：本文是 Agent 与 RAG 演进项的**唯一待办来源**，后续以本文为准滚动更新（状态：📋 待规划 / 🚧 进行中 / ✅ 已完成）。

---

## 一、现状基线

Phase 1/2 已落地的能力（详见 [12-agent-upgrade-overview.md](12-agent-upgrade-overview.md)）：

| 能力         | 现状                                                                      |
| ------------ | ------------------------------------------------------------------------- |
| 路由链路     | IntentRouter 正则规则 + LLM 仲裁 + Dispatcher 并行 + rag-priority 合成    |
| Runtime 链路 | ReAct 循环 + 5 个内置工具 + 对话记忆（最近 N 条）+ 30s 超时 / 5 轮双护栏  |
| 可观测       | agent_traces 表 + Trace API / 详情页 + Agent Activity 面板 + usage_logs   |
| 评测         | 仅有检索侧 `fixtures/eval-queries.json`（约 25 条），无路由/轨迹/答案评测 |

关键缺口（本文要解决的）：

1. **无 Agent 评测与回归体系** — prompt、工具描述、路由规则的每次变更都无法量化验证；
2. **双链路并存** — Orchestrator（静态路由）与 AgentRuntime（ReAct）是两套心智，维护与演进成本双份；
3. **无自我纠错** — Runtime 失败只会回退 Legacy，没有反思重试；`ToolBudget` 声明了但从未消费；
4. **记忆单薄** — 只有最近 6 条消息的窗口截断；
5. **RAG 侧 12 项已知优化**（原 17 号清单）待排期，其中多数依赖评测集先行。

---

## 二、演进主线与"不做"清单

**主线**：质量护栏 → 架构收敛 → 生态扩展 → 工程化与产品化。先让每次变更有度量，再收敛架构降低演进成本，然后扩生态，最后补产品化能力。

**不做 / 暂缓**（含原 12 号"不在范围内"结论）：

| 事项                      | 结论与理由                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Workflow 引擎             | 与 ReAct 重叠，先跑通 ReAct + Supervisor，继续推迟                                                              |
| Planning 系统（YAML DSL） | 开发成本高，supervisor 动态编排覆盖绝大多数场景，继续推迟                                                       |
| 纯向量语义路由            | 规则文件 `examples` 字段待新增（现状未实现），待评测体系（Phase 1）说话                                         |
| Self-Consistency 多数投票 | 成本高、仅高风险领域有价值，暂缓（见 17 号 §1.4）                                                               |
| 用户认证体系（登录/JWT）  | 延后至独立专项（2026-09-06 决议）：Phase 4 仅保留工具权限与配额（apiKey 身份），D3 改用 apiKeyId 记录 decidedBy |
| 为多智能体而多智能体      | 子代理数量按需增长，不预设固定层级                                                                              |

---

## 三、Phase 1 — 质量护栏与评测（其余一切的前置）

> 详细设计与验收标准：**[18-agent-prd-quality-guardrails.md](18-agent-prd-quality-guardrails.md)**（约 11 人日）

| 编号 | 事项                                                                                                                                                               | 来源                          | 状态 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ---- |
| A1   | **Agent 评测体系**：30~50 条 golden set（含标准路由目标、期望工具轨迹、参考答案），跑三项指标——路由命中率、工具轨迹匹配、LLM-as-judge 答案分；接入 CI 形成回归门槛 | 12 号 Evaluation + 17 号 §5.1 | ✅   |
| A2   | **答案 faithfulness 校验**：答案陈述与检索材料比对，低支撑比例时标注"不确定"或拒答（LLM 输出后处理）                                                               | 17 号 §1.3 / §5.2             | ✅   |
| A3   | **检索质量闸门**：最高分低于阈值时不调 LLM，直接返回"未找到相关信息"；阈值由 A1 评测集确定，不硬编码                                                               | 17 号 §1.2                    | ✅   |
| A4   | **temperature 收紧**：RAG 链路默认经 `DEFAULT_LLM_TEMPERATURE` 收紧（现状 0.7，经 A1 评测灰度后翻 0.1），`SearchParams` 支持按需覆盖                               | 17 号 §1.1                    | ✅   |
| A5   | **minScore 语义统一**：明确 keyword / hybrid+RRF 模式的分数范围（RRF 0~2）并统一过滤语义，文档同步标注                                                             | 17 号 §3.1                    | ✅   |

> **Phase 1 落地说明（2026-09-06）**：
>
> 1. 评测语料位于 `tests/eval/corpus/`（原计划 `test-data/` 不存在），golden set 44 条，路由用例已与真实 IntentRouter 逐一校验（22/22，脚本 `scripts/validate-routing-cases.ts`）；
> 2. judge 已接入检索材料上下文（否则正确引用语料的答案被误判"编造"），并修正 `sparse-store.writeSparseIndex` 缺陷（列名 `chunk_id`→`chunkId`、tsv 补 CAST——原缺陷导致 ingestion 稀疏索引写入静默失败）；
> 3. A2 gate 模式的非流式接入点随 D1 落地（当前流式链路显式忽略并 warn）；A3 的 `usage_logs.gate_reason` 列随 D4 迁移；
> 4. ~~baseline 归档待额度恢复~~ **已归档（2026-09-07）**：`LLM_MODEL` 切换为 `glm-5.2`（`LLM_BASE_URL` 不变，阿里云 MaaS 兼容端点）后跑通全量评测并归档 `tests/eval/report/baseline.json`——路由 22/22（100%）、工具轨迹 11/12（91.7%）、答案质量 10/10（100%）；glm-5.2 function calling 正常，路由仲裁 500ms 超时仍存在但默认回退保持用例通过；traj-001 为真实测得行为（模型对组合查询做了 5 次检索改写，超出"额外工具 ≤1"标准），作为基线如实记录；
> 5. **既有缺陷（与 Phase 1 无关，已在 HEAD 复现）**：`react-loop.test.ts` 中 3 个 truncated-收尾用例（"达到 maxRounds 后收尾"等）在 HEAD 上即失败——用例期望 `new ReactLoop()` 以 maxRounds=2 截断，而 `RUNTIME_DEFAULTS.maxRounds=5`；且 agents 包缺 `test` 脚本导致 `pnpm test`/CI 从未执行该包测试。待确认预期语义后单独修复。

> A1 是全局前置：A2/A3 的阈值、B1 的验收、D5 的调优全部依赖它产出的评测集与指标基线。

---

## 四、Phase 2 — 架构收敛

> 详细设计与验收标准：**[19-agent-prd-architecture-convergence.md](19-agent-prd-architecture-convergence.md)**（约 16 人日）

| 编号 | 事项                                                                                                                                                                                                           | 来源                        | 状态 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---- |
| B1   | **Supervisor 统一双链路**：三个子 Agent 经适配器成为 supervisor 可调用的子代理（各自带子 trace），supervisor 动态决定串行/并行/追问；正则路由降级为 fast-path 或先验提示而非硬路由。验收：编排只剩一条代码路径 | 12 号 Supervisor + 现状评估 | 📋   |
| B2   | **ToolBudget 落地**：消费现有 `ToolBudget` 类型，实现每 run 的 token 与工具调用次数上限，超限标记 `truncated`                                                                                                  | 现状评估（现为死代码）      | 📋   |
| B3   | **失败自省重试**：工具全部失败或 A2 校验不过时，让模型自省一轮（带上失败原因）后重试一次，仍失败再回退 Legacy 链路                                                                                             | 现状评估                    | 📋   |
| B4   | **Multi-hop 检索**：基于 B1 的子代理框架实现"检索 → 生成新 query → 再检索 → 综合回答"的多跳推理                                                                                                                | 17 号 §3.4                  | 📋   |

---

## 五、Phase 3 — 工具与记忆生态

> 详细设计与验收标准：**[20-agent-prd-tool-memory-ecosystem.md](20-agent-prd-tool-memory-ecosystem.md)**（约 30 人日，可 2~3 人并行 3 周）

| 编号 | 事项                                                                                                                                              | 来源                              | 状态 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---- |
| C1   | **MCP client 接入**：`ToolRegistry` 抽象已对齐 function calling，接 MCP server 即可动态注册外部工具服务器                                         | 12 号 MCP 支持                    | 📋   |
| C2   | **用户自定义工具**：前端将用户自有 OpenAPI 接口注册为工具，复用 api-service 的 Key 与安全体系                                                     | 现状评估                          | 📋   |
| C3   | **记忆升级**：第一步，超长对话上下文压缩摘要（BullMQ worker 异步执行，替换粗暴窗口截断）；第二步，跨会话长期记忆（用户偏好/已确认事实，检索注入） | 12 号 Long-term Memory + 现状评估 | 📋   |
| C4   | **Query 改写 / 扩展**：LLM 将口语化提问改写为结构化检索 query，作为 `SearchParams` 可选前置步骤                                                   | 17 号 §3.3                        | 📋   |
| C5   | **语义切片接入 pipeline**：在切片配置中新增 `semantic` 选项，调用方按需选择（长文档场景）                                                         | 17 号 §2.1                        | 📋   |
| C6   | **CSV 切片优化**：按行聚合（每 N 行一个 chunk）并附带表头上下文，避免切断记录边界                                                                 | 17 号 §2.2                        | 📋   |
| C7   | **Cross-Encoder 重排**：接入轻量模型（如 ms-marco-MiniLM）或云端重排 API，`SearchParams` 增加 `rerankerType`                                      | 17 号 §4.1                        | 📋   |

---

## 六、Phase 4 — 工程化与产品化

> 详细设计与验收标准：**[21-agent-prd-platform-engineering.md](21-agent-prd-platform-engineering.md)**（约 20 人日，D1/D2/D3/D4 可并行）

| 编号 | 事项                                                                                                                                                                      | 来源                  | 状态 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---- |
| D1   | **异步 Agent 运行**：复杂任务经 BullMQ 后台执行（突破 30s 天花板），SSE 退化为前端特例；支持定时任务与事件触发（如摄入完成自动生成摘要）                                  | 现状评估              | 📋   |
| D2   | **工具权限与配额**（认证体系延后）：`api_keys.allowed_tools` 按 API Key 裁剪工具子集与按 Key 配额；users/JWT 登录体系延后至独立专项（2026-09-06 决议，只保留 Agent 相关） | 12 号 Permission 系统 | 📋   |
| D3   | **Human-in-the-loop**：写类/外部副作用工具执行前需审批，审批链写入 trace（decidedBy = apiKeyId，无前置依赖）                                                              | 12 号 HITL            | 📋   |
| D4   | **成本换算与预算**：token → USD（模型价目可配置），按 Key/租户做预算与告警                                                                                                | 12 号 成本 USD 换算   | 📋   |
| D5   | **依赖评测集的调优**：chunkSize（500/1000/1500 对比召回率）、denseWeight 网格搜索（依赖 A1 的评测集与指标基线）                                                           | 17 号 §2.3 / §3.2     | 📋   |

---

## 七、依赖关系

```
A1 评测体系 ──┬──▶ A2/A3 阈值确定
              ├──▶ B1 验收基线
              ├──▶ B4 多跳效果对比
              └──▶ D5 参数调优

B1 Supervisor ──▶ B4 Multi-hop
A2 faithfulness ──▶ B3 自省重试（复用校验）
D1 异步运行 ──▶ C3 摘要任务化（可选增强）
（D3 HITL 以 apiKey 身份记录 decidedBy，无前置依赖；认证体系延后）
```

建议节奏：Phase 1 约 2~3 周（评测集 + 脚本 + 两个闸门 + 两个 P0 修正）；Phase 2 约 3 周（B1 是重头）；Phase 3/4 按项独立排期、可并行。每个 Phase 收尾时更新本文状态列，并在 12 号总览的能力清单中登记新增能力。

---

## 八、与既有文档的关系

- [12-agent-upgrade-overview.md](12-agent-upgrade-overview.md)：保留为"已实现能力"总览，其"后续规划"章节已迁移至本文；
- [17-rag-optimizations.md](17-rag-optimizations.md)：保留为问题分析（现状/根因描述仍有价值），其清单项已全部并入本文排期；
- **PRD 集（各 Phase 的可执行需求规格）**：18 / 19 / 20 / 21 号四篇，按 Phase 对应本文四个章节；本文维护优先级与状态，PRD 维护接口与验收细节；
- 本文合并时的关键调整：17 号的评测类项（§5.1/§5.2）与 12 号的 Evaluation 系统合并为 Phase 1 地基；17 号中依赖度量基准的调优项（§2.3/§3.2）显式排在评测体系之后（D5）。

---

## 九、通用约定（适用于全部 PRD）

### 9.1 环境变量

- 所有新增变量统一登记到 `apps/server/src/config/env.ts`（fail-fast 校验处）与 `.env.example`（带注释），两处缺一；
- 命名空间：Agent 类 `AGENT_*`，RAG 检索类 `RETRIEVAL_*`/沿用现有前缀，新增能力用能力名前缀（`MCP_*`、`FAITHFULNESS_*`、`APPROVAL_*` 等）；
- **所有行为变更类项必须带总开关，默认值 = 关闭（即现状行为）**，灰度验证后再翻默认，翻默认时同步更新 `.env.example` 注释与 12 号能力清单；确需默认开启的项必须在本节登记例外清单并说明理由，未登记即视为违规；
- **翻默认的验证环境**：翻默认动作须在类生产环境验证；当前仓库仅本地 compose 环境，暂无 staging 时以 A1 评测无退化 + 在本文登记结论作为背书，staging 搭建另行排期。

### 9.2 SSE 事件

- 新增事件一律为增量类型，旧客户端按 `type` 忽略；事件 payload 遵循现有 `onMeta` 结构（`{ type, value }`；历史 runtime `trace` 事件为 `{ type, timestamp, data }` 结构，仅作兼容保留，新事件不得沿用）；
- 每个新增事件须同步登记到 02 号 §4.5 / 12 号 §3.6 的事件清单。

### 9.3 测试分层

- 单测（vitest，随源码 co-locate）：核心逻辑必须覆盖，mock 外部依赖（LLM/DB/HTTP）；
- 集成测（`apps/server/test/integration/`）：跨模块行为（新表、新端点、队列）；
- 评测（`tests/eval/`，PRD-P1 A1）：一切"效果类"改动的验收手段，产出报告归档；
- **回归红线：任何 PRD 落地后，`AGENT_*` 开关默认关闭状态下，现有测试必须零修改通过。**

### 9.4 状态同步

- 每完成一项：更新本文对应表格状态（✅）与 PRD 中的验收勾选；新增能力登记进 12 号"已实现能力"章节；涉及 SSE/env 的同步 02 号；
- PRD 与本文冲突时，以 PRD 的最新设计为准，并回填本文事项描述。

### 9.5 PRD 索引

| PRD | 文件                                                                                 | 覆盖项 | 工作量   |
| --- | ------------------------------------------------------------------------------------ | ------ | -------- |
| P1  | [18-agent-prd-quality-guardrails.md](18-agent-prd-quality-guardrails.md)             | A1~A5  | ~11 人日 |
| P2  | [19-agent-prd-architecture-convergence.md](19-agent-prd-architecture-convergence.md) | B1~B4  | ~16 人日 |
| P3  | [20-agent-prd-tool-memory-ecosystem.md](20-agent-prd-tool-memory-ecosystem.md)       | C1~C7  | ~30 人日 |
| P4  | [21-agent-prd-platform-engineering.md](21-agent-prd-platform-engineering.md)         | D1~D5  | ~20 人日 |
