import axios from "axios";
import type {
  KbListItem,
  DocListItem,
  ChunkCard,
  SearchResultItem,
  ApiServiceItem,
  CreateApiResult,
  SearchParams,
  DashboardSummary,
  TrendPoint,
  ActivityItem,
} from "../types";

const api = axios.create({ baseURL: "/api" });

interface Resp<T> {
  code: number;
  data: T;
}

export const kbApi = {
  list: (search?: string) =>
    api.get<Resp<KbListItem[]>>("/knowledge-bases", { params: { search } }),
  create: (body: { name: string; description?: string; type?: string }) =>
    api.post<Resp<KbListItem>>("/knowledge-bases", body),
  update: (id: string, body: Partial<KbListItem>) =>
    api.put<Resp<KbListItem>>(`/knowledge-bases/${id}`, body),
  remove: (id: string) => api.delete(`/knowledge-bases/${id}`),
};

export const docApi = {
  list: (kbId: string, search?: string) =>
    api.get<Resp<DocListItem[]>>(`/knowledge-bases/${kbId}/documents`, {
      params: { search },
    }),
  upload: (kbId: string, file: File, processStrategy?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (processStrategy) form.append("processStrategy", processStrategy);
    return api.post<Resp<DocListItem>>(
      `/knowledge-bases/${kbId}/documents`,
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
  },
  remove: (kbId: string, docId: string) =>
    api.delete(`/knowledge-bases/${kbId}/documents/${docId}`),
};

export const chunkApi = {
  byDoc: (docId: string, pageSize = 10, page = 1) =>
    api.get<Resp<{ total: number; items: ChunkCard[] }>>(
      `/documents/${docId}/chunks`,
      { params: { pageSize, page } },
    ),
  byKb: (kbId: string, pageSize = 10, page = 1) =>
    api.get<Resp<{ total: number; items: ChunkCard[] }>>(
      `/knowledge-bases/${kbId}/chunks`,
      { params: { pageSize, page } },
    ),
  create: (docId: string, body: { content: string; title?: string }) =>
    api.post<Resp<ChunkCard>>(`/documents/${docId}/chunks`, body),
  update: (chunkId: string, body: { content: string; title?: string }) =>
    api.put<Resp<ChunkCard>>(`/chunks/${chunkId}`, body),
  remove: (chunkId: string) => api.delete(`/chunks/${chunkId}`),
};

export const retrievalApi = {
  search: (kbId: string, query: string, params: SearchParams) =>
    api.post<Resp<{ results: SearchResultItem[]; searchHistory: unknown[] }>>(
      "/retrieval/search",
      { kbId, query, ...params },
    ),
};

export const apiServiceApi = {
  list: () => api.get<Resp<ApiServiceItem[]>>("/api-services"),
  create: (body: {
    serviceName: string;
    description?: string;
    kbId: string;
    creator?: string;
  }) => api.post<Resp<CreateApiResult>>("/api-services", body),
  remove: (id: string) => api.delete(`/api-services/${id}`),
};

export const dashboardApi = {
  summary: () => api.get<Resp<DashboardSummary>>("/dashboard/summary"),
  trends: () => api.get<Resp<TrendPoint[]>>("/dashboard/usage-trends"),
  activities: () => api.get<Resp<{ items: ActivityItem[] }>>("/dashboard/recent-activities"),
};

export default api;
