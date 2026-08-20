import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';
import type { TextChunk } from '../types.js';
import {
  createPGVectorStore,
  ensureCachedPGVectorStore,
  addDocumentsToPG,
  searchSimilarityWithScore,
} from './pgvector-store.js';

// Mock dependencies — use a named function so `new` works as a constructor
vi.mock('@langchain/openai', () => {
  const MockOpenAIEmbeddings = vi.fn();
  MockOpenAIEmbeddings.mockImplementation(function (this: any) {
    return { embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]) };
  });
  return { OpenAIEmbeddings: MockOpenAIEmbeddings };
});

vi.mock('@langchain/community/vectorstores/pgvector', () => ({
  PGVectorStore: {
    initialize: vi.fn().mockResolvedValue({
      addDocuments: vi.fn().mockResolvedValue(undefined),
      similaritySearchVectorWithScore: vi.fn().mockResolvedValue([]),
    }),
  },
}));

import { OpenAIEmbeddings } from '@langchain/openai';

const mockEmbeddings = new OpenAIEmbeddings({ apiKey: 'test' });
const mockDbConfig = {
  host: 'localhost',
  port: 5432,
  user: 'test',
  password: 'test',
  database: 'testdb',
};

const mockChunks: TextChunk[] = [
  { content: 'Chunk one', metadata: { kbId: 'kb1', source: 'file1.txt' }, tokenCount: 3 },
  { content: 'Chunk two', metadata: { kbId: 'kb1', source: 'file2.txt' }, tokenCount: 3 },
  { content: 'Chunk three', metadata: { kbId: 'kb1' }, tokenCount: 3 },
];

describe('createPGVectorStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a PGVectorStore with merged config', async () => {
    const store = await createPGVectorStore(mockEmbeddings, mockDbConfig);
    expect(PGVectorStore.initialize).toHaveBeenCalledWith(
      mockEmbeddings,
      expect.objectContaining({
        tableName: 'langchainjs',
        postgresConnectionOptions: expect.objectContaining({
          host: 'localhost',
          database: 'testdb',
        }),
      }),
    );
    expect(store).toBeDefined();
  });

  it('should respect custom tableConfig', async () => {
    await createPGVectorStore(mockEmbeddings, mockDbConfig, {
      tableName: 'my_table',
      vectorColumnName: 'embedding',
    });
    const config = (PGVectorStore.initialize as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(config.tableName).toBe('my_table');
    expect(config.columns.vectorColumnName).toBe('embedding');
    expect(config.columns.contentColumnName).toBe('content');
    expect(config.distanceStrategy).toBe('cosine');
  });
});

describe('ensureCachedPGVectorStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should cache by host:database:tableName key', async () => {
    const store1 = await ensureCachedPGVectorStore(mockEmbeddings, mockDbConfig);
    const store2 = await ensureCachedPGVectorStore(mockEmbeddings, mockDbConfig);
    expect(store1).toBe(store2);
    expect(PGVectorStore.initialize).toHaveBeenCalledTimes(1);
  });

  it('distinguishes cache by different host', async () => {
    // Use a unique config so no cache collision
    const uniqueConfigA = { ...mockDbConfig, host: 'host-a-' + Date.now() };
    const uniqueConfigB = { ...mockDbConfig, host: 'host-b-' + Date.now() };
    await ensureCachedPGVectorStore(mockEmbeddings, uniqueConfigA);
    await ensureCachedPGVectorStore(mockEmbeddings, uniqueConfigB);
    expect(PGVectorStore.initialize).toHaveBeenCalledTimes(2);
  });

  it('distinguishes cache by different database', async () => {
    const uniqueConfigA = { ...mockDbConfig, database: 'db-a-' + Date.now() };
    const uniqueConfigB = { ...mockDbConfig, database: 'db-b-' + Date.now() };
    await ensureCachedPGVectorStore(mockEmbeddings, uniqueConfigA);
    await ensureCachedPGVectorStore(mockEmbeddings, uniqueConfigB);
    expect(PGVectorStore.initialize).toHaveBeenCalledTimes(2);
  });

  it('includes tableName in cache key', async () => {
    const uniqueConfig = { ...mockDbConfig, database: 'db-cache-' + Date.now() };
    await ensureCachedPGVectorStore(mockEmbeddings, uniqueConfig, { tableName: 'table_a' });
    await ensureCachedPGVectorStore(mockEmbeddings, uniqueConfig, { tableName: 'table_b' });
    expect(PGVectorStore.initialize).toHaveBeenCalledTimes(2);
  });

  it('uses default tableName when tableConfig is omitted', async () => {
    // Use a unique config to avoid cache collision
    const uniqueConfig = { ...mockDbConfig, database: 'db-default-' + Date.now() };
    await ensureCachedPGVectorStore(mockEmbeddings, uniqueConfig);
    const config = (PGVectorStore.initialize as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(config.tableName).toBe('langchainjs');
  });
});

describe('addDocumentsToPG', () => {
  const mockStore = {
    addDocuments: vi.fn().mockResolvedValue(undefined),
    similaritySearchVectorWithScore: vi.fn().mockResolvedValue([]),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should write chunks to vector store in batches', async () => {
    const chunks = Array.from({ length: 12 }, (_, i) => ({
      content: `Content ${i}`,
      metadata: { kbId: 'kb1', source: 'file.txt' },
      tokenCount: 2,
    }));
    await addDocumentsToPG(mockStore as never, chunks as never);
    expect(mockStore.addDocuments).toHaveBeenCalledTimes(2);
  });

  it('preserves metadata including kbId', async () => {
    const chunks = [mockChunks[0]];
    await addDocumentsToPG(mockStore as never, chunks as never);
    const batch = mockStore.addDocuments.mock.calls[0][0];
    expect(batch[0].pageContent).toBe('Chunk one');
    expect(batch[0].metadata).toEqual({ kbId: 'kb1', source: 'file1.txt' });
  });

  it('defaults metadata to empty object when missing', async () => {
    const noMetaChunks: TextChunk[] = [
      { content: 'No metadata chunk', metadata: {}, tokenCount: 3 },
    ];
    await addDocumentsToPG(mockStore as never, noMetaChunks as never);
    const batch = mockStore.addDocuments.mock.calls[0][0];
    expect(batch[0].metadata).toEqual({});
  });

  it('should handle exactly one batch for small document sets', async () => {
    const chunks = Array.from({ length: 5 }, (_, i) => ({
      content: `Content ${i}`,
      metadata: { kbId: 'kb1' },
      tokenCount: 1,
    }));
    await addDocumentsToPG(mockStore as never, chunks as never);
    expect(mockStore.addDocuments).toHaveBeenCalledTimes(1);
  });
});

describe('searchSimilarityWithScore', () => {
  const mockStore = {
    similaritySearchVectorWithScore: vi.fn().mockResolvedValue([]),
  };

  it('should delegate to vector store similaritySearchVectorWithScore', async () => {
    mockStore.similaritySearchVectorWithScore.mockResolvedValue([['doc1' as never, 0.9]]);
    const results = await searchSimilarityWithScore(mockStore as never, [0.1, 0.2, 0.3], 5);
    expect(mockStore.similaritySearchVectorWithScore).toHaveBeenCalledWith([0.1, 0.2, 0.3], 5);
    expect(results).toEqual([['doc1' as never, 0.9]]);
  });
});
