# Agent PRD — Phase 3：工具与记忆生态

> 编号：PRD-P3 ｜ 上游路线图：[09-agent-evolution-roadmap.md](09-agent-evolution-roadmap.md) ｜ 通用约定见 09 号 §九  
> 范围：C1 MCP 接入、C2 用户自定义工具、C3 记忆升级、C4 Query 改写、C5 语义切片、C6 CSV 切片、C7 Cross-Encoder  
> 依赖：各项相互独立可并行；C3 第二步、C5 的效果验收依赖 PRD-P1 的 A1 评测集。

---

## C1 MCP 接入

### 设计

- 依赖：`@modelcontextprotocol/sdk`（官方 TypeScript SDK，新增至 `packages/agents` dependencies）。
- 传输：首期支持 `streamable-http`（远程服务）与 `stdio`（本地进程）两种。**`stdio` 由独立子开关 `MCP_STDIO_ENABLED`（默认 false）控制**——stdio 会在服务端主机执行任意本地进程（如 `npx -y` 即时下载并运行第三方代码，供应链风险），生产环境默认仅允许 streamable-http，stdio 仅限开发/受信内网环境显式开启。
- 配置文件：`config/mcp-servers.yml`（新增，随 `ROUTER_RULES_PATH` 同款多级路径解析）：

```yaml
servers:
  - name: company-crm
    transport: streamable-http
    url: https://mcp.internal.example/mcp
    headers:
      Authorization: 'Bearer ${MCP_CRM_TOKEN}' # ${VAR} 从环境变量插值，缺省该 server 禁用
    enabled: true
    allowedTools: [search_customer, get_order] # 可选；缺省 = 全部工具
    timeoutMs: 5000
  - name: filesystem
    transport: stdio
    command: ['npx', '-y', '@modelcontextprotocol/server-filesystem', '/data']
    enabled: false
```

- 适配器：`packages/agents/src/tools/mcp/mcp-tool-adapter.ts` — `McpToolAdapter implements Tool`：
  - `name = mcp_<server>_<toolName>`（前缀防跨 server 冲突）；
  - `parameters` 直接采用 MCP `inputSchema`（JSON Schema，与现有 tool calling 兼容）；
  - `execute()` 经 `ToolExecutor` 统一超时/截断/异常处理。
- 加载时机：`AgentChatService.initTools()` 末尾同步注册；单 server 失败仅记 error 日志，不影响其他 server 与主流程；断线按指数退避重连（1s/5s/30s 封顶）。
- SSE：MCP 工具与内置工具事件完全一致（`tool_call` / `tool_result`）。

### 环境变量

| 变量                | 默认                                  | 说明                                             |
| ------------------- | ------------------------------------- | ------------------------------------------------ |
| `MCP_ENABLED`       | `false`                               | 总开关                                           |
| `MCP_STDIO_ENABLED` | `false`                               | stdio 传输独立子开关（生产默认禁用，见安全约束） |
| `MCP_CONFIG_PATH`   | （自动解析 `config/mcp-servers.yml`） | 配置文件路径                                     |

### 安全约束

- 工具名冲突（与前缀化后仍重复）→ 拒载该工具并 error 日志；
- `allowedTools` 白名单优先于 server 端声明；
- MCP 工具返回内容直接进入 LLM 上下文 = 外部提示注入面：注入前附加来源标注 `[MCP:<server>]`（与内置工具结果经 ToolExecutor 截断的策略一致）；
- MCP 工具与 D2 权限体系打通：`role/apiKey 的 allowedTools` 同样按最终工具名过滤。

### 验收标准

- [ ] 集成测：用 SDK 的 in-process server fixture 注册 2 个工具，supervisor 可调用并返回结果；
- [ ] server 宕机时主流程不受影响，恢复后自动重连；
- [ ] 白名单外工具不出现在 `getAllDefinitions()`；
- [ ] `MCP_STDIO_ENABLED=false` 时 stdio server 配置被拒绝加载并 warn（单测）。

### 工作量

5 人日。

---

## C2 用户自定义工具（OpenAPI 导入）

### 数据模型（新表 `custom_tools`）

| 字段                    | 类型                  | 说明                                                                                                                                                                                                   |
| ----------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| id                      | UUID PK               |                                                                                                                                                                                                        |
| kb_id                   | UUID nullable         | null = 全局可用，否则知识库级                                                                                                                                                                          |
| name                    | VARCHAR(64) UNIQUE    | 工具名（`custom_` 前缀 + operationId 规范化；与既有工具重名时自动追加 `_2`、`_3` 序号并在导入结果中提示）                                                                                              |
| description             | TEXT                  | 默认取 OpenAPI summary，可编辑                                                                                                                                                                         |
| method                  | VARCHAR(8)            | GET/POST/PUT/DELETE                                                                                                                                                                                    |
| url_template            | VARCHAR(512)          | 含 `{pathParam}` 占位                                                                                                                                                                                  |
| parameters_schema       | JSONB                 | 由 OpenAPI 生成：path/query/body 合并的工具参数 schema                                                                                                                                                 |
| headers                 | JSONB                 | 静态头；密钥仅存 `${ENV_VAR}` 引用，禁止明文；**仅允许引用 `ALLOWED_INJECTABLE_ENV_VARS` 白名单中的变量**（业务 token 命名空间，显式登记；禁止 `LLM_API_KEY` 等核心凭据），白名单外变量 → 导入拒绝 422 |
| allowed_hosts           | VARCHAR(512) **必填** | 工具级出站域名白名单（逗号分隔）；执行时按其校验，**不复用 CallHttpApiTool 全局白名单"留空 = 不限公网"的语义**；空值 → 拒绝注册                                                                        |
| requires_approval       | BOOLEAN DEFAULT false | 为 D3 预留；写操作（POST/PUT/DELETE）默认 true                                                                                                                                                         |
| enabled                 | BOOLEAN               |                                                                                                                                                                                                        |
| created_at / updated_at | TIMESTAMP             |                                                                                                                                                                                                        |

### API

```
POST   /api/custom-tools/import    # body: { openapi: object, kbId?: string, operations: [operationId...] }
GET    /api/custom-tools?kbId=     # 列表（不含 headers 明文）
PATCH  /api/custom-tools/:id       # 改 description / requires_approval / enabled
DELETE /api/custom-tools/:id       # 级联从 ToolRegistry 注销
```

> **管理开关与上线顺序（硬约束，已确认）**：现状除 service-call 外所有管理端点无鉴权（仅 `service-call.controller.ts` 挂 Guard），用户认证体系**已决议延后**（见 21 号 D2）。上述端点全部挂 `CUSTOM_TOOLS_ADMIN_ENABLED`（默认 **false**）管理开关；认证体系上线前该开关保持 false，C2 仅限内部/受信环境验证；**C2 对外启用须与认证体系同批或在其后**。

### 运行时

- `packages/agents/src/tools/builtin/custom-tool.adapter.ts`：`CustomToolAdapter implements Tool`，执行逻辑复用 `CallHttpApiTool` 的安全栈（内网防护、超时）；域名校验用**工具级 `allowed_hosts`**（不复用全局白名单"空 = 不限公网域名"语义，见 `call-http-api.tool.ts` 现状）；path/query/body 按工具 schema 从 LLM 参数装配；
- **OpenAPI 兼容细节**：真实 spec 常见两类缺漏须处理——① operationId 缺失时以 `custom_` + `{method}_{路径规范化}` 生成工具名（再走重名追加序号规则）；② host 取 spec 的 `servers` 字段与 path 合并为绝对 `url_template`，`servers` 缺失 → 导入拒绝 422（无合法出站目标，allowed_hosts 也无从校验）；
- 注册：`initTools()` 末尾查询 `custom_tools`（enabled）注册；CRUD 后调用 `toolRegistry` 热更新（新增 `ToolRegistry.unregister(name)`）。

### 前端

知识库设置区新增"自定义工具"页：粘贴 OpenAPI JSON → 解析出操作列表（method/路径/summary）→ 勾选导入 → 列表管理（启停/删除）。页面路由挂在 `/knowledge-bases/:kbId/custom-tools`。

### 验收标准

- [ ] 导入含 path/query/body 参数的 OpenAPI 样例后，supervisor 可正确调用 mock HTTP 服务；
- [ ] headers 引用的环境变量缺失时工具注册为禁用状态并 warn；
- [ ] headers 引用 `ALLOWED_INJECTABLE_ENV_VARS` 白名单外变量时导入返回 422（安全断言）；
- [ ] 目标 host 不在 `allowed_hosts` 时执行被拒、返回 isError（安全断言）；
- [ ] `CUSTOM_TOOLS_ADMIN_ENABLED=false` 时全部端点 403；
- [ ] 写操作默认 `requires_approval=true`（为 D3 联动预留，本期仅存储该字段）。

### 工作量

7 人日（后端 3、前端 2.5、联调 1.5）。

---

## C3 记忆升级

### 第一步：上下文压缩摘要（3 人日）

- 触发（**增量摘要**，非一次性）：`summarized_until` 之后的**未摘要消息数**超过 `MEMORY_SUMMARY_TRIGGER_MESSAGES`（默认 12）时投递 BullMQ 队列 `session-summary`（新增 processor，挂在现有 worker 进程；并发 1；同会话已有 pending 任务则跳过）；一次性触发会导致长会话中段消息既不在摘要里也不在窗口里，必须可重复触发；
- 摘要生成：LLM 对「旧摘要 + 新增消息」生成**合并后**的 ≤ 300 字结构化摘要（背景 / 已确认事实 / 未决问题三段），并推进 `summarized_until_message_id`；会话已被删除时任务判空退出；
- 存储：`conversation_sessions` 新增 `summary TEXT`、`summarized_until_message_id UUID` 两列（migration）；
- 读取：`ConversationMemory.load()` 改为 `summary（若有）+ summarized_until 之后最近 N 条`；摘要段落注入 system prompt（"此前对话摘要：…"）；
- 失败处理：摘要任务失败静默（warn 日志），回退现状窗口截断，不阻塞对话。

### 第二步：跨会话长期记忆（5 人日）

- 新表 `memory_facts`：

| 字段              | 类型         | 说明                                                                                                                                                                             |
| ----------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                | UUID PK      |                                                                                                                                                                                  |
| kb_id             | UUID         | 知识库范围隔离                                                                                                                                                                   |
| owner             | VARCHAR(64)  | 归属主体：现阶段取 apiKeyId / `anonymous`（认证体系上线后迁移为 user_id），**避免同一 KB 多用户偏好互相注入**；KB 是否单租户场景待业务确认，结论仅影响读取过滤条件，不影响表结构 |
| fact              | TEXT         | 单条事实（"用户偏好表格形式呈现数据"）                                                                                                                                           |
| source_session_id | UUID         | 溯源                                                                                                                                                                             |
| embedding         | vector(1024) | 维度取迁移执行时的 `EMBEDDING_DIMENSIONS` 固定；启动校验 env 与列维度不一致即 fail-fast（与 langchainjs 主表同策略）                                                             |
| created_at        | TIMESTAMP    |                                                                                                                                                                                  |

- 写入：会话每 5 轮后（异步，同 worker）由 LLM 抽取 0~3 条"值得跨会话记住的事实"，与既有 facts 语义去重（相似度 > 0.92 则合并更新）；
- 读取：`ConversationMemory.load()` 追加——按当前 query 对**当前 owner** 的 facts 做向量检索 top-3（分数 > 0.6），注入 system prompt"已知用户背景"段；
- 管理：`GET/DELETE /api/chat/memory-facts?kbId=`（前端会话侧栏底部入口，本期仅列表+删除）。

### 环境变量

| 变量                              | 默认    | 说明       |
| --------------------------------- | ------- | ---------- |
| `MEMORY_SUMMARY_ENABLED`          | `false` | 第一步开关 |
| `MEMORY_SUMMARY_TRIGGER_MESSAGES` | `12`    | 触发阈值   |
| `MEMORY_FACTS_ENABLED`            | `false` | 第二步开关 |

### 验收标准

- [ ] ① 同一 20 轮会话，注入上下文 token ≤ 全量历史注入（全部消息拼接）的 40%（mock LLM 统计）；
- [ ] ② 5 个预标注早期事实的会话样本，agent 回答命中 ≥ 4；
- [ ] ③ 40 轮会话用例：中段消息要点出现在合并摘要中（增量摘要不丢信息的回归断言）；
- [ ] facts 注入后 agent 能回答"我之前说过什么偏好"类问题（评测用例 2 条）。

---

## C4 Query 改写 / 扩展

- `SearchParams` 增加 `rewrite?: boolean`；env `QUERY_REWRITE_ENABLED`（默认 false，请求级可开）；
- 实现：`packages/rag-engine/src/retrievers/query-rewrite.ts` — 检索前单次 LLM 调用（超时 800ms，失败原样返回），输出 `{ rewritten: string, expansions: string[] }`；expansions 经现有 tokenizer 清洗（仅保留词条，剥离 tsquery 语法字符）后以 OR 合入 sparse 查询的 tsquery（防语法注入）；vector 侧仅用 rewritten；
- `SearchDebugInfo` 增加 `rewrite: { original, rewritten, expansions }`；
- 评测：A1 集合增加口语化改写对比用例 ≥ 6 条（开/关成对）。

### 验收标准

- [ ] 超时/异常时零影响（原 query 检索）；
- [ ] 对比评测：口语化用例召回提升、规范用例无退化。

### 工作量

2 人日。

---

## C5 语义切片接入 pipeline

- `ingestDocument()` 与 re-chunk 接口增加 `chunkingStrategy: 'recursive' | 'markdown' | 'semantic'`（默认 recursive）；documents 表新增 `chunking_strategy VARCHAR(16)` 列，re-chunk（`POST /api/documents/:docId/chunks`）按存储策略执行；
- `SemanticSplitter` 注入 embeddings（来自 RAG_CONFIG）与参数 `SIMILARITY_THRESHOLD`（默认 0.75，环境变量 `SEMANTIC_SPLIT_THRESHOLD`）、`MAX_CHUNK_SIZE`（复用 chunkSize）；
- 上传对话框（前端）增加策略下拉（默认递归切片）；
- markdown 策略仅对 MinerU 输出生效；**非 MinerU 文档选择 markdown 时回退 recursive 并 warn**（不报错，导入结果中提示实际采用的策略）。

### 验收标准

- [ ] 同一长文档三种策略均可完成摄入，chunk 数与边界符合策略预期（单测 + 抽样人工核对）；
- [ ] 长文档对比评测（A1 answer 指标）：semantic 相对 recursive 有可量化差异记录（提升或持平均记录结论）。

### 工作量

3 人日。

---

## C6 CSV / XLSX 按行聚合切片

- 新增 `packages/rag-engine/src/splitters/csv-splitter.ts`：`splitCsvDocuments(docs, { rowsPerChunk, includeHeader })`；
- 接入：`pipeline.ingestDocument()` 中 file_type ∈ {csv, xlsx} 时改用该切分器（替换现状"每行一 Document → 字符切分"）；
- 参数：env `CSV_ROWS_PER_CHUNK`（默认 10）；表头行拼接于 chunk 首部；单 chunk 超 chunkSize 时按行数二分降级；
- 开关：`CSV_ROW_AGGREGATION_ENABLED`（默认 **false** = 维持现状"每行一 Document → 字符切分"，遵守 09 号 §9.1；灰度对比检索效果后翻默认并登记）。

### 验收标准

- [ ] 单测：不足 N 行 / 空值字段 / 超长单元格 / 空文件四边界；
- [ ] 对 `test-data/` 现有 CSV 的摄入对比：同一查询的检索命中行完整性提升（评测断言：期望字段与 chunk 同 chunk）。

### 工作量

2 人日。

---

## C7 Cross-Encoder 重排

- Provider 接口：`packages/rag-engine/src/rerankers/cross-encoder-provider.ts`

```typescript
export interface CrossEncoderProvider {
  rerank(
    query: string,
    documents: string[],
    topK: number,
  ): Promise<Array<{ index: number; score: number }>>;
}
```

- 首期实现 `HttpCrossEncoderProvider`：POST `CROSS_ENCODER_URL`，body `{ model, query, documents }`，兼容 Jina/Cohere 风格响应（字段映射可配 `CROSS_ENCODER_RESPONSE_FORMAT: jina | cohere`）；
- 接入：`pipeline` 中 `params.useReranker && params.rerankerType === 'cross-encoder'` 时启用；失败/超时（`CROSS_ENCODER_TIMEOUT_MS` 默认 2000）回退 bi-encoder 结果并 warn；
- `SearchParams` 增加 `rerankerType?: 'bi-encoder' | 'cross-encoder'`；`cross-encoder-reranker.ts` 的 stub 改为调用 Provider（无配置时维持原样返回——即天然降级）。

### 环境变量

| 变量                            | 默认                                 | 说明           |
| ------------------------------- | ------------------------------------ | -------------- |
| `CROSS_ENCODER_URL`             | （空 = 未配置，自动降级 bi-encoder） | 重排服务端点   |
| `CROSS_ENCODER_API_KEY`         | —                                    |                |
| `CROSS_ENCODER_MODEL`           | —                                    |                |
| `CROSS_ENCODER_TIMEOUT_MS`      | `2000`                               |                |
| `CROSS_ENCODER_RESPONSE_FORMAT` | `jina`                               | jina \| cohere |

### 验收标准

- [ ] mock server 单测：正常重排 / 超时回退 / 响应格式错误回退；
- [ ] 未配置 URL 时行为与现状逐字节一致；
- [ ] 检索评测：接入真实服务后 recall@10 对比报告归档（不设硬性门槛，记录结论）。

### 工作量

3 人日。

---

## Phase 3 汇总

| 项   | 工作量     | 依赖                          |
| ---- | ---------- | ----------------------------- |
| C1   | 5 人日     | 无                            |
| C2   | 7 人日     | 无                            |
| C3   | 8 人日     | 第一步先行；第二步验收依赖 A1 |
| C4   | 2 人日     | 无                            |
| C5   | 3 人日     | A1（效果验收）                |
| C6   | 2 人日     | 无                            |
| C7   | 3 人日     | 无                            |
| 合计 | 约 30 人日 | 可拆分为 2~3 人并行 3 周      |
