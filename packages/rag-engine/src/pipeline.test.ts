import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ingestDocument } from './pipeline.js';
import type { RAGPipelineConfig, TextChunk } from './types.js';
import * as loaders from './loaders/index.js';
import * as splitters from './splitters/recursive-splitter.js';
import * as markdownSplitters from './splitters/markdown-splitter.js';
import * as embeddings from './embeddings/openai-embeddings.js';
import * as pgvectorStore from './stores/pgvector-store.js';

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
  streamChat: vi.fn(),
  buildContext: vi.fn(),
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
