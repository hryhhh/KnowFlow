# Agent Orchestration — PRD

**文档目的**
本 PRD 将项目中"多智能体编排设计方案（v2）"整理为标准产品需求文档（PRD）格式，包含目标、范围、用户场景、功能与非功能需求、架构方案、接口契约、配置示例、测试与上线计划等，便于开发、测试与运维执行。

**版本记录**

- v1.0（初始）：单链路 RAG → 多智能体架构设计
- v2.0（本次）：补充实现细节、架构决策、接口契约与部署方案

---

## 1. 概要（Summary）

- 将现有单链路 RAG 改造为"1 主智能体 + N 子智能体"架构，主智能体负责路由、并行调度与结果合成，子智能体包括 `DB Query`、`Web Search`、`RAGFlow` 等。

## 2. 目标与成功指标（Goals & Success Metrics）

- 目标：提高问答系统对结构化统计、实时信息与知识库检索的准确性与响应速度，降低 LLM 误答率（幻觉）。
- 成功指标：
  - 路由决策延迟（p95）≤ 800ms（不含 Agent 执行时间）
  - DB Query 结果准确率 100%（与原始 DB 校验）
  - 并行合成场景的用户满意度 ≥ 85%（后续 A/B 测试）
  - 系统错误率（Agent 调用失败）≤ 1%

## 3. 背景与范围（Background & Scope）

- 背景：当前系统仅使用单链路 RAG，无法在对结构化统计与实时网络信息上提供稳定、高信赖的答案。
- 范围（In-scope）：
  - 新增 `packages/agents/` 独立包，实现 Orchestrator/Router/Dispatcher/Agents。
  - 新增服务端模块 `apps/server/src/modules/agents/`，并在 `app.module.ts` 中可选注册。
  - `ChatService` 新增入口层 `AgentChatService`，根据 `AGENTS_ENABLED` 自动路由，前端 `ChatPage` 无需修改。
  - 保持前端 SSE 协议兼容，新增 `onMeta` 兜底回调，已知事件透明透传。
  - 新增 `UsageLog.traceId` 字段用于链路追踪。
- 非范围（Out-of-scope）：前端 UI 重构、DB 模式变更、RAG 引擎内部重写、自动 Prometheus 接入。

## 4. 利益相关者（Stakeholders）

- 产品：Product Owner
- 后端：后端开发团队（NestJS）
- RAG 引擎维护：`packages/rag-engine` 负责人
- 前端：前端团队（展示/错误处理）
- 运维：SRE/监控团队

## 5. 用户场景与用户故事（User Stories）

- 场景 A：用户询问"本月新增客户数量是多少？"→ IntentRouter 命中 `DB Query` → 返回精确统计。
- 场景 B：用户询问"最近关于 XX 的新闻有哪些？"→ 命中 `Web Search` → 返回带来源的实时摘要。
- 场景 C：用户上传文档并询问内容 → 命中 `RAGFlow` → 使用现有 `retrieveAndChat` 链路回答。
- 场景 D（并行）：用户询问"本月新增客户数及最新相关报告"→ 同时命中 `DB Query` 和 `RAGFlow` → Dispatcher 并行执行 → 合成结果返回。

## 6. 功能需求（Functional Requirements）

### 6.1 IntentRouter

- 从 YAML 规则文件加载路由规则（支持热重载）。
- 按 `priority` 降序匹配所有 `enabled: true` 且 `minScore` 达标的规则。
- 取前 `maxMatchedRules` 条规则作为目标 Agent 列表（若仅 1 条命中则只执行 1 个）。
- 全部规则未命中时，调用轻量 LLM 做意图分类兜底（≤ 500ms 超时，使用 compact 模型，仅分类不调用生成）。
- 支持 `allowParallel: false` 时强制单 Agent 执行（取 priority 最高的一条）。

### 6.2 Dispatcher

- 并行调用所有目标 Agent，收集 `AgentResult`。
- 支持合成策略（通过 `COMPOSE_STRATEGY` 配置）：
  - `concat`：按 priority 降序拼接，同 priority 按 score 降序；去重（相同 source/content）；error 结果跳过。
  - `llm-summarize`：复用现有 LLM，输入各 Agent 的 content + sources，输出融合结论 + 来源归因（格式：`【DB Query】...` / `【RAGFlow】...`）；max_tokens 限制 2000；合成调用单独计费。
  - `rerank-and-merge`：所有 Agent 的 sources 合并后，先按 score + priority 确定性排序，再经现有 cross-encoder reranker 重排，取 topK。
- 每个 Agent 独立超时（per-agent `timeoutMs` 可覆盖全局 `defaultAgentTimeoutMs`）。
- 超时处理：RAGFlow 超时前已流式输出的 token 片段作为 `partial` 返回；其他 Agent 超时返回 `status: "timeout"` + `content: ""`。

### 6.3 Agents

#### DB Query Agent

- **SQL 生成方式**：固定 template + 参数映射，不使用 LLM 生成 SQL（PRD 明确要求"无 LLM"）。
- **参数抽取**：由 LLM 仅做意图识别与参数抽取（如从"本月新增客户数"提取 `date_from`/`date_to`），不输出 SQL 语句。
- **安全约束**：
  - 只读凭据从 `DB_READONLY_URL` / `DB_READONLY_USER` / `DB_READONLY_PASSWORD` 环境变量读取，通过 config provider 注入，不经过代码逻辑层。
  - SQL 模板中仅允许 `SELECT`，禁止 `DROP`/`DELETE`/`UPDATE`/`INSERT`。
  - 查询结果限制最多 100 行（`DB_QUERY_MAX_ROWS=100`）。
- **模板配置**：存放于 `config/db-queries.yml`，格式：
  ```yaml
  templates:
    - id: customer_count
      description: '统计客户数量'
      queryTemplate: 'SELECT COUNT(*) AS total FROM customers WHERE created_at >= $1 AND created_at < $2'
      params:
        - name: date_from
          type: date
          description: '起始日期'
        - name: date_to
          type: date
          description: '结束日期'
      requiredFields: []
  ```
- 未来可扩展：保持模板结构，后续可加 schema discovery 模块自动发现表结构。

#### Web Search Agent

- **Provider 接口**：统一抽象 `WebSearchAgent` 接口（`search(query, options): Promise<SearchResult[]>`），返回字段包含 `title`、`uri`、`snippet`、`source`、`publishedAt`。
- **可插拔 Provider**：支持 Tavily/Serper，通过 `WEB_SEARCH_PROVIDER` 配置切换。
- **缓存**：
  - 初期内存缓存（`Map<string, {data, expiresAt}>`），缓存层抽象 `CacheProvider` 接口。
  - 缓存 Key：`sha256(normalize(query) + providerName + JSON.stringify(options))`。
  - TTL 由 `WEB_SEARCH_CACHE_TTL_SECONDS` 配置（默认 3600s）。
  - 后续可通过 `WEB_SEARCH_USE_REDIS=true` 切换至 Redis。
  - 缓存命中时记录 `cache_hit: true/false` 到日志。
- **敏感信息过滤**：HTML 标签剥离 + 正则过滤手机号/身份证/邮箱，仅返回纯文本。

#### RAGFlow Agent

- 作为现有 `retrieveAndChat` 的轻量包装层，不修改 `retrieveAndChat` 内部逻辑。
- 在回调层注入 `agent: "ragflow"`、`trace_id`、`elapsedMs` 元数据。
- 默认超时 8000ms（覆盖全局 3000ms），支持 partial 返回（超时前已流式输出的 token 片段）。

### 6.4 kbId 来源决策

```
请求有 API Key claim?
  ├── 是 → 使用 claim.kbId
  │         若同时存在 request.body.kbId → 返回 409（冲突）
  └── 否 → 使用 request.body.kbId
             若不存在 → 返回 400
```

### 6.5 SSE 与前端兼容

- 现有 SSE 事件类型（`sources`/`token`/`done`/`error`）保持不变。
- 新增事件类型：
  - `agent_start`：`{ agent: string, traceId: string }`
  - `agent_done`：`{ agent: string, status: 'ok'|'error'|'timeout', elapsedMs: number }`
  - `trace`：`{ traceId: string }`
- 前端 `sse.ts` 新增 `onMeta` 兜底回调：
  ```ts
  interface StreamHandlers {
    onSources: (sources: SourceRef[]) => void;
    onToken: (token: string) => void;
    onDone: () => void;
    onError: (message: string) => void;
    onMeta?: (event: { type: string; value: any; agent?: string; traceId?: string }) => void;
  }
  ```
- `agentStatus` 状态存入 `chat-store.ts`（`null | 'db-query' | 'web-search' | 'ragflow'`），UI 层按需展示，初期不渲染。
- `POST /api/chat/stream` 保持兼容：前端无感切换；`POST /api/agents/routeStream` 作为独立对外 API。

## 7. 非功能需求（Non-functional Requirements）

- 性能：
  - 路由决策延迟（p95）≤ 800ms（仅规则匹配，不含 Agent 执行）。
  - 多 Agent 并行全链路 p95 不设硬指标，单独统计记录。
  - RAGFlow Agent 默认超时 8000ms，其他 Agent 默认 3000ms。
- 可用性：Agent 调用失败率 ≤ 1%，支持超时降级（timeout → partial/跳过）。
- 安全：
  - DB 只读凭据通过 config provider 注入，禁止用户输入传入。
  - 所有 DB 查询使用 parameterized queries，SQL 模板仅允许 SELECT。
  - Web Search 返回内容做 HTML 剥离与敏感信息正则过滤。
- 可观测性：
  - trace_id 由 NestJS 拦截器生成（nanoid(16)），注入 `REQUEST` 对象，贯穿所有日志与 SSE 事件。
  - `UsageLog` 实体新增 `traceId` 字段（`varchar(32), nullable`），用于链路关联，初期不查询。
  - 结构化日志包含 `trace_id`, `agent`, `status`, `elapsedMs`, `error`, `cache_hit`。

## 8. 数据与接口契约（Data Model & API Contracts）

### AgentResult（统一输出 schema）

```ts
interface AgentResult {
  id: string; // nanoid 生成
  agent: string; // "db-query" | "web-search" | "ragflow"
  status: 'ok' | 'partial' | 'error' | 'timeout';
  score?: number; // 由 Agent 自行计算（0-1），Router 的 minScore 是准入阈值，非此字段
  content: string; // error 状态为空字符串；partial 状态为已流式片段
  sources?: Array<{ uri?: string; title?: string; meta?: Record<string, any> }>;
  tokens?: number;
  elapsedMs?: number;
  error?: { message: string; code?: string };
}
```

### Orchestrator API

- `POST /api/agents/route` — 同步路由，返回合成结果（完整答案 + 各 Agent 结果列表 + trace_id）。
- `POST /api/agents/routeStream` — SSE 流式路由，事件流包含 `trace_id`、`agent`、`score`、`elapsedMs` 元数据。
- `POST /api/agents/rules/reload` — 手动触发路由规则热重载（开发调试用）。

### kbId 来源决策树

```
请求有 API Key claim?
  ├── 是 → claim.kbId
  │         若同时 request.body.kbId 存在 → 409 Conflict
  └── 否 → request.body.kbId
             若不存在 → 400 Bad Request
```

## 9. 路由规则示例（配置）

默认规则文件：`config/router.rules.yml`（可通过 `ROUTER_RULES_PATH` 环境变量覆盖）。

```yaml
rules:
  - id: kb-docs
    pattern: "\\b(文档|资料|手册|kbId:)\\b"
    intent: 'kb_document'
    targetAgent: 'ragflow'
    priority: 100
    minScore: 0.95
    enabled: true

  - id: db-stats
    pattern: "\\b(多少|统计|数量|列表|top\\b)"
    intent: 'db_query'
    targetAgent: 'db-query'
    priority: 90
    minScore: 0.9
    enabled: true

  - id: web-latest
    pattern: "\\b(最新|发布|新闻|动态|今天)\\b"
    intent: 'web_search'
    targetAgent: 'web-search'
    priority: 80
    minScore: 0.85
    enabled: true

  - id: combined-fallback
    pattern: ''
    intent: 'fallback'
    targetAgent: 'llm-intent-classifier'
    priority: 10
    minScore: 0.0
    enabled: true

settings:
  maxMatchedRules: 3
  defaultAgentTimeoutMs: 3000
  allowParallel: true
```

## 10. 可观测性、日志与追踪（Observability）

- **trace_id**：`nanoid(16)`，NestJS 拦截器生成并注入 `REQUEST` 对象，所有 Agent 执行使用同一 trace_id，日志与 SSE 事件透传。
- **span 命名**：`router` / `db-query` / `web-search` / `ragflow`（用于日志分组）。
- **指标**：
  - Agent 级：`latency_ms`, `error_rate`, `qps`, `avg_score`, `cache_hit`
  - Dispatcher 级：`route_latency`, `compose_time`
- **UsageLog 扩展**：`usage_logs` 表新增 `trace_id` 字段（`varchar(32), nullable`），用于关联调试，初期不作为分析维度。

## 11. 安全与合规（Security & Compliance）

- DB 访问只用最小只读权限；凭据通过 config provider 注入，禁止用户输入传入。
- SQL 模板仅允许 SELECT，禁止 DDL/DML 操作；参数化查询防止注入。
- Web Search 返回内容做 HTML 标签剥离 + 正则过滤手机号/身份证/邮箱。
- 现有 `ApiKeyGuard` 鉴权体系复用，Agent 接口不单独鉴权。
- 外部内容返回需带来源 attribution（`【DB Query】...` / `【RAGFlow】...` 格式）。

## 12. 测试计划（Testing）

- 单元：Router 规则匹配、Dispatcher 合成策略（concat/llm-summarize/rerank-and-merge）、Agent 输出 schema 校验。
- 集成：多 Agent 并行、部分超时/失败、Web Search 缓存命中/失效、DB Query 参数化查询。
- E2E：在 mock provider 下验证 SSE 流式输出（事件顺序、来源 attribution、trace_id 透传、done/error）。
- Mock：`mock-agents.ts` 注入到 DI 容器，不依赖外部服务。

## 13. 上线与回滚计划（Rollout）

- Feature flag：`AGENTS_ENABLED=true/false`（环境变量），开关位于 `AgentChatService` 入口层。
- 监控门禁：运维监控日志中 `error_rate` 与 `agent_latency_ms`，24h 内若 Error Rate > 2% 或路由决策 p95 持续超限则手动回滚（设置 `AGENTS_ENABLED=false`）。
- 暂不实现自动回滚，避免误判。

## 14. 迁移与部署影响（Migration）

- `.env` 新增变量（见第 15 节）。
- `UsageLog` 实体新增 `traceId` 字段（TypeORM `synchronize: true` 自动迁移）。
- 新增配置目录文件：
  - `config/router.rules.yml`（已有）
  - `config/db-queries.yml`（新增，DB Query 模板）
  - `config/compose.prompts.yml`（新增，合成器 prompt 模板）
- 新增 `packages/agents/`，并在 PR 中提供 README 和示例请求/响应。

## 15. 环境变量（新增）

```bash
# ---- Agent 编排 ----
AGENTS_ENABLED=false                          # 功能开关
ROUTER_RULES_PATH=config/router.rules.yml     # 路由规则文件路径
AGENT_DEFAULT_TIMEOUT_MS=3000                 # 全局默认超时（ms）
AGENT_COMPOSE_STRATEGY=concat                 # 合成策略：concat | llm-summarize | rerank-and-merge
AGENT_ROUTER_ALLOW_PARALLEL=true              # 是否允许并行
AGENT_ROUTER_MAX_MATCHED_RULES=3              # 最大匹配规则数

# ---- DB Query Agent ----
DB_READONLY_URL=postgresql://readonly:...     # 只读 DB 连接串
DB_QUERY_MAX_ROWS=100                         # 查询结果行数限制

# ---- Web Search Agent ----
WEB_SEARCH_PROVIDER=tavily                    # provider：tavily | serper
WEB_SEARCH_API_KEY=...                        # API Key
WEB_SEARCH_CACHE_TTL_SECONDS=3600             # 缓存 TTL
WEB_SEARCH_PROVIDER_TIMEOUT_MS=5000           # provider 请求超时
WEB_SEARCH_USE_REDIS=false                    # 是否使用 Redis 缓存（初期内存）
```

## 16. 风险与缓解（Risks & Mitigations）

- 风险：外部搜索依赖导致可用性下降 → 缓解：缓存、熔断、可配置 provider。
- 风险：合成结果引入矛盾/重复 → 缓解：合成器去重（先确定性去重再 LLM 归因）。
- 风险：规则文件路径在容器/部署环境歧义 → 缓解：`path.resolve(__dirname, '../../config/...')` 双保险 + env 覆盖。
- 风险：热重载影响已有请求 → 缓解：持有规则引用，重载时替换引用，不影响进行中请求。
- 风险：RAGFlow 链路本身可能超 800ms → 缓解：800ms 指标仅针对路由决策延迟，全链路延迟单独统计不设硬指标。

## 17. 交付清单（Deliverables）

- `packages/agents/` skeleton + 单元/集成测试
- `apps/server/src/modules/agents/` 模块（含 `AgentChatService` 入口层）
- `config/db-queries.yml` + `config/compose.prompts.yml`
- `UsageLog.traceId` 字段迁移
- 文档：API 示例、YAML 规则、运行说明

## 18. 附录（Appendix）

- 原始设计与讨论记录见仓库 `docs/06-agent-orchestration-design.md` 历史版本。
- 实现决策记录：规则路径使用 `path.resolve(__dirname, '../../config/...')` 双保险；DB Query 采用 template + 参数映射（非 LLM 生成 SQL）；trace_id 使用 nanoid(16)；前端 onMeta 兜底不强制扩展 handlers。
