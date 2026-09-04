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
    const existingCurrent = get().current;
    // 如果有有效的 current（非加载中状态），保持 loading=false
    set({ loading: !!existingCurrent?.name?.includes('加载中') });
    const res = await kbApi.list(search);
    const list = res.data.data;
    // 刷新后：如果当前库不再列表中，清除持久化
    const current = get().current;
    if (current && !list.find((k) => k.id === current.id)) {
      saveCurrentKB(null);
      set({ current: null });
    }
    set({ list, loading: false });
    // 确保列表中每个项的 isDefault 始终与 defaultKbId 一致
    const { defaultKbId } = get();
    const updatedList = list.map((k) => ({ ...k, isDefault: k.id === defaultKbId }));
    set({ list: updatedList });
    // 如果没有选中知识库，自动选中（优先默认知识库，否则选第一个）
    const { current: cur, defaultKbId: currDefaultKbId } = get();
    if (!cur) {
      const targetKb = currDefaultKbId
        ? list.find((k) => k.id === currDefaultKbId)
        : list[0];
      if (targetKb) {
        saveCurrentKB(targetKb);
        set({ current: { ...targetKb, isDefault: targetKb.id === defaultKbId } });
      }
    }
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
      set({ list: updatedList, defaultKbId: null, current: null });
      saveCurrentKB(null);
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
      saveCurrentKB(kb);
    }
  },
}));
