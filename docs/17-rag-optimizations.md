# RAG 系统待优化点清单

> **状态：📋 待规划**
>
> 本文档整理当前 RAG 系统的已知不足与可优化方向，供后续迭代参考。
> 最后核对：2026-09-06（各项"现状"描述已与代码复核，仍然有效）

---

## 一、幻觉抑制

### 1.1 Temperature 偏高

**现状**：[chat-service.ts:34](../packages/rag-engine/src/llm/chat-service.ts#L34) 中 temperature 默认为 `0.7`。

**问题**：RAG 场景要求答案忠实于参考资料，0.7 给了模型较大的创造性空间，在参考资料不充分时更容易产生幻觉。

**建议**：

- 默认值降至 `0.1` 或 `0`
- 在 `SearchParams` 中新增 `temperature` 字段，允许按需调整

---

### 1.2 缺少检索结果质量判断

**现状**：无论检索结果质量如何，`retrieveAndChat` 都会直接调用 LLM 生成答案。

**问题**：当最高分结果的相关度很低时，模型可能基于低质量资料强行回答，产生误导性内容。

**建议**：

- 在 `retrieveAndChat` 中加入质量判断：若最高分低于阈值，直接返回"未找到相关信息"，跳过 LLM 调用
- 阈值需通过离线评测集确定，不宜硬编码

---

### 1.3 缺少引用来源真实性校验

**现状**：`buildContext` 将检索结果拼接后交给 LLM，LLM 可自行发挥引用来源。

**问题**：LLM 可能编造不存在的引用，或错误关联内容与实际来源。

**建议**：

- 在 LLM 输出后增加后处理校验，比对答案中的具体陈述是否能在参考资料中找到支撑
- 对无法支撑的陈述标记不确定提示

---

### 1.4 缺少 Self-Consistency / Verification 机制

**现状**：生成式 RAG 系统只有"检索 → 生成"单轮流程。

**建议**（高优先级，需较大工作量）：

- 对关键问题，让模型先生成答案，再用检索到的材料做一次验证
- 或多次生成后取多数一致的结果（Self-Consistency）
- 适用于金融、医疗等高风险领域

---

## 二、切片策略

### 2.1 语义切片未接入 Pipeline

**现状**：[semantic-splitter.ts](../packages/rag-engine/src/splitters/semantic-splitter.ts) 已实现基于句向量相似度的语义边界切分，但未接入 [pipeline.ts](../packages/rag-engine/src/pipeline.ts) 的 `ingestDocument` 流程。

**适用场景**：

- 长篇文章、论文、报告等语义边界明显的文档
- 不需要依赖明显的标题层级结构

**当前不适用原因**：需要额外调用 Embedding 模型计算句间相似度，处理延迟高，资源开销大。适合离线预处理或作为可选策略。

**建议**：

- 在 `ParseStrategy` 或切片配置中新增 `semantic` 选项
- 由调用方按需选择，默认保持当前的 Markdown-aware / 字符级策略

---

### 2.2 CSV 切片跨记录边界

**现状**：[csv-loader.ts](../packages/rag-engine/src/loaders/csv-loader.ts) 将每行转为一个 Document，随后由字符级 splitter 按固定字符数切分。

**问题**：字符切分会切断记录边界，导致一个 chunk 内混合多条记录，且缺少列名上下文。

**建议**：实现 `splitCsvDocuments`，按行聚合（每 N 行一个 chunk），每条记录附带表头，保持语义完整性。

---

### 2.3 Chunk Size 参数未经验证

**现状**：`chunkSize=1000`、`chunkOverlap=200` 来自环境变量默认值 [rag-config.provider.ts:37-38](../apps/server/src/config/rag-config.provider.ts#L37-L38)。

**问题**：未针对当前 Embedding 模型和文档类型做过系统性的参数调优。

**建议**：

- 用 golden query set 做离线评测，对比不同 chunkSize（500/1000/1500）的召回率
- 观察 chunkOverlap 对边界信息保留的影响

---

## 三、检索策略

### 3.1 minScore 过滤逻辑不一致

**现状**（[pipeline.ts:209-276](../packages/rag-engine/src/pipeline.ts#L209-L276)）：

| 模式            | minScore 是否生效               |
| --------------- | ------------------------------- |
| vector          | ✅ 生效                         |
| keyword         | ❌ 不生效（BM25 分无固定范围）  |
| hybrid + RRF    | ❌ 不生效                       |
| hybrid + Linear | ✅ 生效（融合分归一化到 [0,1]） |

**建议**：

- 统一 minScore 语义：对于 RRF 模式，可基于融合分范围（0~2）设定合理阈值
- 或在文档中标注各模式的分数范围说明，方便调用方理解

---

### 3.2 denseWeight 权重未调优

**现状**：`denseWeight` 默认 `0.5`，无系统调优依据。

**建议**：

- 按线上真实查询类型分布做分析：专有名词查询（关键词为主）vs 语义查询（向量为主）
- 用 golden set 做网格搜索，找最优 denseWeight

---

### 3.3 缺少 Query 改写与扩展

**现状**：用户提问原样作为检索 query，不做任何改写。

**问题**：口语化、模糊的提问检索效果差。

**建议**：

- **Query Rewriting**：用 LLM 将口语化提问改写为更结构化的搜索语句
- **Query Expansion**：自动补充同义词、相关术语
- 可作为 `SearchParams` 的可选前置步骤

---

### 3.4 缺少 Multi-hop 检索

**现状**：单次检索 → 单次生成。

**问题**：复杂问题（如"XX 公司的 YY 产品在中国的主要竞争对手是谁？"）需要多步推理和多次检索。

**建议**：

- 利用现有的 Agent 编排框架，将检索作为工具之一
- 第一轮检索获取线索 → 生成第二轮 query → 继续检索 → 综合多轮结果回答

---

## 四、重排序

### 4.1 Cross-Encoder 仅存 Stub

**现状**：[cross-encoder-reranker.ts](../packages/rag-engine/src/rerankers/cross-encoder-reranker.ts) 是占位实现，直接返回原始结果。

**问题**：Cross-Encoder 能同时阅读 query 和 document，相关性判断精度高于 Bi-Encoder，但当前未接入。

**建议**：

- 接入轻量 Cross-Encoder 模型（如 `ms-marco-MiniLM-L-6-v2`）或云端重排序 API
- 在 `SearchParams` 中新增 `rerankerType: 'bi-encoder' | 'cross-encoder'`，默认 `bi-encoder`

---

## 五、评估与观测

### 5.1 缺少自动化评测流程

**现状**：有 `fixtures/eval-queries.json` 和基础测试，但无 CI 集成的端到端评测流水线。

**建议**：

- 建立 golden query set + ground truth answer set
- CI 中自动运行评测，输出 recall@k、precision@k、answer fidelity 等指标
- 每次检索策略变更后可对比指标变化

---

### 5.2 缺少 Answer Faithfulness 评测

**现状**：评测聚焦于检索召回率，缺少对 LLM 生成答案忠实度的度量。

**建议**：

- 用 LLM-as-judge 判断答案中的每个陈述是否都能在参考资料中找到支撑
- 统计 hallucination rate（编造比例）

---

## 六、总结优先级

| 优先级 | 优化项                           | 预期收益           | 预估工作量 |
| ------ | -------------------------------- | ------------------ | ---------- |
| P0     | temperature 降至 0.1             | 降低幻觉           | 小         |
| P0     | minScore 过滤逻辑统一            | 提升低质量结果拦截 | 中         |
| P0     | 检索结果质量判断后决定是否调 LLM | 显著降低幻觉       | 中         |
| P1     | 语义切片接入 pipeline            | 长文档召回率提升   | 中         |
| P1     | CSV 切片优化                     | CSV 文档质量提升   | 小         |
| P1     | Cross-Encoder 接入               | rerank 精度提升    | 中         |
| P1     | denseWeight 参数调优             | 混合检索效果提升   | 中         |
| P2     | Query 改写/扩展                  | 复杂查询召回提升   | 大         |
| P2     | Multi-hop 检索                   | 复杂问题回答能力   | 大         |
| P2     | 自动化评测流水线                 | 持续质量保障       | 大         |
| P3     | Answer Faithfulness 评测         | 幻觉度量           | 中         |
| P3     | Chunk Size 系统性调优            | 召回率优化         | 中         |
