# Agent 可观测性（SSE 事件 + Trace API）— PRD

> 版本：v1.0  
> 日期：2026-08-31  
> 所属 Phase：Phase 2（P1）  
> 依赖：[14-agent-runtime-prd.md](14-agent-runtime-prd.md)（TraceCollector）

---

## 一、背景

当前 SSE 事件只有 `trace / agent_start / agent_done / sources / token / done / error / meta`，无法展示 Agent 内部的执行过程（调用了哪些工具、花了多少时间、LLM 的思考过程等）。

**目标**：扩展 SSE 事件协议，新增 `tool_call` / `tool_result` / `reasoning_summary` 事件；同时暴露 Trace 查询 API，支持事后调试。

---

## 二、SSE 事件协议

### 2.1 事件类型完整清单

| 事件名              | 触发时机                                                   | 数据结构                                                                                                                      | 兼容旧客户端  |
| ------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `trace`             | 请求开始                                                   | `{ traceId: string }`                                                                                                         | ✅ 已有       |
| `session_id`        | 会话创建/确认                                              | `{ sessionId: string }`                                                                                                       | ✅ 已有       |
| `agent_start`       | Agent 开始执行                                             | `{ agent: string, traceId: string }`                                                                                          | ✅ 已有       |
| `tool_call`         | **新增** LLM 决定调用工具                                  | `{ toolName: string, args: Record<string,any>, traceId: string }`                                                             | 忽略未知 type |
| `tool_result`       | **新增** 工具执行完成                                      | `{ toolName: string, result: string, durationMs: number, isError: boolean, traceId: string }`                                 | 忽略未知 type |
| `reasoning_summary` | **新增** LLM 思考摘要                                      | `{ summary: string, traceId: string }`                                                                                        | 忽略未知 type |
| `sources`           | 检索来源就绪                                               | `SourceRef[]`                                                                                                                 | ✅ 已有       |
| `token`             | LLM 流式输出片段                                           | `string`                                                                                                                      | ✅ 已有       |
| `message_delta`     | **新增** 最终答案流式片段（语义同 token，可选）            | `string`                                                                                                                      | 忽略未知 type |
| `agent_done`        | Agent 执行完成                                             | `{ agent: string, duration: number, traceId: string }`                                                                        | ✅ 已有       |
| `agent_completed`   | **新增** 整个 AgentRun 完成（替代 agent_done，语义更明确） | `{ status: 'completed'\|'failed'\|'truncated', durationMs: number, traceId: string, tokensUsed?: {prompt,completion,total} }` | 忽略未知 type |
| `done`              | 回答完成                                                   | `null`                                                                                                                        | ✅ 已有       |
| `error`             | 发生错误                                                   | `{ message: string, traceId: string }`                                                                                        | ✅ 已有       |
| `meta`              | 可观测元数据                                               | `{ type: string, value: any, agent?: string, traceId?: string }`                                                              | ✅ 已有       |

### 2.2 事件推送时机（完整流程）

```
POST /api/chat/stream
    │
    ├─ trace        { traceId }
    ├─ session_id   { sessionId }
    │
    ├─ agent_start  { agent: 'AgentRuntime', traceId }
    │
    ├─ reasoning_summary  { summary: '正在分析用户请求，需要查询知识库...' }
    │
    ├─ tool_call      { toolName: 'rag_search', args: { query: '公司报销制度' } }
    ├─ tool_result    { toolName: 'rag_search', result: '找到 8 条文档...', durationMs: 1200, isError: false }
    │
    ├─ reasoning_summary  { summary: '已获取知识库信息，还需要搜索最新规定...' }
    │
    ├─ tool_call      { toolName: 'web_search', args: { query: '2024年税务规定' } }
    ├─ tool_result    { toolName: 'web_search', result: '找到 3 条新闻...', durationMs: 800, isError: false }
    │
    ├─ token          '根据公司报销制度与最新税务规定对比...'  ← 流式输出
    ├─ token          '...'
    │
    ├─ agent_completed { status: 'completed', durationMs: 3500, tokensUsed: {prompt:1200, completion:350, total:1550} }
    │
    └─ done           null
```

### 2.3 AgentChatService 中的事件推送

```typescript
// apps/server/src/modules/agents/agent-chat.service.ts（新增事件推送逻辑）

private emitToolCall(callbacks: any, toolName: string, args: any, traceId: string): void {
  callbacks.onMeta?.({ type: 'tool_call', value: { toolName, args }, traceId });
}

private emitToolResult(callbacks: any, toolName: string, result: string, durationMs: number, isError: boolean, traceId: string): void {
  callbacks.onMeta?.({ type: 'tool_result', value: { toolName, result: result.slice(0, 200), durationMs, isError }, traceId });
}

private emitReasoningSummary(callbacks: any, summary: string, traceId: string): void {
  callbacks.onMeta?.({ type: 'reasoning_summary', value: { summary }, traceId });
}
```

---

## 三、Trace API

### 3.1 接口设计

```typescript
// apps/server/src/modules/agents/trace/trace.controller.ts

@Controller('agents/traces')
export class TraceController {
  constructor(private readonly traceService: TraceService) {}

  /** GET /api/agents/traces/:id — 查询单次执行的完整 trace */
  @Get(':id')
  async get(@Param('id') id: string) {
    const trace = await this.traceService.get(id);
    if (!trace) throw new NotFoundException('Trace 不存在');
    return { data: trace };
  }

  /** GET /api/agents/traces — 列表查询（支持 kbId 过滤和分页） */
  @Get()
  async list(@Query('kbId') kbId?: string, @Query('limit') limit = 20) {
    return { data: await this.traceService.list(kbId, parseInt(limit)) };
  }
}
```

### 3.2 响应数据结构

```json
{
  "data": {
    "id": "a1b2c3d4-...",
    "sessionId": "e5f6g7h8-...",
    "kbId": "i9j0k1l2-...",
    "query": "公司报销制度是否符合最新税务规定？",
    "status": "completed",
    "startedAt": "2026-08-31T10:00:00.000Z",
    "completedAt": "2026-08-31T10:00:03.500Z",
    "steps": [
      {
        "type": "llm_call",
        "timestamp": 1725100800000,
        "data": {
          "model": "qwen3.7-plus",
          "inputTokens": 1200,
          "outputTokens": 80,
          "latencyMs": 500
        }
      },
      {
        "type": "tool_call",
        "timestamp": 1725100800500,
        "data": {
          "toolName": "rag_search",
          "input": { "query": "公司报销制度" },
          "durationMs": 1200,
          "isError": false
        }
      },
      {
        "type": "llm_call",
        "timestamp": 1725100801700,
        "data": {
          "model": "qwen3.7-plus",
          "inputTokens": 2100,
          "outputTokens": 60,
          "latencyMs": 400
        }
      },
      {
        "type": "tool_call",
        "timestamp": 1725100802100,
        "data": {
          "toolName": "web_search",
          "input": { "query": "2024税务规定" },
          "durationMs": 800,
          "isError": false
        }
      },
      { "type": "final_answer", "timestamp": 1725100803500, "data": { "answerLength": 350 } }
    ],
    "summary": {
      "totalDurationMs": 3500,
      "llmCalls": 2,
      "toolCalls": 2,
      "tokensUsed": { "prompt": 3300, "completion": 140, "total": 3440 }
    },
    "tokensUsed": { "prompt": 3300, "completion": 140, "total": 3440 },
    "errorMsg": null
  }
}
```

### 3.3 模块注册

```typescript
// apps/server/src/modules/agents/trace/trace.module.ts

@Module({
  imports: [TypeOrmModule.forFeature([AgentTrace])],
  controllers: [TraceController],
  providers: [TraceService],
  exports: [TraceService],
})
export class TraceModule {}
```

在 `AgentModule` 中引入 `TraceModule`。

---

## 四、与现有 chat.service.ts 的关系

现有 `ChatService.stream()` 已调用 `AgentChatService.stream()`（当 `AGENT_RUNTIME_ENABLED=true` 时）。

Trace 事件通过现有的 `onMeta` 回调推送，**不需要修改 `chat.service.ts`**。

`AgentChatService` 新增以下依赖：

- `TraceService` — 保存 trace
- `ConversationMemory` — 加载对话历史

---

## 五、边界情况处理

| 场景                        | 处理方式                                                               |
| --------------------------- | ---------------------------------------------------------------------- |
| LLM 返回非法 tool_call 格式 | `extractToolCalls()` 返回空数组，当作 final_answer 处理                |
| 工具执行超时                | `ToolExecutor` 捕获超时异常，返回 `isError=true`，ReAct 循环继续下一轮 |
| 所有工具调用均失败          | ReAct 循环继续（LLM 可自行调整策略），最多到 `maxRounds`               |
| Trace 写入失败              | `TraceService.save()` 加 try-catch，失败只打 warn 日志，不影响主流程   |
| `AGENT_TRACE_ENABLED=false` | `TraceCollector` 不持久化，但仍在内存中收集（供调试）                  |
| sessionId 为 null（未登录） | `ConversationMemory.load()` 返回空数组，不影响执行                     |

---

## 六、测试策略

| 测试文件                             | 测试内容                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `trace/trace.service.test.ts`        | save/get/list 正常流程；kbId 过滤                                                                                                 |
| `trace/trace.controller.test.ts`     | GET /:id 返回完整 trace；404 处理                                                                                                 |
| `agent-chat.service.test.ts`（新增） | `AGENT_RUNTIME_ENABLED=true` 时，SSE 事件顺序正确：trace → agent_start → tool_call → tool_result → token → agent_completed → done |

---

## 七、验收标准

- [ ] `GET /api/agents/traces/:id` 返回完整的 steps + summary
- [ ] SSE 事件流中包含 `tool_call` / `tool_result` / `reasoning_summary` / `agent_completed`
- [ ] 旧客户端（不处理新事件类型）收到 SSE 后仍能正常显示最终答案
- [ ] Trace 写入失败不影响回答返回
- [ ] 所有测试通过

---

## 八、文件清单

| 操作 | 文件路径                                                   |
| ---- | ---------------------------------------------------------- |
| 新建 | `apps/server/src/modules/agents/trace/trace.module.ts`     |
| 新建 | `apps/server/src/modules/agents/trace/trace.controller.ts` |
| 修改 | `apps/server/src/modules/agents/trace/trace.service.ts`    | 已有，确认导出                                             |
| 修改 | `apps/server/src/modules/agents/agent.module.ts`           | 引入 TraceModule                                           |
| 修改 | `apps/server/src/modules/agents/agent-chat.service.ts`     | 新增 emitToolCall/emitToolResult/emitReasoningSummary 方法 |
