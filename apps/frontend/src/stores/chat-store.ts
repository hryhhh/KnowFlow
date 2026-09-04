import { create } from 'zustand';
import type {
  ChatMessage,
  SourceRef,
  SearchParams,
  SessionListItem,
  Citation,
  ProcessIndicator,
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
  // 方法
  loadSessions: (kbId: string) => Promise<void>;
  refreshSessions: (kbId: string) => Promise<void>;
  createSession: (kbId: string, firstMessage: string) => Promise<string>;
  switchSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  clearAllSessions: (kbId: string) => Promise<void>;
  send: (kbId: string, query: string) => Promise<void>;
  setParams: (params: Partial<SearchParams>) => void;
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
    minScore: 0.1,
    useReranker: false,
    denseWeight: 0.5,
  },
  isStreaming: false,

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
    set({ currentSessionId: sessionId, messages: [], sources: [], processIndicators: [], isStreaming: false });
    const res = await sessionApi.messages(sessionId);
    // 解析每条消息的 citations（持久化后 sources 仍在，可重新解析）
    const messagesWithCitations = (res.data.data ?? []).map((msg: ChatMessage) => {
      if (msg.role === 'assistant' && msg.sources && msg.sources.length > 0) {
        const normalizedSources = normalizeSources(msg.sources);
        return { ...msg, sources: normalizedSources, citations: parseCitations(msg.content, normalizedSources) };
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

  send: async (kbId, query) => {
    if (!query.trim() || get().isStreaming) return;

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

    // 添加用户消息到本地状态，并立即显示思考指示器
    const userMsg: ChatMessage = { role: 'user', content: query };
    set((s) => ({
      messages: [...s.messages, userMsg],
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
          // 清除过程指示器状态
          set({ isStreaming: false, processIndicators: [] });
        },
        onError: (msg) => {
          set((s) => ({
            isStreaming: false,
            processIndicators: [],
            messages: [
              ...s.messages,
              { role: 'assistant', content: `⚠️ ${msg}`, sources, citations: [] },
            ],
          }));
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
    }),
}));
