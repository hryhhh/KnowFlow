import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentChatService } from './agent-chat.service.js';

vi.mock('@knowbase-x/rag-engine', () => ({
  retrieveAndChat: vi.fn().mockResolvedValue(Promise.resolve()),
}));

const mockOrchestrator = {
  orchestrate: vi.fn(),
};

vi.mock('@knowbase-x/agents', () => {
  const intentRouterMock = { reload: vi.fn() };
  const orchestratorMock = {
    orchestrate: vi.fn(),
    get matchedRules() {
      return [];
    },
    get sources() {
      return [];
    },
    get content() {
      return '';
    },
    get agentResults() {
      return [];
    },
    get metadata() {
      return {};
    },
  };
  return {
    IntentRouter: vi.fn().mockReturnValue(intentRouterMock),
    Orchestrator: vi.fn().mockReturnValue(orchestratorMock),
    DbQueryAgent: vi.fn().mockImplementation(() => ({
      id: 'db-query',
      registerTemplate: vi.fn(),
      setExecuteFn: vi.fn(),
    })),
    WebSearchAgent: vi.fn().mockImplementation(() => ({ id: 'web-search' })),
    RagFlowAgent: vi.fn().mockImplementation(() => ({ id: 'ragflow', setStreamingFn: vi.fn() })),
    StreamAgentProxy: vi.fn().mockImplementation((a: any) => a),
  };
});

vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue(`
templates:
  - id: sample_query
    name: Sample Query
    queryTemplate: SELECT * FROM users WHERE id = $1
  `),
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('js-yaml', () => ({
  load: vi.fn().mockReturnValue({
    templates: [
      {
        id: 'sample_query',
        name: 'Sample Query',
        queryTemplate: 'SELECT * FROM users WHERE id = $1',
      },
    ],
  }),
}));

import { retrieveAndChat } from '@knowbase-x/rag-engine';

function makeMockUsageLog() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makeMockDbQueryService() {
  return {
    execute: vi.fn().mockResolvedValue([{ id: 1, name: 'Alice' }]),
  };
}

function buildService(agentsEnabled: boolean = false): AgentChatService {
  const usageLog = makeMockUsageLog();
  const dbQueryService = makeMockDbQueryService();
  const ragConfig = {
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

  const service = Object.create(AgentChatService.prototype);
  service.logger = { debug: vi.fn(), log: vi.fn(), error: vi.fn() };
  service.agentsEnabled = agentsEnabled;
  service.ragConfig = ragConfig;
  service.usageLog = usageLog;
  service.dbQueryService = dbQueryService;
  service.router = { reload: vi.fn() } as any;
  service.orchestrator = agentsEnabled ? mockOrchestrator : null;
  return { service, usageLog, dbQueryService } as any;
}

describe('AgentChatService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AGENT_COMPOSE_STRATEGY', 'rag-priority');
    vi.stubEnv('AGENT_ROUTER_ALLOW_PARALLEL', '');
    vi.stubEnv('AGENT_ROUTER_CONFIDENCE_THRESHOLD', '70');
    vi.stubEnv('AGENT_ALWAYS_INCLUDE_AGENTS', 'ragflow');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns agentsEnabled=false when disabled in orchestrate()', async () => {
    const { service } = buildService(false);
    const result = await service.orchestrate('query', 'kb-1', undefined);
    expect(result).toEqual({ agentsEnabled: false, message: 'Agent 编排未启用' });
  });

  it('falls back to retrieveAndChat when orchestrator is missing in stream', async () => {
    vi.mocked(retrieveAndChat).mockImplementation((_q, _kb, _p, _c, callbacks) => {
      callbacks.onToken('fallback');
      callbacks.onDone();
    });
    const { service } = buildService(false);
    const callbacks = {
      onSources: vi.fn(),
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onMeta: vi.fn(),
    };

    await service.stream('query', 'kb-1', undefined, callbacks as any, 'trace-1', 'key-1');
    expect(retrieveAndChat).toHaveBeenCalledOnce();
    expect(callbacks.onToken).toHaveBeenCalledWith('fallback');
    expect(callbacks.onDone).toHaveBeenCalledOnce();
  });

  it('orchestrates and emits tokens from orchestrator result', async () => {
    mockOrchestrator.orchestrate.mockResolvedValue({
      matchedRules: [],
      sources: [],
      content: 'Agent response',
      agentResults: [{ agent: 'ragflow', status: 'success', elapsedMs: 100 }],
      metadata: {
        triggeredLlmArbitration: false,
        ragIncludedBy: 'none',
        composeUsedRagPriority: false,
      },
    });
    const { service } = buildService(true);
    const callbacks = {
      onSources: vi.fn(),
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onMeta: vi.fn(),
    };

    await service.stream('query', 'kb-1', undefined, callbacks as any, 'trace-1', 'key-1');

    expect(mockOrchestrator.orchestrate).toHaveBeenCalledOnce();
    expect(callbacks.onToken).toHaveBeenCalled();
    expect(callbacks.onDone).toHaveBeenCalledOnce();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('falls back to retrieveAndChat when orchestration returns empty content', async () => {
    vi.mocked(retrieveAndChat).mockImplementation((_q, _kb, _p, _c, callbacks) => {
      callbacks.onToken('rag-fallback');
      callbacks.onDone();
    });
    mockOrchestrator.orchestrate.mockResolvedValue({
      matchedRules: [],
      sources: [],
      content: '',
      agentResults: [],
      metadata: {},
    });
    const { service } = buildService(true);
    const callbacks = {
      onSources: vi.fn(),
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onMeta: vi.fn(),
    };

    await service.stream('query', 'kb-1', undefined, callbacks as any, 'trace-1', 'key-1');
    expect(retrieveAndChat).toHaveBeenCalledOnce();
    expect(callbacks.onToken).toHaveBeenCalledWith('rag-fallback');
  });

  it('handles orchestration errors gracefully', async () => {
    mockOrchestrator.orchestrate.mockRejectedValue(new Error('orchestration failed'));
    const { service, usageLog } = buildService(true);
    const callbacks = {
      onSources: vi.fn(),
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onMeta: vi.fn(),
    };

    await service.stream('query', 'kb-1', undefined, callbacks as any, 'trace-1', 'key-1');
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'orchestration failed' }),
    );
    expect(usageLog.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
  });

  it('orchestrate() returns elapsedMs on success', async () => {
    mockOrchestrator.orchestrate.mockResolvedValue({
      matchedRules: [],
      sources: [],
      content: 'result',
      agentResults: [],
      metadata: {},
    });
    const { service } = buildService(true);
    const result = await service.orchestrate('query', 'kb-1', undefined);
    expect(result).toHaveProperty('elapsedMs');
    expect(typeof result.elapsedMs).toBe('number');
  });

  it('orchestrate() returns error on failure', async () => {
    mockOrchestrator.orchestrate.mockRejectedValue(new Error('boom'));
    const { service } = buildService(true);
    const result = await service.orchestrate('query', 'kb-1', undefined);
    expect(result).toHaveProperty('error');
    expect(result.error).toBe('boom');
    expect(result).toHaveProperty('elapsedMs');
  });

  it('reloadRules calls router.reload when router exists', () => {
    const { service } = buildService(false);
    service.reloadRules();
    expect(service.router!.reload).toHaveBeenCalledOnce();
  });

  it('reloadRules is a no-op when router does not exist', () => {
    const { service } = buildService(false);
    service.router = undefined;
    expect(() => service.reloadRules()).not.toThrow();
  });

  it('normalizeParams returns defaults for undefined input', () => {
    const { service } = buildService(false);
    const normalized = service.normalizeParams(undefined as any);
    expect(normalized.topK).toBe(10);
    expect(normalized.minScore).toBe(0.7);
    expect(normalized.useReranker).toBe(false);
    expect(normalized.denseWeight).toBe(0.5);
  });
});
