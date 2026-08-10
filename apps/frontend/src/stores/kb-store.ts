import { create } from "zustand";
import type { KbListItem } from "../types";
import { kbApi } from "../services/api";

const CURRENT_KB_KEY = "knowbase_current_kb";

function loadCurrentKB(): KbListItem | null {
  try {
    const raw = localStorage.getItem(CURRENT_KB_KEY);
    return raw ? (JSON.parse(raw) as KbListItem) : null;
  } catch {
    return null;
  }
}

function saveCurrentKB(kb: KbListItem | null): void {
  try {
    if (kb) {
      localStorage.setItem(CURRENT_KB_KEY, JSON.stringify(kb));
    } else {
      localStorage.removeItem(CURRENT_KB_KEY);
    }
  } catch {
    // ignore
  }
}

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
  current: loadCurrentKB(),
  loading: false,
  fetch: async (search?: string) => {
    set({ loading: true });
    const res = await kbApi.list(search);
    const list = res.data.data;
    // 刷新后：如果当前库不再列表中，清除持久化
    const current = get().current;
    if (current && !list.find((k) => k.id === current.id)) {
      saveCurrentKB(null);
      set({ current: null });
    }
    set({ list, loading: false });
  },
  select: (kb) => {
    saveCurrentKB(kb);
    set({ current: kb });
  },
  refreshCurrent: async () => {
    const cur = get().current;
    if (!cur) return;
    const res = await kbApi.list();
    const updated = res.data.data.find((k) => k.id === cur.id) ?? cur;
    saveCurrentKB(updated);
    set({ current: updated });
  },
}));
