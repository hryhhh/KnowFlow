# Agent Tool 系统 — PRD

> 版本：v1.0  
> 日期：2026-08-31  
> 所属 Phase：Phase 1（P0）  
> 依赖：无（可独立开发）  
> 上下文：复用 [08-agent-orchestration-v2.md](08-agent-orchestration-v2.md) 中已有的 Agent 接口

---

## 一、背景

当前 Agent 系统只有三个预置 Agent（`RagFlowAgent` / `DbQueryAgent` / `WebSearchAgent`），它们各自持有完整的执行逻辑，无法被其他 Agent 调用，也无法被 LLM 通过 tool calling 机制动态选择。

**问题**：Agent 只能"被路由到"，不能"主动调用工具"。这是从路由系统升级到 Agent 系统的根本障碍。

**目标**：将现有三个 Agent 的能力暴露为 Tool，让 LLM 可以通过 tool calling 自主决定调用哪个工具、传什么参数。

---

## 二、Tool 抽象层设计

### 2.1 核心接口

```typescript
// packages/agents/src/tools/base-tool.ts

/** 工具执行预算 */
export interface ToolBudget {
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

/** 工具执行上下文 — 由 Runtime 注入，Tool 不感知外部依赖 */
export interface ToolContext {
  runId: string;
  sessionId: string;
  kbId: string;
  signal: AbortSignal;
  budget?: ToolBudget;
  emitEvent: (event: AgentEvent) => void;
}

/** 工具调用描述（LLM 生成的） */
export interface ToolCall {
  id: string;
  toolName: string;
  arguments: Record<string, any>;
}

/** 工具执行结果 */
export interface ToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
  error?: { message: string; code: string };
  durationMs?: number;
  structured?: Record<string, any>;
}

/**
 * Tool 接口 — 所有工具必须实现
 * 保持轻量，不依赖 LangChain.js 框架（避免增加耦合）
 */
export interface Tool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema，用于 LLM tool calling 参数描述 */
  readonly parameters: Record<string, any>;
  execute(args: Record<string, any>, ctx: ToolContext): Promise<ToolResult>;
}
```

### 2.2 ToolRegistry

```typescript
// packages/agents/src/tools/tool-registry.ts

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** 返回所有工具的 name + description + parameters，供 LLM tool calling 使用 */
  getAllDefinitions(): Array<{ name: string; description: string; parameters: Record<string, any> }> {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }
}
```

### 2.3 ToolExecutor（执行器）

每个工具执行时，由 `ToolExecutor` 统一包裹，负责：

1. **超时控制**：从环境变量读取各工具超时时间
2. **参数校验**：用 JSON Schema 校验 LLM 生成的参数（防止格式错误）
3. **结果大小限制**：结果超过 4000 字符时截断并标注 `truncated`
4. **异常捕获**：任何未捕获异常都返回 `isError=true`，不向上抛出

```typescript
// packages/agents/src/tools/tool-executor.ts

export class ToolExecutor {
  private timeouts: Record<string, number> = {
    rag_search: 8000,
    query_database: 5000,
    web_search: 3000,
    read_file: 2000,
    call_http_api: 5000,
  };

  async execute(tool: Tool, args: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    const startTime = Date.now();
    const timeout = this.timeouts[tool.name] ?? 5000;

    try {
      // 参数校验（可选，由具体工具实现决定是否启用）
      if (tool.parameters?.required) {
        this.validateArgs(args, tool.parameters);
      }

      const result = await this.runWithTimeout(
        tool.execute(args, ctx),
        timeout,
        ctx.signal,
      );

      result.durationMs = Date.now() - startTime;

      // 结果截断
      if (result.content.length > 4000) {
        result.content = result.content.slice(0, 4000) + '\n…（已截断，原始结果过长）';
        result.structured = { ...result.structured, truncated: true };
      }

      return result;
    } catch (err) {
      return {
        toolCallId: '',
        content: '',
        isError: true,
        error: {
          message: err instanceof Error ? err.message : String(err),
          code: 'EXECUTION_ERROR',
        },
        durationMs: Date.now() - startTime,
      };
    }
  }

  private runWithTimeout<T>(
    promise: Promise<T>,
    ms: number,
    signal: AbortSignal,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Tool ${tool.name} timeout after ${ms}ms`)), ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Tool execution aborted'));
      });
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  private validateArgs(args: Record<string, any>, schema: Record<string, any>): void {
    const required = schema.required ?? [];
    for (const field of required) {
      if (args[field] === undefined || args[field] === null) {
        throw new Error(`Missing required argument: ${field}`);
      }
    }
  }
}
```

---

## 三、内置工具清单

### 3.1 rag_search

**来源**：复用 `retrieveAndChat()` 的检索逻辑，不调用 LLM，只返回检索结果。

```typescript
// packages/agents/src/tools/builtin/rag-search.tool.ts

export class RagSearchTool implements Tool {
  readonly name = 'rag_search';
  readonly description = '在知识库中搜索与查询相关的文档片段。适用于需要内部文档信息回答问题时。';
  readonly parameters = {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索查询词' },
      topK: { type: 'integer', description: '返回结果数量，默认 5，最大 20', default: 5 },
      minScore: { type: 'number', description: '最低相关度分数，默认 0.5', default: 0.5 },
    },
    required: ['query'],
  };

  constructor(
    private readonly retrieveFn: (query: string, kbId: string, params: any) => Promise<RetrievalResult[]>,
  ) {}

  async execute(args: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    const results = await this.retrieveFn(args.query, ctx.kbId, {
      topK: args.topK ?? 5,
      minScore: args.minScore ?? 0.5,
    });

    const documents = results.map((r, i) => `[${i + 1}] ${r.content}`).join('\n\n');
    const sources = results.map((r) => ({ sourceFile: r.sourceFile, score: r.score }));

    return {
      toolCallId: '',
      content: documents || '未找到相关文档',
      isError: false,
      structured: { count: results.length, sources },
    };
  }
}
```

**实现要点**：
- 直接调用 `retrieve()`（非流式），拿完整结果后返回
- 不从 `RAGFlowAgent` 复制逻辑，避免重复代码
- 注入点：`AgentChatService` 在初始化时将 `retrieve` 函数传给 `RagSearchTool`

---

### 3.2 query_database

**来源**：复用 `DbQueryService.execute()` 和 `config/db-queries.yml` 中的 SQL 模板。

```typescript
// packages/agents/src/tools/builtin/db-query.tool.ts

export class DbQueryTool implements Tool {
  readonly name = 'query_database';
  readonly description = '查询结构化数据库（知识库元数据、业务数据等）。通过预定义 SQL 模板执行参数化查询，防止 SQL 注入。';
  readonly parameters = {
    type: 'object',
    properties: {
      templateId: {
        type: 'string',
        enum: ['kb_stats', 'doc_stats', 'chunk_stats', 'doc_list', 'kb_list', 'doc_creation_trend', 'top_docs_by_chunks'],
        description: '查询模板 ID，从可用模板列表中选择',
      },
      params: {
        type: 'array',
        description: '模板参数数组（由系统自动填充 kbId 等必需参数，用户无需传入）',
        items: { type: 'string' },
      },
    },
    required: ['templateId'],
  };

  constructor(private readonly dbQueryService: DbQueryService) {}

  async execute(args: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    const rows = await this.dbQueryService.execute(args.templateId, args.params ?? [], 100);
    const content = this.formatRows(rows);
    return {
      toolCallId: '',
      content,
      isError: false,
      structured: { rowCount: rows.length, rows },
    };
  }

  private formatRows(rows: any[]): string {
    if (!rows.length) return '查询结果为空';
    if (rows.length === 1 && Object.keys(rows[0]).length === 1) {
      const key = Object.keys(rows[0])[0];
      return `总计 ${rows[0][key]} 条`;
    }
    const cols = Object.keys(rows[0]);
    return [cols.join(' | '), ...rows.map((r) => cols.map((c) => String(r[c] ?? '')).join(' | '))].join('\n');
  }
}
```

**实现要点**：
- `templateId` 用 enum 约束，LLM 只能选预定义模板，不能传任意 SQL
- 必需参数（`kbId`）由系统自动注入，LLM 不需要传
- 复用现有 `DbQueryService`，零新增依赖

---

### 3.3 web_search

**来源**：复用 `WebSearchAgent` 的 `SearchProvider` 接口。

```typescript
// packages/agents/src/tools/builtin/web-search.tool.ts

export class WebSearchTool implements Tool {
  readonly name = 'web_search';
  readonly description = '搜索互联网获取最新信息。适用于查询新闻、实时动态、概念科普等外部信息。';
  readonly parameters = {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
      maxResults: { type: 'integer', description: '最大返回结果数，默认 3', default: 3 },
    },
    required: ['query'],
  };

  constructor(private readonly provider: SearchProvider) {}

  async execute(args: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    const results = await this.provider.search(args.query, {
      max_results: args.maxResults ?? 3,
    });
    const content = results.map((r) => `【${r.title}】\n${r.snippet}`).join('\n\n');
    return {
      toolCallId: '',
      content: content || '未找到相关结果',
      isError: false,
      structured: { count: results.length, results },
    };
  }
}
```

---

### 3.4 read_file

```typescript
// packages/agents/src/tools/builtin/read-file.tool.ts

export class ReadFileTool implements Tool {
  readonly name = 'read_file';
  readonly description = '读取已上传文件的内容（PDF/Word/CSV 等），返回文本内容。适用于需要查看原始文件内容的场景。';
  readonly parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径（相对于 uploads 目录）' },
    },
    required: ['path'],
  };

  async execute(args: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    // 安全约束：只允许读取 uploads 子目录，禁止 ../ 路径穿越
    const uploadsDir = process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), 'uploads');
    const resolvedPath = path.resolve(uploadsDir, args.path);
    if (!resolvedPath.startsWith(uploadsDir)) {
      return { toolCallId: '', content: '', isError: true, error: { message: '路径访问被拒绝', code: 'PATH_TRAVERSAL' } };
    }
    const content = await fs.promises.readFile(resolvedPath, 'utf-8');
    return { toolCallId: '', content, isError: false, structured: { size: content.length } };
  }
}
```

---

### 3.5 call_http_api

```typescript
// packages/agents/src/tools/builtin/call-http-api.tool.ts

export class CallHttpApiTool implements Tool {
  readonly name = 'call_http_api';
  readonly description = '调用外部 HTTP API（GET/POST）。适用于需要获取外部系统数据的场景。';
  readonly parameters = {
    type: 'object',
    properties: {
      url: { type: 'string', description: '请求 URL' },
      method: { type: 'string', enum: ['GET', 'POST'], default: 'GET' },
      headers: { type: 'object', description: '自定义请求头' },
      body: { type: 'string', description: '请求体（POST 时有效）' },
    },
    required: ['url'],
  };

  async execute(args: Record<string, any>, ctx: ToolContext): Promise<ToolResult> {
    // 域名白名单检查
    const allowedDomains = (process.env.API_CALL_ALLOWED_DOMAINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (allowedDomains.length > 0) {
      const domain = new URL(args.url).hostname;
      if (!allowedDomains.some((d) => domain.endsWith(d))) {
        return { toolCallId: '', content: '', isError: true, error: { message: `域名 ${domain} 不在白名单中`, code: 'DOMAIN_NOT_ALLOWED' } };
      }
    }
    const response = await fetch(args.url, {
      method: args.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...args.headers },
      body: args.method === 'POST' ? args.body : undefined,
      signal: ctx.signal,
    });
    const text = await response.text();
    return { toolCallId: '', content: text, isError: false, structured: { status: response.status } };
  }
}
```

---

## 四、LegacyAgentAdapter（降级路径）

将现有三个 Agent 类包装为 Tool，确保 `AGENT_RUNTIME_ENABLED` 关闭时行为完全不变：

```typescript
// packages/agents/src/agents/legacy-adapter.ts

/** 将现有 Agent 实现包装为 Tool，供 AgentRuntime 使用 */
export class LegacyAgentAdapter implements Tool {
  constructor(
    private readonly agent: Agent,
    private readonly toolName: string,
    private readonly description: string,
  ) {}

  readonly name = this.toolName;
  readonly parameters = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] };

  async execute(args: Record<string, any>, _ctx: ToolContext): Promise<ToolResult> {
    const result = await this.agent.execute({
      query: args.query,
      kbId: _ctx.kbId,
      traceId: _ctx.runId,
    });
    return {
      toolCallId: '',
      content: result.content,
      isError: result.status === 'error' || result.status === 'timeout',
      error: result.error,
      structured: { status: result.status, sources: result.sources },
    };
  }
}
```

**使用方式**：当 `AGENT_RUNTIME_ENABLED=true` 但某个 Tool 的专用实现尚未就绪时，用 `LegacyAgentAdapter` 临时包装现有 Agent。

---

## 五、工具注册与初始化

在 `AgentChatService.initAgents()` 中注册工具：

```typescript
// apps/server/src/modules/agents/agent-chat.service.ts（修改部分）

private initTools(): ToolRegistry {
  const registry = new ToolRegistry();
  const executor = new ToolExecutor();

  // 1. rag_search — 注入 retrieve 函数
  registry.register(new RagSearchTool((query, kbId, params) =>
    retrieve(query, kbId, params, this.ragConfig)
      .then(r => r.results)
  ));

  // 2. query_database — 复用现有 DbQueryService
  registry.register(new DbQueryTool(this.dbQueryService));

  // 3. web_search — 复用现有 SearchProvider
  const provider = createSearchProvider(
    process.env.WEB_SEARCH_PROVIDER ?? 'tavily',
    process.env.WEB_SEARCH_API_KEY ?? '',
  );
  registry.register(new WebSearchTool(provider));

  // 4. read_file
  registry.register(new ReadFileTool());

  // 5. call_http_api
  registry.register(new CallHttpApiTool());

  return registry;
}
```

---

## 六、测试策略

| 测试文件 | 测试内容 | 验证方式 |
|---------|---------|---------|
| `tools/base-tool.test.ts` | ToolRegistry 增删查、getAllDefinitions 格式 | 纯单元测试，无外部依赖 |
| `tools/tool-executor.test.ts` | 超时、参数校验、结果截断、异常捕获 | Mock Tool 实现 |
| `tools/builtin/rag-search.tool.test.ts` | 调用 retrieve()、结果格式化、空结果处理 | Mock retrieve 函数 |
| `tools/builtin/db-query.tool.test.ts` | 模板匹配、formatRows、空结果 | Mock DbQueryService |
| `tools/builtin/web-search.tool.test.ts` | provider 调用、去重、截断 | Mock SearchProvider |
| `tools/builtin/read-file.tool.test.ts` | 路径穿越防护、正常读取 | 临时文件系统 |
| `tools/builtin/call-http-api.tool.test.ts` | 域名白名单、GET/POST、超时 | Mock fetch |
| `agents/legacy-adapter.test.ts` | Agent 调用结果映射 | Mock Agent |

**回归要求**：所有现有测试（`pnpm test`）必须通过。

---

## 七、验收标准

- [ ] 5 个内置工具均可独立调用，返回结构化结果
- [ ] ToolRegistry 注册/查询/列表接口正确
- [ ] ToolExecutor 超时、截断、异常处理符合预期
- [ ] LegacyAgentAdapter 可正确包装现有 Agent
- [ ] 所有单元测试通过，覆盖率 ≥ 80%
- [ ] `AGENT_RUNTIME_ENABLED=false` 时现有功能零影响

---

## 八、文件清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 新建 | `packages/agents/src/tools/base-tool.ts` | Tool 接口定义 |
| 新建 | `packages/agents/src/tools/tool-registry.ts` | 工具注册中心 |
| 新建 | `packages/agents/src/tools/tool-executor.ts` | 执行器（超时/校验/截断） |
| 新建 | `packages/agents/src/tools/builtin/rag-search.tool.ts` | rag_search 工具 |
| 新建 | `packages/agents/src/tools/builtin/db-query.tool.ts` | query_database 工具 |
| 新建 | `packages/agents/src/tools/builtin/web-search.tool.ts` | web_search 工具 |
| 新建 | `packages/agents/src/tools/builtin/read-file.tool.ts` | read_file 工具 |
| 新建 | `packages/agents/src/tools/builtin/call-http-api.tool.ts` | call_http_api 工具 |
| 新建 | `packages/agents/src/agents/legacy-adapter.ts` | Legacy Agent → Tool 适配器 |
| 修改 | `packages/agents/src/types.ts` | 新增 ToolCall/ToolResult/ToolContext 类型 |
| 修改 | `packages/agents/src/index.ts` | 导出新模块 |
| 修改 | `apps/server/src/modules/agents/agent-chat.service.ts` | 新增 initTools() 并注册到 AgentRuntime |
