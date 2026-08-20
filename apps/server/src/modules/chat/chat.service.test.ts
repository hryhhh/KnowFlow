import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatService } from './chat.service.js';
import { Observable } from 'rxjs';
import type { MessageEvent } from 'http';

vi.mock('@knowbase-x/rag-engine', () => ({
  retrieveAndChat: vi.fn().mockResolvedValue(Promise.resolve()),
}));

import { retrieveAndChat } from '@knowbase-x/rag-engine';

function makeMockSessionService() {
  return {
    create: vi.fn().mockResolvedValue({ id: 'session-1', kbId: 'kb-1', title: 'test' }),
    addMessage: vi.fn().mockResolvedValue({ id: 'msg-1', sessionId: 'session-1', role: 'user', content: 'test' }),
  };
}

function makeMockUsageLog() {
  return {
    record: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockAgentChatService() {
  return {
    stream: vi.fn().mockResolvedValue(undefined),
  };
}

function collectEvents(obs$: Observable<MessageEvent>): Promise<MessageEvent[]> {
  return new Promise((resolve) => {
    const events: MessageEvent[] = [];
    obs$.subscribe({
      next: (e) => events.push(e),
      complete: () => resolve(events),
      error: (e) => resolve(events),
    });
  });
}

describe('ChatService', () => {
  let sessionService: ReturnType<typeof makeMockSessionService>;
  let usageLog: ReturnType<typeof makeMockUsageLog>;
  let agentChatService: ReturnType<typeof makeMockAgentChatService>;
  let service: ChatService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AGENTS_ENABLED', '');
    vi.stubEnv('DEFAULT_MIN_SCORE', '');
    sessionService = makeMockSessionService();
    usageLog = makeMockUsageLog();
    agentChatService = makeMockAgentChatService();

    service = Object.create(ChatService.prototype);
    service.ragConfig = {
      pg: { host: 'localhost', port: 5432, user: 'test', password: 'test', database: 'test' },
      llm: { apiKey: 'test', model: 'gpt-4', baseURL: 'https://api.test.com' },
      embedding: { apiKey: 'test', model: 'text-embedding-3-small', baseURL: 'https://api.test.com', dimensions: 3 },
      chunkSize: 1000,
      chunkOverlap: 200,
    };
    service.usageLog = usageLog;
    service.sessionService = sessionService;
    service.agentChat = agentChatService;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('calls retrieveAndChat when AGENTS_ENABLED is not true', async () => {
    vi.stubEnv('AGENTS_ENABLED', 'false');
    vi.mocked(retrieveAndChat).mockImplementation((_query, _kbId, _params, _config, callbacks) => {
      callbacks.onToken('Hello ');
      callbacks.onToken('world');
      callbacks.onDone();
      return Promise.resolve();
    });

    const obs$ = service.stream({ query: 'test', kbId: 'kb-1' });
    const events = await collectEvents(obs$);

    expect(retrieveAndChat).toHaveBeenCalledOnce();
    const tokenEvents = events.filter((e) => {
      const d = JSON.parse(e.data as string);
      return d.type === 'token';
    });
    expect(tokenEvents.length).toBe(2);

    const doneEvents = events.filter((e) => {
      const d = JSON.parse(e.data as string);
      return d.type === 'done';
    });
    expect(doneEvents.length).toBe(1);
  });

  it('calls agentChat.stream when AGENTS_ENABLED is true', async () => {
    vi.stubEnv('AGENTS_ENABLED', 'true');
    vi.mocked(agentChatService.stream).mockImplementation((_query, _kbId, _params, callbacks) => {
      callbacks.onToken('Hello ');
      callbacks.onToken('world');
      callbacks.onDone();
      return Promise.resolve();
    });

    const obs$ = service.stream({ query: 'test', kbId: 'kb-1' });
    const events = await collectEvents(obs$);

    expect(agentChatService.stream).toHaveBeenCalledOnce();
    expect(retrieveAndChat).not.toHaveBeenCalled();
  });

  it('creates a new session when sessionId is not provided', async () => {
    vi.stubEnv('AGENTS_ENABLED', 'false');
    vi.mocked(retrieveAndChat).mockImplementation((_query, _kbId, _params, _config, callbacks) => {
      callbacks.onToken('Hi');
      callbacks.onDone();
      return Promise.resolve();
    });

    const obs$ = service.stream({ query: 'test', kbId: 'kb-1' });
    await collectEvents(obs$);

    expect(sessionService.create).toHaveBeenCalledWith('kb-1', 'test');
    expect(sessionService.addMessage).toHaveBeenCalledWith('session-1', 'assistant', expect.stringContaining('Hi'));
  });

  it('reuses existing sessionId when provided', async () => {
    vi.stubEnv('AGENTS_ENABLED', 'false');
    vi.mocked(retrieveAndChat).mockImplementation((_query, _kbId, _params, _config, callbacks) => {
      callbacks.onToken('Hi');
      callbacks.onDone();
      return Promise.resolve();
    });

    const obs$ = service.stream({ query: 'test', kbId: 'kb-1', sessionId: 'existing-1' });
    await collectEvents(obs$);

    expect(sessionService.create).not.toHaveBeenCalled();
    expect(sessionService.addMessage).toHaveBeenCalledWith('existing-1', 'assistant', expect.stringContaining('Hi'));
  });

  it('emits error event and records status error when retrieveAndChat errors', async () => {
    vi.stubEnv('AGENTS_ENABLED', 'false');
    vi.mocked(retrieveAndChat).mockImplementation((_query, _kbId, _params, _config, callbacks) => {
      callbacks.onError(new Error('network error'));
      return Promise.reject(new Error('network error'));
    });

    const obs$ = service.stream({ query: 'test', kbId: 'kb-1' });
    const events = await collectEvents(obs$);

    const errorEvents = events.filter((e) => {
      const d = JSON.parse(e.data as string);
      return d.type === 'error';
    });
    expect(errorEvents.length).toBe(1);
    expect(JSON.parse(errorEvents[0].data as string).value).toBe('network error');
    expect(usageLog.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });

  it('normalizes params with defaults when body.params is undefined', async () => {
    vi.stubEnv('AGENTS_ENABLED', 'false');
    vi.mocked(retrieveAndChat).mockImplementation((_query, _kbId, params, _config, _callbacks) => {
      expect(params.topK).toBe(10);
      expect(params.minScore).toBe(0.1);
      expect(params.useReranker).toBe(false);
      expect(params.denseWeight).toBe(0.5);
      _callbacks.onToken('x');
      _callbacks.onDone();
      return Promise.resolve();
    });

    const obs$ = service.stream({ query: 'test', kbId: 'kb-1' });
    await collectEvents(obs$);
  });
});
