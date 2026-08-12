import { create } from "zustand";
import type { ChatMessage, SourceRef, SearchParams, SessionListItem } from "../types";
import { streamChat } from "../services/sse";
import { sessionApi } from "../services/api";

interface ChatStore {
  // 会话列表
  sessions: SessionListItem[];
  currentSessionId: string | null;
  // 消息和参数
  messages: ChatMessage[];
  sources: SourceRef[];
  searchParams: SearchParams;
  isStreaming: boolean;
  agentStatus: null | "db-query" | "web-search" | "ragflow";
  // 方法
  loadSessions: (kbId: string) => Promise<void>;
  createSession: (kbId: string, firstMessage: string) => Promise<string>;
  switchSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
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
    minScore: 0.70,
    useReranker: false,
    denseWeight: 0.5,
  },
  isStreaming: false,
  agentStatus: null,

  loadSessions: async (kbId) => {
    const res = await sessionApi.list(kbId);
    set({ sessions: res.data.data });
  },

  createSession: async (kbId, firstMessage) => {
    const res = await sessionApi.create({ kbId, firstMessage });
    const newSession = res.data.data;
    set((s) => ({
      sessions: [{ ...newSession, messageCount: 1, id: newSession.id } as SessionListItem, ...s.sessions],
      currentSessionId: newSession.id,
    }));
    return newSession.id;
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

  send: async (kbId, query) => {
    if (!query.trim() || get().isStreaming) return;

    // 如果没有当前会话，先创建
    let sessionId = get().currentSessionId;
    if (!sessionId) {
      sessionId = await get().createSession(kbId, query);
    }

    // 添加用户消息到本地状态
    const userMsg: ChatMessage = { role: "user", content: query };
    set((s) => ({
      messages: [...s.messages, userMsg],
      sources: [],
      isStreaming: true,
      agentStatus: null,
    }));

    const params = get().searchParams;
    let assistant = "";
    let sources: SourceRef[] = [];

    const result = await streamChat(kbId, query, params, {
      onSources: (s) => {
        sources = s;
        set({ sources: s });
      },
      onToken: (token) => {
        assistant += token;
        set((s) => ({
          messages: [
            ...s.messages.slice(0, -1),
            { role: "assistant" as const, content: assistant, sources },
          ],
        }));
      },
      onDone: () => set({ isStreaming: false }),
      onError: (msg) => {
        set((s) => ({
          isStreaming: false,
          agentStatus: null,
          messages: [
            ...s.messages.slice(0, -1),
            { role: "assistant" as const, content: `⚠️ ${msg}`, sources },
          ],
        }));
      },
      onMeta: (meta) => {
        if (meta.type === "agent_start" && meta.agent) {
          set({ agentStatus: meta.agent as ChatStore["agentStatus"] });
        } else if (meta.type === "agent_done") {
          set({ agentStatus: null });
        }
      },
    }, { sessionId });

    // 更新会话的消息数量
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === result.sessionId
          ? { ...session, messageCount: session.messageCount + 2 }
          : session,
      ),
    }));
  },

  setParams: (params) =>
    set((s) => ({ searchParams: { ...s.searchParams, ...params } })),
  reset: () =>
    set({
      messages: [],
      sources: [],
      isStreaming: false,
      agentStatus: null,
      currentSessionId: null,
      sessions: [],
    }),
}));
