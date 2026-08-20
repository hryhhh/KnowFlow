import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebSearchAgent } from '../index.js';
import type { SearchProvider, CacheProvider, SearchResult } from '../types.js';

function makeMockProvider(): SearchProvider {
  return {
    search: vi.fn().mockResolvedValue([
      { title: 'Result A', uri: 'https://a.com', snippet: 'Snippet A', source: 'web' },
      { title: 'Result B', uri: 'https://b.com', snippet: 'Snippet B', source: 'web' },
    ]),
  };
}

function makeMockCache(): CacheProvider {
  const store = new Map<string, { value: any; ttl: number }>();
  return {
    get: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.ttl) {
        store.delete(key);
        return null;
      }
      return entry.value;
    }),
    set: vi.fn(async (key: string, value: any, ttlSeconds: number) => {
      store.set(key, { value, ttl: Date.now() + ttlSeconds * 1000 });
    }),
  };
}

describe('WebSearchAgent', () => {
  let provider: SearchProvider;
  let cache: CacheProvider;

  beforeEach(() => {
    provider = makeMockProvider();
    cache = makeMockCache();
    vi.clearAllMocks();
  });

  it('returns search results', async () => {
    const agent = new WebSearchAgent(provider, cache);
    const result = await agent.execute({ query: 'RAG vs embedding', kbId: 'kb-1', traceId: 't1' });
    expect(result.status).toBe('ok');
    expect(result.content).toContain('Result A');
    expect(result.sources).toHaveLength(2);
  });

  it('deduplicates by URL', async () => {
    (provider.search as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { title: 'Same', uri: 'https://same.com', snippet: 'Snip', source: 'w' },
      { title: 'Same Again', uri: 'https://same.com', snippet: 'Snip2', source: 'w' },
    ]);
    const agent = new WebSearchAgent(provider, cache);
    const r = await agent.execute({ query: 'test', kbId: 'kb-1', traceId: 't1' });
    expect(r.status).toBe('ok');
    expect(r.sources).toHaveLength(1);
  });

  it('respects maxResults limit', async () => {
    (provider.search as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      Array.from({ length: 10 }, (_, i) => ({
        title: `R${i}`,
        uri: `https://r${i}.com`,
        snippet: 'Snip',
        source: 'w',
      })),
    );
    const agent = new WebSearchAgent(provider, cache, { maxResults: 3 });
    const r = await agent.execute({ query: 'test', kbId: 'kb-1', traceId: 't1' });
    expect(r.sources).toHaveLength(3);
  });

  it('returns error status on provider failure', async () => {
    (provider.search as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('API down'));
    const agent = new WebSearchAgent(provider, cache);
    const r = await agent.execute({ query: 'test', kbId: 'kb-1', traceId: 't1' });
    expect(r.status).toBe('error');
    expect(r.error?.message).toContain('API down');
  });

  it('times out when provider is slow', async () => {
    let resolveSearch: () => void;
    const slowPromise = new Promise<SearchResult[]>((resolve) => {
      resolveSearch = resolve;
    });
    (provider.search as ReturnType<typeof vi.fn>).mockReturnValue(slowPromise);

    const agent = new WebSearchAgent(provider, cache, { providerTimeoutMs: 50 });
    const r = await agent.execute({ query: 'test', kbId: 'kb-1', traceId: 't1' });
    expect(r.status).toBe('ok');
    expect(r.content).toBe('');
    resolveSearch!();
  });

  it('sanitizes sensitive data from snippets', async () => {
    (provider.search as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        title: 'Contact Info',
        uri: 'https://example.com',
        snippet: 'Call 13800138000 or email user@test.com',
        source: 'web',
      },
    ]);
    const agent = new WebSearchAgent(provider, cache);
    const r = await agent.execute({ query: 'test', kbId: 'kb-1', traceId: 't1' });
    expect(r.content).not.toContain('13800138000');
    expect(r.content).not.toContain('user@test.com');
    expect(r.content).toContain('[PHONE]');
    expect(r.content).toContain('[EMAIL]');
  });
});
