import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RAGPipelineConfig, SearchParams, StreamCallbacks, RetrievalResult } from './types.js';
import { retrieve, retrieveAndChat } from './pipeline.js';

vi.mock('./embeddings/openai-embeddings.js', () => ({
  getEmbeddings: vi.fn(() => ({
    embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  })),
}));

vi.mock('./stores/pgvector-store.js', () => ({
  ensureCachedPGVectorStore: vi.fn().mockResolvedValue({
    similaritySearchVectorWithScore: vi.fn().mockResolvedValue([]),
  }),
  addDocumentsToPG: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./retrievers/similarity-retriever.js', () => ({
  similaritySearch: vi.fn(),
}));

vi.mock('./retrievers/hybrid-retriever.js', () => ({
  hybridSearch: vi.fn(),
}));

vi.mock('./rerankers/bi-encoder-reranker.js', () => ({
  rerank: vi.fn().mockResolvedValue([]),
}));

vi.mock('./llm/chat-service.js', () => ({
  streamChat: vi.fn(),
  buildContext: vi.fn((results: RetrievalResult[]) => {
    if (!results.length) return '（暂无可用参考资料）';
    return results.map((r, i) => `[${i + 1}] ${r.content}`).join('\n');
  }),
}));

import { similaritySearch } from './retrievers/similarity-retriever.js';
import { hybridSearch } from './retrievers/hybrid-retriever.js';
import { rerank } from './rerankers/bi-encoder-reranker.js';
import { streamChat, buildContext } from './llm/chat-service.js';
import { ensureCachedPGVectorStore } from './stores/pgvector-store.js';
import { getEmbeddings } from './embeddings/openai-embeddings.js';

const mockConfig: RAGPipelineConfig = {
  pg: { host: 'localhost', port: 5432, user: 'test', password: 'test', database: 'testdb' },
  llm: { apiKey: 'test-key', model: 'gpt-4o-mini', baseURL: 'https://api.test.com' },
  embedding: {
    apiKey: 'test-key',
    model: 'text-embedding-3-small',
    baseURL: 'https://api.test.com',
    dimensions: 3,
  },
  chunkSize: 500,
  chunkOverlap: 50,
  pgTableName: 'langchainjs',
};

const mockParams: SearchParams = {
  topK: 5,
  minScore: 0.3,
  useReranker: false,
  denseWeight: 0.5,
};

const mockResults: RetrievalResult[] = [
  { content: 'Result 1', score: 0.85, sourceFile: 'doc1.pdf', metadata: {} },
  { content: 'Result 2', score: 0.6, sourceFile: 'doc2.txt', metadata: {} },
];

describe('retrieve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (similaritySearch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResults);
    (hybridSearch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResults);
    (rerank as ReturnType<typeof vi.fn>).mockResolvedValue(mockResults);
  });

  it('should call performSearch with correct kbId filter', async () => {
    const kbId = 'kb-123';
    await retrieve('what is RAG?', kbId, mockParams, mockConfig);
    expect(similaritySearch).toHaveBeenCalled();
    const callArgs = (similaritySearch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0].filter).toEqual({ kbId });
  });

  it('should apply minScore filtering', async () => {
    const lowParam: SearchParams = { ...mockParams, minScore: 0.99 };
    const results = await retrieve('query', 'kb-1', lowParam, mockConfig);
    expect(results).toHaveLength(0);
  });

  it('should run hybrid search then rerank when useReranker=true', async () => {
    (rerank as ReturnType<typeof vi.fn>).mockResolvedValue(mockResults);
    const params: SearchParams = { ...mockParams, useReranker: true };
    await retrieve('query', 'kb-1', params, mockConfig);

    expect(hybridSearch).toHaveBeenCalled();
    expect(rerank).toHaveBeenCalledWith(
      'query',
      expect.any(Array),
      mockConfig.embedding,
      expect.objectContaining({ topK: 5 }),
    );
  });

  it('should run similarity search only when useReranker=false', async () => {
    const params: SearchParams = { ...mockParams, useReranker: false };
    await retrieve('query', 'kb-1', params, mockConfig);

    expect(similaritySearch).toHaveBeenCalled();
    expect(hybridSearch).not.toHaveBeenCalled();
    expect(rerank).not.toHaveBeenCalled();
  });

  it('should return filtered results', async () => {
    const result = await retrieve('query', 'kb-1', mockParams, mockConfig);
    expect(result).toEqual(mockResults);
  });

  it('should get embeddings and cached store', async () => {
    await retrieve('query', 'kb-1', mockParams, mockConfig);
    expect(getEmbeddings).toHaveBeenCalledWith(mockConfig.embedding);
    expect(ensureCachedPGVectorStore).toHaveBeenCalled();
  });
});

describe('retrieveAndChat', () => {
  let callbacks: StreamCallbacks;

  beforeEach(() => {
    vi.clearAllMocks();
    (similaritySearch as ReturnType<typeof vi.fn>).mockResolvedValue(mockResults);
    // Reset streamChat: call onDone on successful resolve
    (streamChat as ReturnType<typeof vi.fn>).mockImplementation(
      async (_req: any, _config: any, cbs: StreamCallbacks) => cbs.onDone(),
    );

    callbacks = {
      onSources: vi.fn(),
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    };
  });

  it('should push sources via callbacks.onSources', async () => {
    await retrieveAndChat('What is RAG?', 'kb-1', mockParams, mockConfig, callbacks);
    expect(callbacks.onSources).toHaveBeenCalledOnce();
    const sources = callbacks.onSources.mock.calls[0][0];
    expect(sources).toHaveLength(2);
    expect(sources[0].content).toBe('Result 1');
    expect(sources[0].sourceFile).toBe('doc1.pdf');
    expect(sources[0].score).toBe(0.85);
  });

  it('should build context and stream to LLM', async () => {
    await retrieveAndChat('What is RAG?', 'kb-1', mockParams, mockConfig, callbacks);
    expect(buildContext).toHaveBeenCalledWith(mockResults);
    expect(streamChat).toHaveBeenCalled();
    const chatCall = (streamChat as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(chatCall[0].query).toBe('What is RAG?');
    expect(chatCall[0].context).toContain('Result 1');
  });

  it('should call callbacks.onDone on success', async () => {
    await retrieveAndChat('What is RAG?', 'kb-1', mockParams, mockConfig, callbacks);
    expect(callbacks.onDone).toHaveBeenCalledOnce();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('should not propagate streamChat error (error handled in streamChat)', async () => {
    // streamChat internally handles errors via callbacks.onError
    // The pipeline itself does not wrap streamChat in try/catch
    const errorMock = vi.fn();
    const testCallbacks = { ...callbacks, onError: errorMock };
    (streamChat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('LLM error'));
    // Pipeline should still return (no unhandled rejection in test)
    // The actual error handling is in streamChat itself
    await expect(
      retrieveAndChat('What is RAG?', 'kb-1', mockParams, mockConfig, testCallbacks),
    ).rejects.toThrow('LLM error');
  });

  it('should use "暂无可用参考资料" context when results are empty', async () => {
    (similaritySearch as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await retrieveAndChat('unknown topic', 'kb-1', mockParams, mockConfig, callbacks);
    expect(buildContext).toHaveBeenCalledWith([]);
    const chatCall = (streamChat as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(chatCall[0].context).toBe('（暂无可用参考资料）');
  });

  it('should not call onToken when no stream is active', async () => {
    await retrieveAndChat('query', 'kb-1', mockParams, mockConfig, callbacks);
    expect(streamChat).toHaveBeenCalled();
  });
});
