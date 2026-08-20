import { create } from 'zustand';
import type { KbListItem } from '../types';
import { kbApi } from '../services/api';

const CURRENT_KB_KEY = 'knowbase_current_kb';
const DEFAULT_KB_ID_KEY = 'knowbase_default_kb_id';

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

function loadDefaultKBId(): string | null {
  try {
    return localStorage.getItem(DEFAULT_KB_ID_KEY);
  } catch {
    return null;
  }
}

function saveDefaultKBId(kbId: string | null): void {
  try {
    if (kbId) {
      localStorage.setItem(DEFAULT_KB_ID_KEY, kbId);
    } else {
      localStorage.removeItem(DEFAULT_KB_ID_KEY);
    }
  } catch {
    // ignore
  }
}

interface KbStore {
  list: KbListItem[];
  current: KbListItem | null;
  defaultKbId: string | null;
  loading: boolean;
  fetch: (search?: string) => Promise<void>;
  select: (kb: KbListItem | null) => void;
  refreshCurrent: () => Promise<void>;
  setDefaultKb: (kbId: string) => void;
}

export const useKbStore = create<KbStore>((set, get) => ({
  list: [],
  current: loadCurrentKB(),
  defaultKbId: loadDefaultKBId(),
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
  setDefaultKb: (kbId: string) => {
    // 传入空字符串表示取消默认
    if (!kbId) {
      saveDefaultKBId(null);
      const { list } = get();
      const updatedList = list.map((k) => ({ ...k, isDefault: false }));
      set({ list: updatedList, defaultKbId: null });
      return;
    }
    saveDefaultKBId(kbId);
    const { list } = get();
    const kb = list.find((k) => k.id === kbId);
    if (kb) {
      const updatedList = list.map((k) => ({
        ...k,
        isDefault: k.id === kbId,
      }));
      set({ list: updatedList, defaultKbId: kbId, current: { ...kb, isDefault: true } });
    }
  },
}));
