import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentChatService } from './agent-chat.service.js';
import { AgentRuntime } from '@knowbase-x/agents';
import { normalizeSearchParams } from '../../common/search-params';

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
    // AgentRuntime 路径相关（具体 mock 在用例内通过 vi.mocked(AgentRuntime) 注入）
    AgentRuntime: vi.fn(),
    // 用 function 而非箭头函数：service 内部以 new 调用，箭头实现会抛 not a constructor
    ConversationMemory: vi.fn().mockImplementation(function (loader: any) {
      return { load: (loader as any).load.bind(loader) };
    }),
    ToolRegistry: vi.fn().mockImplementation(() => ({
      register: vi.fn(),
      get: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      getAllDefinitions: vi.fn().mockReturnValue([]),
    })),
    RagSearchTool: vi.fn().mockImplementation(() => ({ name: 'rag_search' })),
    DbQueryTool: vi.fn().mockImplementation(() => ({ name: 'query_database' })),
    WebSearchTool: vi.fn().mockImplementation(() => ({ name: 'web_search' })),
    ReadFileTool: vi.fn().mockImplementation(() => ({ name: 'read_file' })),
    CallHttpApiTool: vi.fn().mockImplementation(() => ({ name: 'call_http_api' })),
    LegacyAgentAdapter: vi.fn().mockImplementation((agent: any, name: string) => ({ name })),
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
  service.logger = { debug: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() };
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
    const normalized = normalizeSearchParams(undefined as any);
    expect(normalized.topK).toBe(10);
    expect(normalized.minScore).toBe(0.7);
    expect(normalized.useReranker).toBe(false);
    expect(normalized.denseWeight).toBe(0.5);
  });

  // ---- AgentRuntime 路径 ----

  function buildRuntimeService() {
    const built = buildService(true);
    const service = built.service;
    service.runtimeEnabled = true;
    service.toolRegistry = { get: () => undefined, list: () => [] } as any;
    service.traceService = { save: vi.fn().mockResolvedValue(undefined) } as any;
    service.sessionService = { load: vi.fn().mockResolvedValue([]) } as any;
    return { ...built, traceService: service.traceService, sessionService: service.sessionService };
  }

  function makeRuntimeResult(overrides: any = {}) {
    return {
      status: 'completed',
      finalAnswer: 'ok',
      context: {
        runId: 'run-1',
        trace: {
          tokensUsed: { prompt: 1, completion: 1, total: 2 },
          recordMemoryLoad: vi.fn(),
          finalize: vi.fn().mockReturnValue({ id: 'run-1' }),
        },
      },
      ...overrides,
    };
  }

  it('AgentRuntime 路径：记忆末条与当前问题重复时剔除，agent_completed 携带 runId', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-key');
    vi.stubEnv('AGENT_TRACE_ENABLED', 'true');
    const runtimeRun = vi.fn().mockResolvedValue(makeRuntimeResult());
    vi.mocked(AgentRuntime).mockImplementation(function () {
      return { run: runtimeRun } as any;
    });

    const { service, sessionService, traceService } = buildRuntimeService();
    sessionService.load.mockResolvedValue([
      { role: 'user', content: '历史问题' },
      { role: 'assistant', content: '历史回答' },
      { role: 'user', content: '当前问题' }, // 调用前已入库，属于重复注入
    ]);
    const callbacks = {
      onSources: vi.fn(),
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onMeta: vi.fn(),
    };

    await service.stream(
      '当前问题',
      'kb-1',
      undefined,
      callbacks as any,
      'trace-1',
      'key-1',
      'session-1',
    );

    expect(runtimeRun).toHaveBeenCalledOnce();
    const params = runtimeRun.mock.calls[0][0];
    expect(params.messages).toEqual([
      { role: 'user', content: '历史问题' },
      { role: 'assistant', content: '历史回答' },
    ]);
    expect(callbacks.onMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agent_completed',
        data: expect.objectContaining({ runId: 'run-1', status: 'completed' }),
      }),
    );
    expect(traceService.save).toHaveBeenCalledOnce();
  });

  it('AgentRuntime 失败时降级到 Orchestrator 路由链路，用户仍收到回答', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-key');
    vi.stubEnv('AGENT_TRACE_ENABLED', 'true');
    const runtimeRun = vi
      .fn()
      .mockResolvedValue(
        makeRuntimeResult({ status: 'failed', finalAnswer: '', error: 'LLM API error 404: ' }),
      );
    vi.mocked(AgentRuntime).mockImplementation(function () {
      return { run: runtimeRun } as any;
    });
    mockOrchestrator.orchestrate.mockResolvedValue({
      matchedRules: [],
      sources: [],
      content: '降级回答',
      agentResults: [],
      metadata: {
        triggeredLlmArbitration: false,
        ragIncludedBy: 'none',
        composeUsedRagPriority: false,
      },
    });

    const { service, usageLog, traceService } = buildRuntimeService();
    const callbacks = {
      onSources: vi.fn(),
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onMeta: vi.fn(),
    };

    await service.stream(
      '问题',
      'kb-1',
      undefined,
      callbacks as any,
      'trace-1',
      'key-1',
      'session-1',
    );

    expect(mockOrchestrator.orchestrate).toHaveBeenCalledOnce();
    expect(callbacks.onToken).toHaveBeenCalledWith(expect.stringContaining('降级回答'));
    expect(callbacks.onDone).toHaveBeenCalledOnce();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(usageLog.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
    // 失败 trace 仍然落库
    expect(traceService.save).toHaveBeenCalledOnce();
  });

  it('rag_search 事件的 sources 转发为 onSources 回调', async () => {
    vi.stubEnv('LLM_API_KEY', 'test-key');
    vi.stubEnv('AGENT_TRACE_ENABLED', 'false');
    const runtimeRun = vi.fn().mockImplementation(async (params: any) => {
      params.emitEvent({
        type: 'sources',
        timestamp: 1,
        data: { sources: [{ sourceFile: 'a.pdf', score: 0.9 }] },
      });
      return makeRuntimeResult();
    });
    vi.mocked(AgentRuntime).mockImplementation(function () {
      return { run: runtimeRun } as any;
    });

    const { service } = buildRuntimeService();
    const callbacks = {
      onSources: vi.fn(),
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onMeta: vi.fn(),
    };

    await service.stream(
      '问题',
      'kb-1',
      undefined,
      callbacks as any,
      'trace-1',
      'key-1',
      'session-1',
    );

    expect(callbacks.onSources).toHaveBeenCalledWith([
      { content: '', sourceFile: 'a.pdf', score: 0.9 },
    ]);
  });
});
