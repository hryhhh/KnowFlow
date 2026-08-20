Agent Orchestration — PRD（v2.1）
文档目的
在 v2.0 基础上，针对规则匹配对 paraphrasing 不鲁棒、知识库问题容易被误路由到 DB/Web 的问题，重新设计路由与调度策略，提升知识库召回稳定性，同时保留多 Agent 并行能力与可配置性。
版本记录

v1.0：单链路 RAG → 多智能体架构设计
v2.0：补充实现细节、架构决策、接口契约与部署方案
v2.1（本次）：强化 RAG 召回优先级、引入软默认规则与置信度仲裁、优化合成策略，解决换问法导致误路由问题

1. 概要（Summary）
   将现有单链路 RAG 改造为「1 主智能体 + N 子智能体」架构。
   主智能体负责意图路由、并行/条件调度与结果合成。
   v2.1 核心调整：路由从「纯规则竞争」升级为「高精度规则 + RAG 软默认 + 低置信度 LLM 仲裁」，合成阶段默认优先采信 RAGFlow 结果，其他 Agent 结果作为补充，降低因用户换问法导致知识库问题被错误路由的风险。
2. 目标与成功指标（Goals & Success Metrics）

目标：
提高结构化统计、实时信息与知识库检索的准确性与响应速度，降低幻觉。
重点解决：用户换一种问法后，本应命中知识库的问题被错误路由到 DB Query 或 Web Search 的问题。

成功指标：
路由决策延迟（p95）≤ 800ms（不含 Agent 执行时间）
知识库类问题召回率（人工抽样）≥ 95%（对比 v2.0 规则版本）
DB Query 结果准确率 100%（与原始 DB 校验）
并行/合成场景用户满意度 ≥ 85%（后续 A/B）
系统错误率（Agent 调用失败）≤ 1%

3. 背景与范围（Background & Scope）

背景：v2.0 纯正则规则对 paraphrasing 不鲁棒，导致知识库问题容易被更高优先级的统计/新闻规则抢走。
范围（In-scope）：
路由策略升级：高精度规则 + RAG 软默认规则 + 低置信度 LLM 仲裁。
Dispatcher 支持「始终候选列表」与合成阶段的 RAG 优先策略。
规则文件支持 examples 字段（为后续语义匹配预留）。
保持前端 SSE 协议兼容与 AGENTS_ENABLED 开关。

非范围（Out-of-scope）：前端 UI 重构、DB 模式变更、RAG 引擎内部重写、完整语义向量路由（可作为后续迭代）。

4. 利益相关者（Stakeholders）
   与 v2.0 相同。
5. 用户场景与用户故事（User Stories）

场景 A：明确统计类（“本月新增客户数量是多少？”）→ 高精度命中 DB Query。
场景 B：明确实时类（“最近关于 XX 的新闻有哪些？”）→ 高精度命中 Web Search。
场景 C：知识库类（包括换问法）→ 优先保证 RAGFlow 被执行，即使正则未精确命中。
场景 D（混合）：“本月新增客户数及最新相关报告”→ 并行执行相关 Agent，合成时 RAG 结果优先展示，其他结果补充。
场景 E（边界）：规则置信度不足或冲突 → 触发轻量 LLM 仲裁，最终决定执行列表。

6. 功能需求（Functional Requirements）
   6.1 IntentRouter（重点变更）

从 YAML 加载规则，支持热重载。
匹配逻辑：
执行所有 enabled: true 的规则，计算分数（正则命中为基础分，后续可叠加 examples 相似度）。
取分数 ≥ minScore 的规则，按 priority 降序排列。
新增：RAG 软默认机制
始终存在一条低优先级、高召回的 ragflow-soft 规则（或通过配置 ALWAYS_INCLUDE_AGENTS）。
当没有更高优先级的明确规则强排除时，保证 ragflow 进入候选列表。

新增：置信度仲裁
如果最高分规则的置信度 < 配置阈值（默认 0.85），或存在多个意图冲突，则调用轻量 LLM 做最终仲裁（≤ 500ms，compact 模型，只输出目标 Agent 列表 + 理由）。

最终输出最多 maxMatchedRules 个 Agent（可配置是否强制包含 ragflow）。

支持 allowParallel: false 时只执行最高优先级的一条。
规则文件新增可选字段 examples（字符串数组），为后续语义匹配预留，当前版本可先忽略或做简单包含匹配。

6.2 Dispatcher（重点变更）

默认并行执行最终候选 Agent 列表。
支持配置 alwaysIncludeAgents: ["ragflow"]，确保知识库 Agent 不会因规则漏匹配而缺失。
每个 Agent 独立超时（RAGFlow 默认 8000ms，其他默认 3000ms）。
超时处理保持 v2.0：RAGFlow 支持 partial，其他返回 timeout。
合成策略新增/调整：
rag-priority（新默认推荐）：
若 RAGFlow 结果 status=ok 且 content 非空，优先采用其内容，其他 Agent 结果作为补充（标注来源）。
若 RAGFlow 为空或低质量，则回退到 concat 或 llm-summarize。

保留原有 concat、llm-summarize、rerank-and-merge。

合成时统一做去重与来源归因（【RAGFlow】 / 【DB Query】 / 【Web Search】）。

6.3 Agents
与 v2.0 保持一致（DB Query 无 LLM 生成 SQL、Web Search 可插拔+缓存+脱敏、RAGFlow 轻量包装）。
6.4 ~ 6.5
kbId 决策、SSE 兼容性与 v2.0 相同。新增事件与 onMeta 保持不变。7. 非功能需求（Non-functional Requirements）

性能：路由决策 p95 ≤ 800ms；全链路延迟单独统计。
可用性：Agent 失败率 ≤ 1%，支持超时降级。
安全：与 v2.0 相同。
可观测性：新增记录「是否触发 LLM 仲裁」「是否因 soft 规则加入 ragflow」「最终合成是否采用了 RAG 优先」。

8. 数据与接口契约（Data Model & API Contracts）

AgentResult 保持不变。
API 保持不变（/api/agents/route、/api/agents/routeStream、/api/agents/rules/reload）。
新增配置项见第 15 节。

9. 路由规则示例（配置）——v2.1 推荐
   YAMLrules:

- id: kb-docs-strict
  pattern: "\\b(文档|资料|手册|知识库|kbId:)\\b"
  intent: "kb_document"
  targetAgent: "ragflow"
  priority: 100
  minScore: 0.9
  examples:
  - "这个文档里怎么说的"
  - "知识库有没有相关说明"
    enabled: true

- id: db-stats
  pattern: "\\b(多少|统计|数量|列表|top\\b|新增客户|增长)"
  intent: "db_query"
  targetAgent: "db-query"
  priority: 90
  minScore: 0.85
  enabled: true

- id: web-latest
  pattern: "\\b(最新|发布|新闻|动态|今天|近日)"
  intent: "web_search"
  targetAgent: "web-search"
  priority: 80
  minScore: 0.85
  enabled: true

# 软默认：保证大多数未明确命中其他意图的问题都会考虑 RAG

- id: ragflow-soft
  pattern: ".*"
  intent: "kb_fallback"
  targetAgent: "ragflow"
  priority: 30
  minScore: 0.0
  enabled: true

- id: combined-fallback
  pattern: ""
  intent: "fallback"
  targetAgent: "llm-intent-classifier"
  priority: 10
  minScore: 0.0
  enabled: true

settings:
maxMatchedRules: 3
defaultAgentTimeoutMs: 3000
allowParallel: true
alwaysIncludeAgents: ["ragflow"] # 关键配置
routerConfidenceThreshold: 0.85 # 低于此值触发 LLM 仲裁
composeStrategy: "rag-priority" # 新默认 10. 可观测性、日志与追踪
在原有基础上增加以下字段：

triggered_llm_arbitration: boolean
rag_included_by: "strict_rule" | "soft_rule" | "always_include" | "llm"
compose_used_rag_priority: boolean

11. 安全与合规
    与 v2.0 相同。
12. 测试计划
    新增用例：

同一知识库问题使用 5~10 种不同问法，验证均能进入 ragflow 候选。
明确统计/新闻类问题不会被 soft 规则错误抢占（priority 生效）。
低置信度场景正确触发 LLM 仲裁。
rag-priority 合成在 RAG 有结果/无结果两种情况下的表现。

13. 上线与回滚计划

继续使用 AGENTS_ENABLED 开关。
新增配置 AGENT_COMPOSE_STRATEGY=rag-priority 与 AGENT_ALWAYS_INCLUDE_AGENTS=ragflow，支持快速回退到 v2.0 行为。
监控新增指标：知识库问题误路由率（抽样）、LLM 仲裁触发率。

14. 迁移与部署影响

规则文件增加 soft 规则与 examples 字段（兼容旧文件）。
新增环境变量（见下）。
其他与 v2.0 相同。

15. 环境变量（新增/调整）
    Bash# ---- 路由与调度（v2.1 新增）----
    AGENT_ALWAYS_INCLUDE_AGENTS=ragflow # 逗号分隔，始终加入候选
    AGENT_ROUTER_CONFIDENCE_THRESHOLD=0.85 # 低于此值触发 LLM 仲裁
    AGENT_COMPOSE_STRATEGY=rag-priority # 新默认：rag-priority | concat | llm-summarize | rerank-and-merge

# 其余变量与 v2.0 保持一致

16. 风险与缓解

风险：soft 规则或 alwaysInclude 导致不必要的 RAG 调用增加 → 缓解：合成阶段可丢弃低质量 RAG 结果；监控平均 Agent 调用数。
风险：LLM 仲裁增加延迟 → 缓解：严格 500ms 超时 + 仅低置信度触发。
风险：RAG 优先合成掩盖了更好的 DB/Web 结果 → 缓解：提供配置关闭 rag-priority；日志记录是否发生了优先级覆盖。
其他风险与 v2.0 相同。

17. 交付清单
    在 v2.0 基础上增加：

IntentRouter 置信度仲裁与 alwaysInclude 逻辑
rag-priority 合成策略
更新后的 router.rules.yml 示例
新增测试用例（paraphrasing 召回、仲裁触发）
可观测性字段扩展

18. 附录

设计决策记录：
放弃固定串行「先 RAG 再其他」，改为并行 + RAG 软默认 + 合成优先，兼顾召回与延迟。
通过 alwaysInclude + soft 规则解决换问法漏路由问题，同时用 priority 保护明确的 DB/Web 场景。
为后续引入 examples 语义匹配预留字段，避免再次大改规则结构。
