import { create } from 'zustand';
import type {
  ChatMessage,
  SourceRef,
  SearchParams,
  SessionListItem,
  Citation,
  ProcessIndicator,
  AgentActivityEvent,
} from '../types';
import { streamChat } from '../services/sse';
import { sessionApi } from '../services/api';

/** 规范化 sources：兼容 agent 模式存储的 {uri, title} 格式 */
function normalizeSources(raw: any[]): SourceRef[] {
  return (raw ?? []).map((s) => ({
    content: s.content ?? s.uri ?? '',
    sourceFile: s.sourceFile ?? s.title ?? s.uri ?? '',
    score: s.score ?? 0.8,
  }));
}

/** 从 LLM 回复中提取 [1][2] 或 资料1 等引用编号，映射到 sources 数组 */
function parseCitations(text: string, sources: SourceRef[]): Citation[] {
  const citations: Citation[] = [];
  const seen = new Set<number>();
  // 同时匹配 [N] 和 资料N 格式
  const re = /\[(\d+)\]|资料(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const idx = parseInt(m[1] ?? m[2]!, 10);
    if (idx >= 1 && idx <= sources.length && !seen.has(idx)) {
      seen.add(idx);
      citations.push({ index: idx, source: sources[idx - 1] });
    }
  }
  return citations;
}

/** 清理 RAG 内容中的系统前缀（如 【RAGFlow】） */
export function cleanContent(text: string): string {
  return text
    .replace(/^【RAGFlow】\s*\n?/, '')
    .replace(/^【DB-Query】\s*\n?/, '')
    .replace(/^【Web-Search】\s*\n?/, '');
}

/** 将存储格式（资料N）转为标准引用格式（[N]），并清理系统前缀 */
export function normalizeContent(content: string): string {
  let normalized = cleanContent(content);
  // 匹配"资料"+1-2位数字，后面跟中文标点或行尾
  return normalized.replace(/资料(\d{1,2})(?=[，。！？、\]））]|$)/g, (_, num) => `[${num}]`);
}

interface ChatStore {
  // 会话列表
  sessions: SessionListItem[];
  currentSessionId: string | null;
  // 消息和参数
  messages: ChatMessage[];
  sources: SourceRef[];
  processIndicators: ProcessIndicator[];
  searchParams: SearchParams;
  isStreaming: boolean;
  // AgentActivity
  agentEvents: AgentActivityEvent[];
  showAgentActivity: boolean;
  // 方法
  loadSessions: (kbId: string) => Promise<void>;
  refreshSessions: (kbId: string) => Promise<void>;
  createSession: (kbId: string, firstMessage: string) => Promise<string>;
  switchSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  clearAllSessions: (kbId: string) => Promise<void>;
  send: (kbId: string, query: string) => Promise<void>;
  setParams: (params: Partial<SearchParams>) => void;
  appendAgentEvent: (event: AgentActivityEvent) => void;
  toggleAgentActivity: () => void;
  clearAgentEvents: () => void;
  reset: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  sources: [],
  processIndicators: [],
  searchParams: {
    topK: 10,
    minScore: 0.7,
    useReranker: false,
    denseWeight: 0.5,
  },
  isStreaming: false,
  agentEvents: [],
  showAgentActivity: false,

  loadSessions: async (kbId) => {
    const res = await sessionApi.list(kbId);
    set({
      sessions: (res.data.data ?? []).map((s) => ({
        ...s,
        title: s.title || '新会话',
      })),
    });
  },

  refreshSessions: async (kbId: string) => get().loadSessions(kbId),

  createSession: async (kbId: string, firstMessage: string): Promise<string> => {
    try {
      const res = await sessionApi.create({ kbId, firstMessage });
      const newSession = res.data.data;
      const displayTitle = newSession.title || '新会话';
      set((s) => ({
        sessions: [
          {
            ...newSession,
            title: displayTitle,
            messageCount: 0,
            id: newSession.id,
          } as SessionListItem,
          ...s.sessions,
        ],
        currentSessionId: newSession.id,
        messages: [],
        sources: [],
        processIndicators: [],
        isStreaming: false,
      }));
      return newSession.id;
    } catch (_e) {
      throw _e;
    }
  },

  switchSession: async (sessionId) => {
    if (sessionId === get().currentSessionId) return;
    set({
      currentSessionId: sessionId,
      messages: [],
      sources: [],
      processIndicators: [],
      isStreaming: false,
      agentEvents: [],
      showAgentActivity: false,
    });
    const res = await sessionApi.messages(sessionId);
    // 解析每条消息的 citations（持久化后 sources 仍在，可重新解析）
    const messagesWithCitations = (res.data.data ?? []).map((msg: ChatMessage) => {
      if (msg.role === 'assistant' && msg.sources && msg.sources.length > 0) {
        const normalizedSources = normalizeSources(msg.sources);
        return {
          ...msg,
          sources: normalizedSources,
          citations: parseCitations(msg.content, normalizedSources),
        };
      }
      return msg;
    });
    set({ messages: messagesWithCitations });
  },

  deleteSession: async (sessionId) => {
    await sessionApi.remove(sessionId);
    set((s) => ({
      sessions: s.sessions.filter((session) => session.id !== sessionId),
      currentSessionId: s.currentSessionId === sessionId ? null : s.currentSessionId,
      messages: s.currentSessionId === sessionId ? [] : s.messages,
      processIndicators: s.currentSessionId === sessionId ? [] : s.processIndicators,
    }));
  },

  clearAllSessions: async (kbId) => {
    await sessionApi.clearAll(kbId);
    set({ sessions: [], currentSessionId: null, messages: [], sources: [], processIndicators: [] });
  },

  appendAgentEvent: (event) =>
    set((s) => ({
      agentEvents: [...s.agentEvents, event],
      // 本轮首个 agent 事件到达时自动展开面板（用户手动收起后不强制再展开）
      showAgentActivity: s.showAgentActivity || s.agentEvents.length === 0,
    })),

  toggleAgentActivity: () => set((s) => ({ showAgentActivity: !s.showAgentActivity })),

  clearAgentEvents: () => set({ agentEvents: [], showAgentActivity: false }),

  send: async (kbId, query) => {
    if (!query.trim() || get().isStreaming) return;

    // 清空上一次的 Agent 事件
    get().clearAgentEvents();

    // 如果没有当前会话，先创建
    let sessionId = get().currentSessionId;
    if (!sessionId) {
      sessionId = await get().createSession(kbId, query);
    } else {
      // 已有会话且标题为"新会话"（空白会话），用第一条消息更新标题
      const currentTitle = get().sessions.find((s) => s.id === sessionId)?.title;
      if (currentTitle === '新会话') {
        await sessionApi.updateTitle(sessionId, query);
        set((s) => ({
          sessions: s.sessions.map((session) =>
            session.id === sessionId ? { ...session, title: query } : session,
          ),
        }));
      }
    }

    // 添加用户消息 + assistant 占位气泡（承载流式答案与实时 Agent 活动面板）
    const userMsg: ChatMessage = { role: 'user', content: query };
    const placeholderMsg: ChatMessage = { role: 'assistant', content: '' };
    set((s) => ({
      messages: [...s.messages, userMsg, placeholderMsg],
      sources: [],
      processIndicators: [{ stage: 'retrieving', label: '正在思考中…' }],
      isStreaming: true,
    }));

    const params = get().searchParams;
    let assistant = '';
    let sources: SourceRef[] = [];

    const result = await streamChat(
      kbId,
      query,
      params,
      {
        onSources: (s) => {
          sources = s;
          set({ sources: s });
        },
        onMeta: (event) => {
          // 过程指示器（Orchestrator 路径 process 事件）
          if (event.type === 'process') {
            const p = event.value as ProcessIndicator;
            set((s) => {
              const last = s.processIndicators[s.processIndicators.length - 1];
              // 去重：同 stage 不重复添加
              if (last && last.stage === p.stage) return s;
              const next = [...s.processIndicators, p];
              return { processIndicators: next };
            });
          } else if (event.type === 'done') {
            set({ processIndicators: [], isStreaming: false });
          } else if (event.type === 'answer_reset') {
            // 工具轮次回收：流式路径中工具调用前的文本分片先清出答案区，
            // 随后以 reasoning_summary 事件呈现在 Agent 活动面板中。
            // 必须同时重置闭包累加器 assistant，否则下一个 token 会把旧文本整段写回
            assistant = '';
            set((s) => {
              const msgs = [...s.messages];
              const last = msgs[msgs.length - 1];
              if (last && last.role === 'assistant' && last.content) {
                msgs[msgs.length - 1] = { ...last, content: '' };
              }
              return { messages: msgs };
            });
          } else if (
            event.type === 'tool_call' ||
            event.type === 'tool_result' ||
            event.type === 'reasoning_summary' ||
            event.type === 'agent_start' ||
            event.type === 'agent_completed'
          ) {
            // Agent 事件转发给 store，兼容两种载荷：
            // AgentRuntime 事件为 {type, timestamp, data}，Orchestrator 路径事件为 {type, value}
            const d = event.data ?? event.value ?? {};
            get().appendAgentEvent({
              type: event.type,
              timestamp: event.timestamp ?? Date.now(),
              toolName: d.toolName,
              args: d.args,
              result: d.result,
              summary: d.summary,
              durationMs: d.durationMs,
              isError: d.isError,
              status: d.status,
              tokensUsed: d.tokensUsed,
              data: d,
            });
          }
        },
        onToken: (token) => {
          assistant += token;
          const citations = parseCitations(assistant, sources);
          set((s) => {
            const msgs = [...s.messages];
            const last = msgs[msgs.length - 1];
            if (last && last.role === 'assistant') {
              // 打字机效果：只更新最后一条助手消息的内容
              msgs[msgs.length - 1] = {
                role: 'assistant',
                content: assistant,
                sources,
                citations,
              };
            } else {
              msgs.push({ role: 'assistant', content: assistant, sources, citations });
            }
            return { messages: msgs };
          });
        },
        onDone: () => {
          // 结束：清过程指示器，并把本轮 Agent 事件挂到最后一条 assistant 消息，
          // 供会话内回看历史回答时展开当时的执行步骤
          set((s) => {
            const msgs = [...s.messages];
            const last = msgs[msgs.length - 1];
            if (last && last.role === 'assistant' && s.agentEvents.length > 0) {
              msgs[msgs.length - 1] = { ...last, agentEvents: [...s.agentEvents] };
            }
            return { isStreaming: false, processIndicators: [], messages: msgs };
          });
        },
        onError: (msg) => {
          set((s) => {
            const msgs = [...s.messages];
            const last = msgs[msgs.length - 1];
            const errMsg: ChatMessage = {
              role: 'assistant',
              content: `⚠️ ${msg}`,
              sources,
              citations: [],
            };
            if (last && last.role === 'assistant' && !last.content) {
              // 占位气泡尚未收到任何答案 → 原地替换为错误消息
              msgs[msgs.length - 1] = errMsg;
            } else {
              msgs.push(errMsg);
            }
            return { isStreaming: false, processIndicators: [], messages: msgs };
          });
        },
      },
      { sessionId },
    );

    // 发送完成后刷新列表，让正式会话显示在历史中
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === result.sessionId
          ? { ...session, messageCount: session.messageCount + 2 }
          : session,
      ),
    }));
    get().refreshSessions(kbId);
  },

  setParams: (params) => set((s) => ({ searchParams: { ...s.searchParams, ...params } })),
  reset: () =>
    set({
      messages: [],
      sources: [],
      processIndicators: [],
      isStreaming: false,
      currentSessionId: null,
      sessions: [],
      agentEvents: [],
      showAgentActivity: false,
    }),
}));
