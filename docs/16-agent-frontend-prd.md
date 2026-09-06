# Agent Activity 前端面板 — PRD

> 版本：v1.0  
> 日期：2026-08-31  
> 所属 Phase：Phase 1-2（P1）  
> 依赖：[15-agent-observability-prd.md](15-agent-observability-prd.md)（SSE 事件协议）

---

## 一、背景

当前 Chat 页面只展示最终答案文本，用户看不到 Agent 内部的执行过程（调用了什么工具、花了多少时间、思考了什么）。升级后，前端需要实时展示 Agent Activity，让用户理解"答案是怎么来的"。

---

## 二、新增状态（chat-store.ts）

在现有 `ChatState` 中新增两个字段：

```typescript
// apps/frontend/src/stores/chat-store.ts（修改部分）

// 新增类型
export interface AgentActivityEvent {
  type: 'tool_call' | 'tool_result' | 'reasoning_summary' | 'agent_started' | 'agent_completed';
  timestamp: number;
  toolName?: string;
  args?: Record<string, any>;
  result?: string;
  summary?: string;
  durationMs?: number;
  isError?: boolean;
  status?: 'completed' | 'failed' | 'truncated';
  tokensUsed?: { prompt: number; completion: number; total: number };
}

interface ChatState {
  // 现有字段...
  agentEvents: AgentActivityEvent[]; // 新增：Agent 执行事件列表
  showAgentActivity: boolean; // 新增：是否展开 Activity 面板

  // 新增方法
  appendAgentEvent: (event: AgentActivityEvent) => void;
  toggleAgentActivity: () => void;
  clearAgentEvents: () => void;
}
```

---

## 三、SSE 事件解析（sse.ts）

在现有 `streamChat` 函数的回调中增加 `onMeta` 处理：

```typescript
// apps/frontend/src/services/sse.ts（修改部分）

export async function streamChat(
  kbId: string,
  query: string,
  params: SearchParams,
  callbacks: ChatCallbacks,
  extra?: { sessionId?: string; onMeta?: (event: any) => void },
): Promise<{ sessionId: string }> {
  // ... 现有逻辑不变 ...

  // 在 onMeta 中增加新事件处理
  const originalOnMeta = callbacks.onMeta;
  callbacks.onMeta = (event) => {
    // 转发到 store
    if (event.type === 'tool_call') {
      store.appendAgentEvent({
        type: 'tool_call',
        timestamp: Date.now(),
        toolName: event.value.toolName,
        args: event.value.args,
      });
    } else if (event.type === 'tool_result') {
      store.appendAgentEvent({
        type: 'tool_result',
        timestamp: Date.now(),
        toolName: event.value.toolName,
        result: event.value.result,
        durationMs: event.value.durationMs,
        isError: event.value.isError,
      });
    } else if (event.type === 'reasoning_summary') {
      store.appendAgentEvent({
        type: 'reasoning_summary',
        timestamp: Date.now(),
        summary: event.value.summary,
      });
    } else if (event.type === 'agent_completed') {
      store.appendAgentEvent({
        type: 'agent_completed',
        timestamp: Date.now(),
        status: event.value.status,
        tokensUsed: event.value.tokensUsed,
      });
    }
    // 原有 meta 事件继续转发
    originalOnMeta?.(event);
  };
}
```

---

## 四、AgentActivity 面板组件

```tsx
// apps/frontend/src/components/AgentThoughtPanel.tsx

import { useState } from 'react';
import { ChevronDown, ChevronUp, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import type { AgentActivityEvent } from '../types';

interface AgentThoughtPanelProps {
  events: AgentActivityEvent[];
  isOpen: boolean;
  onToggle: () => void;
}

export default function AgentThoughtPanel({ events, isOpen, onToggle }: AgentThoughtPanelProps) {
  if (events.length === 0) return null;

  return (
    <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden">
      {/* 标题栏 */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
          🔍 Agent Activity
          <span className="text-xs text-gray-400">({events.length} 步)</span>
        </span>
        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {/* 事件列表 */}
      {isOpen && (
        <div className="px-3 py-2 space-y-1.5 max-h-64 overflow-y-auto text-sm">
          {events.map((event, idx) => (
            <EventItem key={idx} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventItem({ event }: { event: AgentActivityEvent }) {
  if (event.type === 'tool_call') {
    return (
      <div className="flex items-center gap-2 text-gray-600">
        <Clock size={12} className="text-blue-500" />
        <span>
          调用 <strong>{event.toolName}</strong>
        </span>
        {event.args?.query && (
          <span className="text-gray-400 text-xs">"{truncate(event.args.query, 30)}"</span>
        )}
      </div>
    );
  }
  if (event.type === 'tool_result') {
    const icon = event.isError ? (
      <AlertCircle size={12} className="text-red-500" />
    ) : (
      <CheckCircle size={12} className="text-green-500" />
    );
    return (
      <div className="flex items-center gap-2 text-gray-600 pl-4">
        {icon}
        <span>{event.toolName} 完成</span>
        {event.durationMs !== undefined && (
          <span className="text-gray-400 text-xs">{event.durationMs}ms</span>
        )}
        {event.result && (
          <span className="text-gray-400 text-xs">— {truncate(event.result, 40)}</span>
        )}
      </div>
    );
  }
  if (event.type === 'reasoning_summary') {
    return <div className="pl-4 text-gray-400 text-xs italic">💭 {event.summary}</div>;
  }
  if (event.type === 'agent_completed') {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-xs border-t pt-1 mt-1">
        <CheckCircle size={12} className="text-green-500" />
        <span>Agent 完成</span>
        {event.tokensUsed && (
          <span className="text-gray-400">· {event.tokensUsed.total} tokens</span>
        )}
      </div>
    );
  }
  return null;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str;
}
```

---

## 五、ChatPage 集成

在 [ChatPage.tsx](apps/frontend/src/pages/Chat/ChatPage.tsx) 中，在每条 assistant 消息的 sources 下方插入 AgentActivity 面板：

```tsx
// ChatPage.tsx（修改部分，仅展示关键改动）

const { agentEvents, showAgentActivity, appendAgentEvent, toggleAgentActivity } = useChatStore();

// 在 assistant 消息渲染区域：
{
  msg.role === 'assistant' && (
    <>
      <AssistantMessage content={msg.content} sources={msg.sources} />
      {/* Agent Activity 面板（仅在 Agent 模式且有事件时显示） */}
      {agentEvents.length > 0 && (
        <AgentThoughtPanel
          events={agentEvents}
          isOpen={showAgentActivity}
          onToggle={toggleAgentActivity}
        />
      )}
    </>
  );
}
```

**显示逻辑**：

- `agentEvents.length === 0` 时不渲染面板（纯 RAG 模式无事件）
- 流式进行中时实时更新（每次 `appendAgentEvent` 触发重渲染）
- 完成后面板保持展开/折叠状态由 `showAgentActivity` 控制

---

## 六、边界情况

| 场景                               | 处理方式                                                                |
| ---------------------------------- | ----------------------------------------------------------------------- |
| 旧客户端不识别新事件               | 按 `type` 分支忽略，不报错，不渲染面板                                  |
| SSE 断线重连                       | 重连后重新获取当前会话消息，agentEvents 从 0 开始累积（不回放历史事件） |
| 快速连续发送多条消息               | 每次 `send()` 前调用 `clearAgentEvents()`，避免事件混淆                 |
| agent_completed 状态为 `truncated` | 面板中显示"推理步骤已达上限，答案可能不完整"提示                        |
| tool_result 携带 isError=true      | 红色图标 + 显示错误信息摘要                                             |

---

## 七、测试策略

| 测试场景                                          | 验证方式                   |
| ------------------------------------------------- | -------------------------- |
| SSE 收到 `tool_call` 事件 → agentEvents 追加      | 单元测试 chat-store        |
| SSE 收到 `tool_result` 事件 → 显示耗时 + 结果摘要 | 单元测试 chat-store        |
| agentEvents 为空 → 面板不渲染                     | 快照测试 AgentThoughtPanel |
| agentEvents 有数据 → 面板展开/折叠正常            | 交互测试（Playwright）     |
| 旧版 SSE 事件（无新类型）→ 面板不显示             | 回归测试                   |

---

## 八、验收标准

- [ ] 启用 `AGENT_RUNTIME_ENABLED=true` 后，Chat 页面在 assistant 消息下方显示 AgentActivity 面板
- [ ] 面板正确展示 tool_call / tool_result / reasoning_summary 三种事件
- [ ] 旧客户端（不发送新事件类型）行为与升级前完全一致
- [ ] 面板在流式输出过程中实时更新，不阻塞 token 流
- [ ] 所有 Playwright 回归测试通过

---

## 九、文件清单

| 操作 | 文件路径                                             | 说明                                                  |
| ---- | ---------------------------------------------------- | ----------------------------------------------------- |
| 修改 | `apps/frontend/src/types/index.ts`                   | 新增 `AgentActivityEvent` 类型                        |
| 修改 | `apps/frontend/src/services/sse.ts`                  | 新增 `onMeta` 事件解析                                |
| 修改 | `apps/frontend/src/stores/chat-store.ts`             | 新增 `agentEvents` / `showAgentActivity` state 和方法 |
| 新建 | `apps/frontend/src/components/AgentThoughtPanel.tsx` | Activity 面板组件                                     |
| 修改 | `apps/frontend/src/pages/Chat/ChatPage.tsx`          | 集成面板到消息渲染区                                  |
