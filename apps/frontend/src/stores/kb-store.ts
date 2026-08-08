import { create } from "zustand";
import type { KbListItem } from "../types";
import { kbApi } from "../services/api";

interface KbStore {
  list: KbListItem[];
  current: KbListItem | null;
  loading: boolean;
  fetch: (search?: string) => Promise<void>;
  select: (kb: KbListItem | null) => void;
  refreshCurrent: () => Promise<void>;
}

export const useKbStore = create<KbStore>((set, get) => ({
  list: [],
  current: null,
  loading: false,
  fetch: async (search?: string) => {
    set({ loading: true });
    const res = await kbApi.list(search);
    set({ list: res.data.data, loading: false });
  },
  select: (kb) => set({ current: kb }),
  refreshCurrent: async () => {
    const cur = get().current;
    if (!cur) return;
    const res = await kbApi.list();
    const updated = res.data.data.find((k) => k.id === cur.id) ?? cur;
    set({ current: updated });
  },
}));
