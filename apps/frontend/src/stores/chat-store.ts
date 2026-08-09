import { create } from "zustand";
import type { ChatMessage, SourceRef, SearchParams } from "../types";
import { streamChat } from "../services/sse";

interface ChatStore {
  messages: ChatMessage[];
  sources: SourceRef[];
  searchParams: SearchParams;
  isStreaming: boolean;
  send: (kbId: string, query: string) => Promise<void>;
  setParams: (params: Partial<SearchParams>) => void;
  reset: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  sources: [],
  searchParams: {
    topK: 10,
    minScore: 0.70,
    useReranker: false,
    denseWeight: 0.5,
  },
  isStreaming: false,
  send: async (kbId, query) => {
    if (!query.trim() || get().isStreaming) return;
    set((s) => ({
      messages: [...s.messages, { role: "user", content: query }],
      sources: [],
      isStreaming: true,
    }));

    const params = get().searchParams;
    let assistant = "";

    await streamChat(kbId, query, params, {
      onSources: (sources) => set({ sources }),
      onToken: (token) => {
        assistant += token;
        set((s) => {
          const msgs = [...s.messages];
          const last = msgs[msgs.length - 1];
          if (last && last.role === "assistant") {
            msgs[msgs.length - 1] = { role: "assistant", content: assistant };
          } else {
            msgs.push({ role: "assistant", content: assistant });
          }
          return { messages: msgs };
        });
      },
      onDone: () => set({ isStreaming: false }),
      onError: (msg) => {
        set((s) => ({
          isStreaming: false,
          messages: [...s.messages, { role: "assistant", content: `⚠️ ${msg}` }],
        }));
      },
    });
  },
  setParams: (params) =>
    set((s) => ({ searchParams: { ...s.searchParams, ...params } })),
  reset: () => set({ messages: [], sources: [], isStreaming: false }),
}));
