# Agent Runtime + 对话记忆 + Trace 系统 — PRD

> 版本：v1.0  
> 日期：2026-08-31  
> 所属 Phase：Phase 1-2（P0-P1）  
> 依赖：[13-agent-tool-system-prd.md](13-agent-tool-system-prd.md)（Tool 系统）

---

## 一、背景

Tool 系统解决"Agent 能调用什么"的问题。本节解决"Agent 怎么自主使用这些工具"的问题——即 ReAct 循环、对话记忆注入、执行过程的可观测性。

**关键设计**：新增 `AgentRuntime` 类，不修改现有 `Orchestrator`。

---

## 二、AgentContext

```typescript
// packages/agents/src/runtime/agent-context.ts

export interface AgentRunParams {
  query: string;
  kbId: string;
  sessionId: string | null;
  traceId: string;
  /** 对话历史消息（由 ConversationMemory 加载） */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  searchParams: SearchParams;
  llmConfig: LLMConfig;
  tools: ToolRegistry;
  /** SSE 回调，用于推送事件到前端 */
  emitEvent: (event: AgentEvent) => void;
}

export interface AgentContext {
  runId: string;
  sessionId: string;
  kbId: string;
  traceId: string;
  /** 当前消息历史（含对话记忆） */
  messages: AIMessage[];
  /** 运行期状态 */
  state: AgentState;
  /** 可 Abort 的信号 */
  signal: AbortSignal;
  /** 工具注册表 */
  tools: ToolRegistry;
  /** LLM 配置 */
  llmConfig: LLMConfig;
  /** SSE 事件回调 */
  emitEvent: (event: AgentEvent) => void;
  /** Trace 收集器 */
  trace: TraceCollector;
}

export class AgentContext {
  static create(params: AgentRunParams): AgentContext {
    const runId = randomUUID();
    const controller = new AbortController();
    // 整体超时
    const timeout = parseInt(process.env.AGENT_RUNTIME_TIMEOUT_MS ?? '30000');
    const timer = setTimeout(() => controller.abort(), timeout);
    controller.signal.addEventListener('abort', () => clearTimeout(timer));

    return {
      runId,
      sessionId: params.sessionId ?? 'anonymous',
      kbId: params.kbId,
      traceId: params.traceId,
      messages: this.buildMessages(params),
      state: { round: 0, toolCallCount: 0, totalTokens: 0 },
      signal: controller.signal,
      tools: params.tools,
      llmConfig: params.llmConfig,
      emitEvent: params.emitEvent,
      trace: new TraceCollector(runId, params.traceId, params.kbId, params.sessionId ?? '', params.query),
    };
  }

  private static buildMessages(params: AgentRunParams): AIMessage[] {
    const messages: AIMessage[] = [
      new SystemMessage(this.buildSystemPrompt(params.kbId)),
    ];
    // 注入对话历史
    for (const msg of params.messages) {
      messages.push(new HumanMessage(msg.content));
    }
    messages.push(new HumanMessage(params.query));
    return messages;
  }

  private static buildSystemPrompt(kbId: string): string {
    return `你是一个智能助手，可以调用工具来获取信息和完成任务。
你拥有以下工具：${/* 从 ToolRegistry 动态获取工具描述 */}
请根据用户问题，自主决定调用哪些工具、调用几次，直到收集到足够信息后给出最终答案。
如果工具调用无法获得有用信息，请直接告知用户并说明原因。
当前知识库 ID: ${kbId}`;
  }
}
```

---

## 三、ReAct 循环

```typescript
// packages/agents/src/runtime/react-loop.ts

export class ReactLoop {
  private readonly maxRounds: number;

  constructor() {
    this.maxRounds = parseInt(process.env.AGENT_REACT_MAX_ROUNDS ?? '5');
  }

  async execute(context: AgentContext): Promise<AgentRunResult> {
    let messages = context.messages;

    for (let round = 0; round < this.maxRounds; round++) {
      // 1. 检查 AbortSignal
      if (context.signal.aborted) {
        return { status: 'aborted', finalAnswer: '', context };
      }

      // 2. 调用 LLM（带工具绑定）
      const llmResponse = await this.callLLM(messages, context);
      context.trace.recordLLMCall(
        llmResponse.model,
        llmResponse.inputTokens,
        llmResponse.outputTokens,
        llmResponse.latencyMs,
      );

      // 3. 检查是否有 tool_call
      const toolCalls = this.extractToolCalls(llmResponse);
      if (toolCalls.length === 0) {
        // 最终答案
        context.trace.recordFinalAnswer(llmResponse.content);
        return { status: 'completed', finalAnswer: llmResponse.content, context };
      }

      // 4. 执行工具
      for (const toolCall of toolCalls) {
        const tool = context.tools.get(toolCall.toolName);
        if (!tool) {
          // 工具不存在，跳过
          continue;
        }
        context.state.toolCallCount++;

        // 推送 tool_call 事件
        context.emitEvent({
          type: 'tool_call',
          timestamp: Date.now(),
          data: { toolName: toolCall.toolName, args: toolCall.arguments },
        });
        context.trace.recordToolCall(toolCall.toolName, toolCall.arguments, null, 0, false);

        const result = await this.executeTool(tool, toolCall, context);
        context.trace.recordToolCall(
          toolCall.toolName,
          toolCall.arguments,
          result.content,
          result.durationMs ?? 0,
          result.isError,
        );

        // 推送 tool_result 事件
        context.emitEvent({
          type: 'tool_result',
          timestamp: Date.now(),
          data: {
            toolName: toolCall.toolName,
            result: result.content.slice(0, 200),
            durationMs: result.durationMs,
            isError: result.isError,
          },
        });
      }

      // 5. 将 tool_use 和 tool_result 加入消息历史
      messages = this.appendToolRound(messages, toolCalls, context);
    }

    // 超出最大轮数
    return { status: 'truncated', finalAnswer: messages[messages.length - 1].content, context };
  }

  private async callLLM(messages: AIMessage[], context: AgentContext): Promise<LLMResponse> {
    const startTime = Date.now();
    const llm = new ChatOpenAI({
      apiKey: context.llmConfig.apiKey,
      model: context.llmConfig.model,
      temperature: 0.3,
      streaming: false,
      configuration: { baseURL: context.llmConfig.baseURL },
      // 绑定工具
      tools: context.tools.getAllDefinitions().map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    });

    const response = await llm.invoke(messages);
    const latencyMs = Date.now() - startTime;

    // 提取 token 用量（从 response metadata）
    const usage = (response as any).usage ?? { prompt_tokens: 0, completion_tokens: 0 };

    return {
      content: response.content as string,
      toolCalls: this.parseToolCalls(response),
      model: context.llmConfig.model,
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      latencyMs,
    };
  }

  private extractToolCalls(response: LLMResponse): ToolCall[] {
    return response.toolCalls ?? [];
  }

  private async executeTool(
    tool: Tool,
    toolCall: ToolCall,
    context: AgentContext,
  ): Promise<ToolResult> {
    const executor = new ToolExecutor();
    return executor.execute(tool, toolCall.arguments, {
      runId: context.runId,
      sessionId: context.sessionId,
      kbId: context.kbId,
      signal: context.signal,
      emitEvent: context.emitEvent,
    });
  }

  private appendToolRound(
    messages: AIMessage[],
    toolCalls: ToolCall[],
    context: AgentContext,
  ): AIMessage[] {
    const newMessages = [...messages];
    // 将 LLM 的 tool_use 消息加入历史
    newMessages.push(
      new AIMessage({
        content: '',
        tool_calls: toolCalls.map((tc) => ({ id: tc.id, name: tc.toolName, args: tc.arguments })),
      }),
    );
    // 每个 tool_call 对应一个 tool_result 消息
    // （实际执行结果在 executeTool 后加入，此处简化为占位）
    return newMessages;
  }
}
```

---

## 四、AgentRuntime（主入口）

```typescript
// packages/agents/src/runtime/agent-runtime.ts

export class AgentRuntime {
  async run(params: AgentRunParams): Promise<AgentRunResult> {
    const context = AgentContext.create(params);

    try {
      const loop = new ReactLoop();
      const result = await loop.execute(context);

      // 保存 trace
      await this.saveTrace(context, result);

      return result;
    } catch (err) {
      const errorResult: AgentRunResult = {
        status: 'failed',
        finalAnswer: err instanceof Error ? err.message : String(err),
        context: null,
        error: err instanceof Error ? err.message : String(err),
      };
      await this.saveTrace(context, errorResult);
      throw err;
    }
  }

  private async saveTrace(context: AgentContext, result: AgentRunResult): Promise<void> {
    if (process.env.AGENT_TRACE_ENABLED !== 'true') return;
    // Trace 持久化由 TraceService 完成（见 §六）
  }
}
```

---

## 五、对话记忆（Conversation Memory）

### 5.1 接口设计

```typescript
// packages/agents/src/memory/conversation-memory.ts

export class ConversationMemory {
  constructor(private readonly sessionService: SessionService) {}

  /**
   * 加载最近 N 轮对话历史
   * @param sessionId 会话 ID
   * @param maxMessages 最大消息数（默认 6，即最近 3 轮 user/assistant）
   */
  async load(
    sessionId: string | null,
    maxMessages: number = 6,
  ): Promise<Array<{ role: string; content: string }>> {
    if (!sessionId) return [];
    try {
      const messages = await this.sessionService.getRecentMessages(sessionId, maxMessages);
      return messages.map((m) => ({ role: m.role, content: m.content }));
    } catch {
      return [];
    }
  }
}
```

### 5.2 SessionService 新增方法

```typescript
// apps/server/src/modules/session/session.service.ts（新增）

/** 获取最近 N 条消息（按时间正序） */
async getRecentMessages(sessionId: string, take: number = 6): Promise<SessionMessageItem[]> {
  const rows = await this.messageRepo.find({
    where: { sessionId },
    order: { createdAt: 'DESC' },
    take,
  });
  return rows.reverse().map((row) => ({
    id: row.id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    sources: row.sources,
    createdAt: this.toUtcISO(row.createdAt),
  }));
}
```

**设计说明**：

- 不实现记忆摘要（Phase 3+），首期只保留最近 6 条消息
- 若 `AGENT_MEMORY_MAX_MESSAGES` 配置更大值，可按需调整
- 异常时返回空数组，不阻塞主流程

---

## 六、Trace 系统

### 6.1 DB 表结构

```sql
-- migration: 1722400000-agent-traces.ts
CREATE TABLE agent_traces (
  id             VARCHAR(36) PRIMARY KEY,
  session_id     VARCHAR(36) NOT NULL,
  kb_id          VARCHAR(36) NOT NULL,
  query          TEXT NOT NULL,
  status         VARCHAR(16) NOT NULL DEFAULT 'running',
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  steps          JSONB NOT NULL DEFAULT '[]',
  summary        JSONB,
  tokens_used    JSONB,
  error_msg      TEXT
);

CREATE INDEX idx_agent_traces_session ON agent_traces(session_id);
CREATE INDEX idx_agent_traces_created ON agent_traces(started_at DESC);
```

### 6.2 TypeORM Entity

```typescript
// apps/server/src/modules/agents/trace/entities/agent-trace.entity.ts

@Entity('agent_traces')
export class AgentTrace {
  @PrimaryColumn('varchar')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  sessionId: string;

  @Column({ type: 'varchar', length: 36 })
  kbId: string;

  @Column({ type: 'text' })
  query: string;

  @Column({ type: 'varchar', length: 16, default: 'running' })
  status: 'running' | 'completed' | 'failed' | 'truncated';

  @CreateDateColumn()
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date;

  @Column({ type: 'jsonb', default: '[]' })
  steps: AgentTraceStep[];

  @Column({ type: 'jsonb', nullable: true })
  summary: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  tokensUsed: { prompt: number; completion: number; total: number };

  @Column({ type: 'text', nullable: true })
  errorMsg: string | null;
}

export interface AgentTraceStep {
  type: 'llm_call' | 'tool_call' | 'final_answer' | 'memory_load';
  timestamp: number;
  data: Record<string, any>;
}
```

### 6.3 TraceCollector

```typescript
// packages/agents/src/observability/trace-collector.ts

export class TraceCollector {
  private readonly steps: AgentTraceStep[] = [];
  private readonly tokensUsed = { prompt: 0, completion: 0, total: 0 };

  constructor(
    private readonly runId: string,
    private readonly traceId: string,
    private readonly kbId: string,
    private readonly sessionId: string,
    private readonly query: string,
  ) {}

  recordLLMCall(model: string, inputTokens: number, outputTokens: number, latencyMs: number): void {
    this.steps.push({
      type: 'llm_call',
      timestamp: Date.now(),
      data: { model, inputTokens, outputTokens, latencyMs },
    });
    this.tokensUsed.prompt += inputTokens;
    this.tokensUsed.completion += outputTokens;
    this.tokensUsed.total += inputTokens + outputTokens;
  }

  recordToolCall(
    toolName: string,
    input: any,
    output: string | null,
    durationMs: number,
    isError: boolean,
  ): void {
    this.steps.push({
      type: 'tool_call',
      timestamp: Date.now(),
      data: { toolName, input, durationMs, isError, outputLength: output?.length ?? 0 },
    });
  }

  recordFinalAnswer(answer: string): void {
    this.steps.push({
      type: 'final_answer',
      timestamp: Date.now(),
      data: { answerLength: answer.length },
    });
  }

  finalize(status: 'completed' | 'failed' | 'truncated', errorMsg?: string): AgentTrace {
    return {
      id: this.runId,
      sessionId: this.sessionId,
      kbId: this.kbId,
      query: this.query,
      status,
      startedAt: new Date(),
      completedAt: new Date(),
      steps: this.steps,
      summary: {
        totalDurationMs: Date.now() - this.steps[0]?.timestamp ?? 0,
        llmCalls: this.steps.filter((s) => s.type === 'llm_call').length,
        toolCalls: this.steps.filter((s) => s.type === 'tool_call').length,
        tokensUsed: this.tokensUsed,
      },
      tokensUsed: this.tokensUsed,
      errorMsg: errorMsg ?? null,
    };
  }
}
```

### 6.4 TraceService（NestJS）

```typescript
// apps/server/src/modules/agents/trace/trace.service.ts

@Injectable()
export class TraceService {
  constructor(@InjectRepository(AgentTrace) private readonly repo: Repository<AgentTrace>) {}

  async save(trace: AgentTrace): Promise<void> {
    await this.repo.upsert(trace, ['id'], { conflictPaths: { id: true } });
  }

  async get(id: string): Promise<AgentTrace | null> {
    return this.repo.findOne({ where: { id } });
  }

  async list(kbId?: string, limit = 20): Promise<AgentTrace[]> {
    const where = kbId ? { kbId } : {};
    return this.repo.find({ where, order: { startedAt: 'DESC' }, take: limit });
  }
}
```

---

## 七、AgentChatService 集成

```typescript
// apps/server/src/modules/agents/agent-chat.service.ts（修改部分）

async stream(
  query: string,
  kbId: string,
  params: SearchParams,
  callbacks: StreamCallbacks & { onMeta?: (event: any) => void },
  traceId: string,
  apiKeyId: string | null,
): Promise<void> {
  const useRuntime = process.env.AGENT_RUNTIME_ENABLED === 'true';

  if (!useRuntime || !this.orchestrator) {
    // 降级到现有路由模式（不变）
    return this.orchestrateViaRouter(query, kbId, params, callbacks, traceId, apiKeyId);
  }

  // ===== 新链路：AgentRuntime =====
  const startTime = Date.now();
  const sessionId = callbacks.onMeta?.({ type: 'session_id_request' }) ?? null;
  const memory = new ConversationMemory(this.sessionService);
  const messages = await memory.load(sessionId, parseInt(process.env.AGENT_MEMORY_MAX_MESSAGES ?? '6'));

  const runtime = new AgentRuntime();
  const result = await runtime.run({
    query,
    kbId,
    sessionId: sessionId ?? '',
    traceId,
    messages,
    searchParams: params,
    llmConfig: this.llmConfig,
    tools: this.toolRegistry,
    emitEvent: (event) => callbacks.onMeta?.(event),
  });

  // 将 finalAnswer 流式推送（复用现有 token 推送方式）
  if (result.finalAnswer) {
    const chunkSize = 20;
    for (let i = 0; i < result.finalAnswer.length; i += chunkSize) {
      callbacks.onToken(result.finalAnswer.slice(i, i + chunkSize));
    }
  }
  callbacks.onDone();

  // 记录 trace
  const trace = result.context?.trace.finalize(result.status as any, result.error);
  await this.traceService.save(trace);

  // 记录使用日志
  this.usageLog.record({
    type: 'agent',
    kbId,
    apiKeyId,
    traceId: result.context?.runId ?? traceId,
    duration: Date.now() - startTime,
    status: result.status === 'completed' ? 'success' : 'error',
  });
}
```

---

## 八、测试策略

| 测试文件                                | 测试内容                                                       | 预期 |
| --------------------------------------- | -------------------------------------------------------------- | ---- |
| `runtime/agent-context.test.ts`         | create() 构造、system prompt 构建、AbortSignal 超时            | 通过 |
| `runtime/react-loop.test.ts`            | 无 tool call→直接返回；有 tool call→执行工具；超轮数→truncated | 通过 |
| `runtime/agent-runtime.test.ts`         | 端到端 run() 流程，mock LLM 返回                               | 通过 |
| `memory/conversation-memory.test.ts`    | sessionId 为空返回空；正常加载历史消息                         | 通过 |
| `observability/trace-collector.test.ts` | recordLLMCall/recordToolCall 后 finalize 的数据完整性          | 通过 |

**回归要求**：所有现有测试必须通过，`AGENT_RUNTIME_ENABLED=false` 时行为不变。

---

## 九、验收标准

- [ ] `AGENT_RUNTIME_ENABLED=true` 时，简单问题（只需一次 tool call）能正确返回答案
- [ ] 多步问题（如"搜索 XX 新闻并查询数据库中相关统计"）能正确执行多轮 ReAct
- [ ] 超出 `AGENT_REACT_MAX_ROUNDS` 时正确返回 truncated
- [ ] 对话历史正确注入（多轮对话有上下文）
- [ ] Trace 数据正确写入 `agent_traces` 表
- [ ] `AGENT_RUNTIME_ENABLED=false`（默认）时现有功能完全不受影响
- [ ] 所有单元测试通过，覆盖率 ≥ 80%

---

## 十、文件清单

| 操作 | 文件路径                                                              |
| ---- | --------------------------------------------------------------------- |
| 新建 | `packages/agents/src/runtime/agent-context.ts`                        |
| 新建 | `packages/agents/src/runtime/react-loop.ts`                           |
| 新建 | `packages/agents/src/runtime/agent-runtime.ts`                        |
| 新建 | `packages/agents/src/memory/conversation-memory.ts`                   |
| 新建 | `packages/agents/src/observability/trace-collector.ts`                |
| 新建 | `apps/server/src/modules/agents/trace/entities/agent-trace.entity.ts` |
| 新建 | `apps/server/src/modules/agents/trace/trace.service.ts`               |
| 新建 | `apps/server/src/modules/agents/trace/trace.controller.ts`            |
| 新建 | `apps/server/src/database/migrations/XXXX-agent-traces.ts`            |
| 修改 | `apps/server/src/modules/session/session.service.ts`                  | 新增 `getRecentMessages()`            |
| 修改 | `apps/server/src/modules/agents/agent-chat.service.ts`                | 集成 AgentRuntime                     |
| 修改 | `apps/server/src/modules/agents/agent.module.ts`                      | 注册 TraceService                     |
| 修改 | `packages/agents/src/types.ts`                                        | 新增 AgentRunResult / AgentEvent 类型 |
| 修改 | `packages/agents/src/index.ts`                                        | 导出 runtime/memory/observability     |
