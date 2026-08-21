import { create } from 'zustand';
import type { ChatMessage, SourceRef, SearchParams, SessionListItem } from '../types';
import { streamChat } from '../services/sse';
import { sessionApi } from '../services/api';

interface ChatStore {
  // 会话列表
  sessions: SessionListItem[];
  currentSessionId: string | null;
  // 消息和参数
  messages: ChatMessage[];
  sources: SourceRef[];
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

  refreshSessions: async (kbId) => {
    const res = await sessionApi.list(kbId);
    set({
      sessions: (res.data.data ?? []).map((s) => ({
        ...s,
        title: s.title || '新会话',
      })),
    });
  },

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
        isStreaming: false,
      }));
      return newSession.id;
    } catch (_e) {
      throw _e;
    }
  },

  switchSession: async (sessionId) => {
    if (sessionId === get().currentSessionId) return;
    set({ currentSessionId: sessionId, messages: [], sources: [], isStreaming: false });
    const res = await sessionApi.messages(sessionId);
    set({ messages: res.data.data });
  },

  deleteSession: async (sessionId) => {
    await sessionApi.remove(sessionId);
    set((s) => ({
      sessions: s.sessions.filter((session) => session.id !== sessionId),
      currentSessionId: s.currentSessionId === sessionId ? null : s.currentSessionId,
      messages: s.currentSessionId === sessionId ? [] : s.messages,
    }));
  },

  clearAllSessions: async (kbId) => {
    await sessionApi.clearAll(kbId);
    set({ sessions: [], currentSessionId: null, messages: [], sources: [] });
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

    // 添加用户消息到本地状态
    const userMsg: ChatMessage = { role: 'user', content: query };
    set((s) => ({
      messages: [...s.messages, userMsg],
      sources: [],
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
        onToken: (token) => {
          assistant += token;
          set((s) => {
            const msgs = [...s.messages];
            const last = msgs[msgs.length - 1];
            if (last && last.role === 'assistant') {
              msgs[msgs.length - 1] = { role: 'assistant', content: assistant, sources };
            } else {
              msgs.push({ role: 'assistant', content: assistant, sources });
            }
            return { messages: msgs };
          });
        },
        onDone: () => set({ isStreaming: false }),
        onError: (msg) => {
          set((s) => ({
            isStreaming: false,
            messages: [
              ...s.messages.slice(0, -1),
              { role: 'assistant', content: `⚠️ ${msg}`, sources },
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
      isStreaming: false,
      currentSessionId: null,
      sessions: [],
    }),
}));
