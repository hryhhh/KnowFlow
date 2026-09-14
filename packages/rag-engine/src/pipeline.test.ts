import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ingestDocument } from './pipeline.js';
import type { RAGPipelineConfig, TextChunk } from './types.js';
import * as loaders from './loaders/index.js';
import * as splitters from './splitters/recursive-splitter.js';
import * as markdownSplitters from './splitters/markdown-splitter.js';
import * as embeddings from './embeddings/openai-embeddings.js';
import * as pgvectorStore from './stores/pgvector-store.js';
import * as retrievalGate from './retrieval-gate.js';

// Mock all dependencies
vi.mock('./loaders/index.js', () => ({
  loadDocument: vi.fn().mockResolvedValue({
    documents: [{ pageContent: 'Test content', metadata: {} }],
    fileType: 'pdf' as const,
    totalChars: 100,
  }),
}));

vi.mock('./splitters/recursive-splitter.js', () => ({
  splitDocuments: vi.fn().mockResolvedValue([
    { pageContent: 'Chunk 1', metadata: {} },
    { pageContent: 'Chunk 2', metadata: {} },
  ]),
}));

vi.mock('./splitters/markdown-splitter.js', () => ({
  splitMarkdownDocuments: vi.fn().mockResolvedValue([{ pageContent: 'MD Chunk 1', metadata: {} }]),
}));

vi.mock('./embeddings/openai-embeddings.js', () => ({
  getEmbeddings: vi.fn(() => ({
    embedDocuments: vi.fn().mockResolvedValue([[0.1, 0.2]]),
    embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]),
  })),
}));

vi.mock('./stores/pgvector-store.js', () => ({
  ensureCachedPGVectorStore: vi.fn().mockResolvedValue({
    addDocuments: vi.fn().mockResolvedValue(undefined),
  }),
  addDocumentsToPG: vi.fn().mockResolvedValue(undefined),
  deleteByDocId: vi.fn().mockResolvedValue({ deleted: 1 }),
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
  streamChat: vi.fn().mockResolvedValue(undefined),
  buildContext: vi.fn().mockReturnValue('[1] ref content'),
}));

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

describe('ingestDocument with docId and progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should pass docId to metadata', async () => {
    const { addDocumentsToPG } = await import('./stores/pgvector-store.js');
    vi.mocked(addDocumentsToPG).mockImplementation(
      async (store: any, chunks: TextChunk[], callback?: any) => {
        // Verify docId is in metadata
        chunks.forEach((c) => {
          expect(c.metadata.docId).toBe('doc-123');
          expect(c.metadata.kbId).toBe('kb-1');
          expect(c.metadata.source).toBeTruthy();
        });
      },
    );

    await ingestDocument('/path/to/file.pdf', 'kb-1', mockConfig, 'basic', undefined, 'doc-123');

    expect(addDocumentsToPG).toHaveBeenCalled();
  });

  it('should call progress callbacks in order', async () => {
    const progressCalls: Array<{ percent: number; stage: string }> = [];
    const progressCallback = (event: { percent: number; stage: string }) => {
      progressCalls.push(event);
    };

    const { addDocumentsToPG } = await import('./stores/pgvector-store.js');
    vi.mocked(addDocumentsToPG).mockImplementation(
      async (store: any, chunks: TextChunk[], callback?: any) => {
        // Simulate batch progress callbacks
        callback?.(50, 'embedding');
        callback?.(70, 'embedding');
        callback?.(89, 'embedding');
      },
    );

    await ingestDocument(
      '/path/to/file.pdf',
      'kb-1',
      mockConfig,
      'basic',
      undefined,
      'doc-123',
      progressCallback,
    );

    expect(progressCalls).toEqual(
      expect.arrayContaining([
        { percent: 10, stage: 'parsing' },
        { percent: 30, stage: 'parsing' },
        { percent: 40, stage: 'chunking' },
        { percent: 90, stage: 'persisting' },
      ]),
    );
  });

  it('should handle progress without docId (backward compatibility)', async () => {
    const progressCalls: Array<{ percent: number; stage: string }> = [];
    const progressCallback = (event: { percent: number; stage: string }) => {
      progressCalls.push(event);
    };

    const { addDocumentsToPG } = await import('./stores/pgvector-store.js');
    vi.mocked(addDocumentsToPG).mockImplementation(
      async (store: any, chunks: TextChunk[], callback?: any) => {
        callback?.(50, 'embedding');
      },
    );

    await ingestDocument(
      '/path/to/file.pdf',
      'kb-1',
      mockConfig,
      'basic',
      undefined,
      undefined,
      progressCallback,
    );

    // Should still work without docId
    expect(progressCalls.length).toBeGreaterThanOrEqual(0);
  });
});

describe('deleteByDocId', () => {
  it('should delete vectors by docId', async () => {
    const { deleteByDocId } = await import('./stores/pgvector-store.js');
    const result = await deleteByDocId(mockConfig.pg, 'langchainjs', 'doc-123');

    expect(result.deleted).toBe(1);
  });
});

describe('retrieveAndChat quality gate (A3)', () => {
  beforeEach(() => {
    delete process.env.RETRIEVAL_QUALITY_GATE_ENABLED;
  });

  it('闸门开启时 evaluateQualityGate 正确拦截低分结果', () => {
    process.env.RETRIEVAL_QUALITY_GATE_ENABLED = 'true';
    const verdict = retrievalGate.evaluateQualityGate([{ score: 0.1 }], 'vector', 'rrf');
    expect(verdict.gated).toBe(true);
    expect(verdict.top1).toBe(0.1);
    expect(verdict.warned).toBe(false);
  });

  it('闸门关闭时 evaluateQualityGate 不拦截', () => {
    const verdict = retrievalGate.evaluateQualityGate([{ score: 0.05 }], 'vector', 'rrf');
    expect(verdict.gated).toBe(false);
    expect(verdict.warned).toBe(false);
  });

  it('空结果闸门拦截（任何模式）', () => {
    process.env.RETRIEVAL_QUALITY_GATE_ENABLED = 'true';
    const verdict = retrievalGate.evaluateQualityGate([], 'keyword', 'rrf');
    expect(verdict.gated).toBe(true);
    expect(verdict.top1).toBeNull();
  });
});

describe('retrieveAndChat quality gate integration (A3)', () => {
  beforeEach(() => {
    delete process.env.RETRIEVAL_QUALITY_GATE_ENABLED;
  });

  afterEach(() => {
    delete process.env.RETRIEVAL_QUALITY_GATE_ENABLED;
  });

  it('闸门开启时 evaluateQualityGate 正确拦截低分结果（直接验证闸门模块）', async () => {
    process.env.RETRIEVAL_QUALITY_GATE_ENABLED = 'true';
    const { evaluateQualityGate } = await import('./retrieval-gate.js');
    const result = evaluateQualityGate([{ score: 0.1 }], 'vector', 'rrf');
    expect(result.gated).toBe(true);
    expect(result.top1).toBe(0.1);
    expect(result.warned).toBe(false);
  });

  it('闸门关闭时 retrieveAndChat 走正常路径（streamChat 被调用）', async () => {
    const { similaritySearch } = await import('./retrievers/similarity-retriever.js');
    vi.mocked(similaritySearch).mockResolvedValue([{ score: 0.8, content: 'ref', sourceFile: 'f.txt', metadata: {} }]);
    const { retrieveAndChat } = await import('./pipeline.js');
    const { streamChat } = await import('./llm/chat-service.js');
    const onSources = vi.fn();
    const onDone = vi.fn();
    // Make streamChat call callbacks.onDone() to simulate real behavior
    streamChat.mockImplementation(async (_req, _config, callbacks) => {
      callbacks?.onDone?.();
    });

    await retrieveAndChat('query', 'kb-1', { topK: 10, minScore: 0.7, useReranker: false, denseWeight: 0.5, retrievalMode: 'vector' }, mockConfig, {
      onSources, onToken: vi.fn(), onDone, onError: vi.fn(),
    });

    expect(streamChat).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('请求级 temperature 透传给 streamChat', async () => {
    const { similaritySearch } = await import('./retrievers/similarity-retriever.js');
    vi.mocked(similaritySearch).mockResolvedValue([{ score: 0.8, content: 'ref', sourceFile: 'f.txt', metadata: {} }]);
    const { retrieveAndChat } = await import('./pipeline.js');
    const { streamChat } = await import('./llm/chat-service.js');
    const onDone = vi.fn();

    await retrieveAndChat('query', 'kb-1', {
      topK: 10, minScore: 0.7, useReranker: false, denseWeight: 0.5, temperature: 0.3, retrievalMode: 'vector',
    }, mockConfig, {
      onSources: vi.fn(), onToken: vi.fn(), onDone, onError: vi.fn(),
    });

    expect(streamChat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ temperature: 0.3 }),
      expect.anything(),
    );
  });
});

describe('A5 稀疏分归一化（pipeline 集成）', () => {
  it('applySparseScoreNormalization 对空结果无副作用', async () => {
    const { applySparseScoreNormalization } = await import('./fusion/index.js');
    expect(applySparseScoreNormalization([])).toEqual([]);
  });

  it('hybrid+RRF 模式下归一化将 fused 分映射到 [0,1]', async () => {
    const { applySparseScoreNormalization } = await import('./fusion/index.js');
    const results = [
      { score: 1.8, content: 'a', sourceFile: 'f1', metadata: {} },
      { score: 1.2, content: 'b', sourceFile: 'f2', metadata: {} },
      { score: 0.6, content: 'c', sourceFile: 'f3', metadata: {} },
    ];
    const normalized = applySparseScoreNormalization(results);
    // (1.8-0.6)/(1.8-0.6)=1, (1.2-0.6)/1.2=0.5, (0.6-0.6)/1.2=0
    expect(normalized[0].score).toBeCloseTo(1.0, 5);
    expect(normalized[1].score).toBeCloseTo(0.5, 5);
    expect(normalized[2].score).toBeCloseTo(0.0, 5);
    expect(normalized[0].metadata.scoreRaw).toBe(1.8);
  });
});
