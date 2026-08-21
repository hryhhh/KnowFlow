import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RetrievalService } from './retrieval.service.js';

vi.mock('@knowbase-x/rag-engine', () => ({
  retrieve: vi.fn(),
}));

import { retrieve } from '@knowbase-x/rag-engine';

const RAG_CONFIG = Symbol('RAG_CONFIG');

function makeMockUsageLog() {
  return {
    record: vi.fn().mockResolvedValue(undefined),
  };
}

describe('RetrievalService', () => {
  let usageLog: ReturnType<typeof makeMockUsageLog>;
  let service: RetrievalService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DEFAULT_MIN_SCORE', '');
    usageLog = makeMockUsageLog();
    service = Object.create(RetrievalService.prototype);
    service.ragConfig = {
      pg: { host: 'localhost', port: 5432, user: 'test', password: 'test', database: 'test' },
      llm: { apiKey: 'test', model: 'gpt-4', baseURL: 'https://api.test.com' },
      embedding: {
        apiKey: 'test',
        model: 'text-embedding-3-small',
        baseURL: 'https://api.test.com',
        dimensions: 3,
      },
      chunkSize: 1000,
      chunkOverlap: 200,
    };
    service.usageLog = usageLog;
  });

  it('calls retrieve with default params and maps results', async () => {
    const mockResults = [
      { content: 'result1', sourceFile: 'doc1.pdf', score: 0.85 },
      { content: 'result2', sourceFile: 'doc2.pdf', score: 0.72 },
    ];
    vi.mocked(retrieve).mockResolvedValue(mockResults as any);

    const dto = { query: 'what is RAG', kbId: 'kb-1' };
    const result = await service.search(dto as any);

    expect(retrieve).toHaveBeenCalledWith(
      'what is RAG',
      'kb-1',
      expect.objectContaining({
        topK: 10,
        minScore: 0.7,
        useReranker: false,
        denseWeight: 0.5,
      }),
      service.ragConfig,
    );
    expect(result).toHaveLength(2);
    expect(result[0].chunkId).toBe('doc1.pdf#0.85');
    expect(result[0].content).toBe('result1');
    expect(result[0].score).toBe(0.85);
    expect(result[1].chunkId).toBe('doc2.pdf#0.72');
  });

  it('uses dto params when provided', async () => {
    vi.mocked(retrieve).mockResolvedValue([]);

    const dto = {
      query: 'test',
      kbId: 'kb-1',
      topK: 5,
      minScore: 0.8,
      useReranker: true,
      denseWeight: 0.3,
    };
    await service.search(dto as any);

    expect(retrieve).toHaveBeenCalledWith(
      'test',
      'kb-1',
      expect.objectContaining({ topK: 5, minScore: 0.8, useReranker: true, denseWeight: 0.3 }),
      service.ragConfig,
    );
  });

  it('falls back to DEFAULT_MIN_SCORE env var when dto.minScore is missing', async () => {
    vi.stubEnv('DEFAULT_MIN_SCORE', '0.6');
    vi.mocked(retrieve).mockResolvedValue([]);

    const dto = { query: 'test', kbId: 'kb-1' };
    await service.search(dto as any);

    expect(retrieve).toHaveBeenCalledWith(
      'test',
      'kb-1',
      expect.objectContaining({ minScore: 0.6 }),
      service.ragConfig,
    );
  });

  it('records usage log on success', async () => {
    vi.mocked(retrieve).mockResolvedValue([]);
    const dto = { query: 'test', kbId: 'kb-1' };
    await service.search(dto as any);

    expect(usageLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'retrieval',
        kbId: 'kb-1',
        status: 'success',
        duration: expect.any(Number),
      }),
    );
  });

  it('records error and re-throws when retrieve fails', async () => {
    vi.mocked(retrieve).mockRejectedValue(new Error('connection failed'));

    const dto = { query: 'test', kbId: 'kb-1' };
    await expect(service.search(dto as any)).rejects.toThrow('connection failed');
    expect(usageLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'retrieval',
        kbId: 'kb-1',
        status: 'error',
      }),
    );
  });
});
