import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIEmbeddings } from '@langchain/openai';
import type { TextChunk } from '../types.js';
import { createMemoryStore, createMemoryStoreFromTexts } from './memory-store.js';

vi.mock('../embeddings/openai-embeddings.js', () => ({
  getEmbeddings: vi.fn(() => ({
    embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    embedDocuments: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  })),
}));

vi.mock('@langchain/classic/vectorstores/memory', () => ({
  MemoryVectorStore: {
    fromDocuments: vi.fn().mockResolvedValue({
      similaritySearchVectorWithScore: vi.fn().mockResolvedValue([]),
      addDocuments: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory';

describe('createMemoryStore', () => {
  it('should create an empty vector store', async () => {
    const store = await createMemoryStore({
      embedQuery: vi.fn(),
      embedDocuments: vi.fn(),
    } as any);
    expect(store).toBeDefined();
  });
});

describe('createMemoryStoreFromTexts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create store with documents from TextChunk[]', async () => {
    const chunks: TextChunk[] = [
      { content: 'First chunk', metadata: { kbId: 'kb1', source: 'a.txt' }, tokenCount: 3 },
      { content: 'Second chunk', metadata: { kbId: 'kb1', source: 'b.txt' }, tokenCount: 3 },
    ];

    const store = await createMemoryStoreFromTexts(
      { embedQuery: vi.fn(), embedDocuments: vi.fn() } as any,
      chunks,
    );

    expect(store).toBeDefined();
    const fromDocsMock = MemoryVectorStore.fromDocuments as ReturnType<typeof vi.fn>;
    expect(fromDocsMock).toHaveBeenCalled();
  });

  it('should preserve chunk metadata in store documents', async () => {
    const chunks: TextChunk[] = [
      { content: 'test', metadata: { kbId: 'test-kb', custom: 'value' }, tokenCount: 1 },
    ];

    await createMemoryStoreFromTexts(
      { embedQuery: vi.fn(), embedDocuments: vi.fn() } as any,
      chunks,
    );

    const fromDocsMock = MemoryVectorStore.fromDocuments as ReturnType<typeof vi.fn>;
    const calledWith = fromDocsMock.mock.calls[0][0];
    expect(calledWith).toHaveLength(1);
    expect(calledWith[0].metadata.kbId).toBe('test-kb');
    expect(calledWith[0].metadata.custom).toBe('value');
  });

  it('should handle empty chunks array', async () => {
    const store = await createMemoryStoreFromTexts(
      { embedQuery: vi.fn(), embedDocuments: vi.fn() } as any,
      [],
    );
    expect(store).toBeDefined();
  });
});
