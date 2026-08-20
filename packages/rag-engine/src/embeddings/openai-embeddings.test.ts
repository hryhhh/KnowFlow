import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EmbeddingConfig } from '../types.js';

const baseConfig: EmbeddingConfig = {
  apiKey: 'sk-test-key-12345',
  model: 'text-embedding-3-small',
  baseURL: 'https://api.openai.com/v1',
  dimensions: 1536,
};

beforeEach(async () => {
  vi.resetModules();
});

// --- getEmbeddings ---
describe('getEmbeddings', () => {
  it('returns cached instance for the same config', async () => {
    const mockCtor = vi.fn();
    vi.doMock('@langchain/openai', () => ({
      OpenAIEmbeddings: mockCtor,
    }));

    const { getEmbeddings } = await import('./openai-embeddings.js');

    getEmbeddings(baseConfig);
    getEmbeddings(baseConfig);
    expect(mockCtor).toHaveBeenCalledTimes(1);
  });

  it('returns different instances for different configs', async () => {
    const mockCtor = vi.fn();
    vi.doMock('@langchain/openai', () => ({
      OpenAIEmbeddings: mockCtor,
    }));

    const { getEmbeddings } = await import('./openai-embeddings.js');

    getEmbeddings(baseConfig);
    const differentConfig = { ...baseConfig, apiKey: 'sk-different' };
    getEmbeddings(differentConfig);
    expect(mockCtor).toHaveBeenCalledTimes(2);
  });
});

// --- embedDocuments ---
describe('embedDocuments', () => {
  it('returns empty array for empty input', async () => {
    const mockEmbedDocuments = vi.fn().mockResolvedValue([]);
    const MockOpenAIEmbeddings = function OpenAIEmbeddings() {
      this.embedDocuments = mockEmbedDocuments;
    };
    vi.doMock('@langchain/openai', () => ({ OpenAIEmbeddings: MockOpenAIEmbeddings }));

    const { embedDocuments } = await import('./openai-embeddings.js');
    const result = await embedDocuments(baseConfig, []);
    expect(result).toEqual([]);
    expect(mockEmbedDocuments).not.toHaveBeenCalled();
  });

  it('batches documents with batch size 10', async () => {
    const mockEmbedDocuments = vi
      .fn()
      .mockResolvedValueOnce(Array.from({ length: 10 }, () => [0.1, 0.2]))
      .mockResolvedValueOnce(Array.from({ length: 10 }, () => [0.3, 0.4]))
      .mockResolvedValueOnce(Array.from({ length: 5 }, () => [0.5, 0.6]));
    const MockOpenAIEmbeddings = function OpenAIEmbeddings() {
      this.embedDocuments = mockEmbedDocuments;
    };
    vi.doMock('@langchain/openai', () => ({ OpenAIEmbeddings: MockOpenAIEmbeddings }));

    const { embedDocuments } = await import('./openai-embeddings.js');
    const docs = Array.from({ length: 25 }, (_, i) => `doc-${i}`);
    const result = await embedDocuments(baseConfig, docs);
    expect(mockEmbedDocuments).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(25);
  });

  it('preserves order of results', async () => {
    const mockEmbedDocuments = vi.fn().mockResolvedValue([
      [1, 0],
      [0, 1],
      [-1, 0],
    ]);
    const MockOpenAIEmbeddings = function OpenAIEmbeddings() {
      this.embedDocuments = mockEmbedDocuments;
    };
    vi.doMock('@langchain/openai', () => ({ OpenAIEmbeddings: MockOpenAIEmbeddings }));

    const { embedDocuments } = await import('./openai-embeddings.js');
    const result = await embedDocuments(baseConfig, ['a', 'b', 'c']);
    expect(result[0]).toEqual([1, 0]);
    expect(result[1]).toEqual([0, 1]);
    expect(result[2]).toEqual([-1, 0]);
  });
});

// --- embedQuery ---
describe('embedQuery', () => {
  it('returns a single vector for the query', async () => {
    const mockEmbedQuery = vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4]);
    const MockOpenAIEmbeddings = function OpenAIEmbeddings() {
      this.embedQuery = mockEmbedQuery;
    };
    vi.doMock('@langchain/openai', () => ({ OpenAIEmbeddings: MockOpenAIEmbeddings }));

    const { embedQuery } = await import('./openai-embeddings.js');
    const result = await embedQuery(baseConfig, 'what is this?');
    expect(result).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(mockEmbedQuery).toHaveBeenCalledWith('what is this?');
  });
});
