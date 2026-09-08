/**
 * 集中式环境配置（单一事实来源）
 *
 * 约定（12-Factor）：
 * - env 只承载"会随部署环境变化"的值；机制参数/业务默认值以代码常量形式就近定义在消费方
 * - 本模块不做 dotenv 加载——加载职责属于各进程入口（main.ts / worker.main.ts /
 *   data-source.ts），保证单元测试环境不受真实 .env 污染
 * - 所有取值惰性求值（访问时读 process.env）：既支持测试用 vi.stubEnv 覆盖，
 *   也保证入口完成 dotenv 加载后首次访问即拿到 .env 值
 * - 数值解析统一走 intEnv/numEnv，杜绝 `Number(x) || fallback` 吞掉合法 0 的问题
 * - app.module.ts 通过 ConfigModule 的 validate 钩子在启动时执行 validateEnv，
 *   必填缺失或取值非法直接启动失败（fail fast），而不是运行到一半静默回退
 * - 业务默认参数（检索/Agent 编排/Web Search 机制）不在此处，见 config/defaults.ts
 */

function strEnv(key: string, fallback: string): string {
  const v = process.env[key];
  return v !== undefined && v.trim() !== '' ? v.trim() : fallback;
}

function intEnv(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

function boolEnv(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return fallback;
  return v === 'true' || v === '1';
}

function listEnv(key: string, fallback: string[]): string[] {
  const v = process.env[key];
  if (v === undefined || v.trim() === '') return fallback;
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const env = {
  get nodeEnv(): string {
    return process.env.NODE_ENV ?? 'development';
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  },
  /** worker 进程内部标记（由启动脚本设置，非用户配置） */
  get workerMode(): boolean {
    return process.env.WORKER_MODE === 'true';
  },
  get app() {
    return {
      port: intEnv('SERVER_PORT', 3000),
      corsAllowedOrigins: listEnv('CORS_ALLOWED_ORIGINS', []),
    };
  },
  get database() {
    return {
      host: strEnv('DATABASE_HOST', 'localhost'),
      port: intEnv('DATABASE_PORT', 5432),
      user: strEnv('DATABASE_USER', 'postgres'),
      password: strEnv('DATABASE_PASSWORD', '123456'),
      name: strEnv('DATABASE_NAME', 'knowledge_rag'),
      ssl: boolEnv('DATABASE_SSL', false),
    };
  },
  get redis() {
    return {
      host: strEnv('REDIS_HOST', '127.0.0.1'),
      port: intEnv('REDIS_PORT', 6379),
    };
  },
  get llm() {
    return {
      apiKey: strEnv('LLM_API_KEY', ''),
      baseURL: strEnv('LLM_BASE_URL', ''),
      model: strEnv('LLM_MODEL', 'qwen3.7-plus'),
    };
  },
  get embedding() {
    return {
      model: strEnv('EMBEDDING_MODEL', 'text-embedding-v4'),
      dimensions: intEnv('EMBEDDING_DIMENSIONS', 1024),
    };
  },
  get upload() {
    return {
      maxMb: intEnv('MAX_UPLOAD_SIZE_MB', 100),
    };
  },
  get apiService() {
    return {
      rateLimit: intEnv('API_RATE_LIMIT', 60),
    };
  },
  get agents() {
    return {
      enabled: boolEnv('AGENTS_ENABLED', false),
      runtimeEnabled: boolEnv('AGENT_RUNTIME_ENABLED', false),
      legacyToolsEnabled: boolEnv('AGENT_LEGACY_TOOLS_ENABLED', false),
      traceEnabled: boolEnv('AGENT_TRACE_ENABLED', false),
      fallbackEnabled: boolEnv('AGENT_RUNTIME_FALLBACK', true),
      /** Agent 整体超时（毫秒），缺省 30s */
      timeoutMs: intEnv('AGENT_RUNTIME_TIMEOUT_MS', 30000),
    };
  },
  get webSearch() {
    return {
      provider: strEnv('WEB_SEARCH_PROVIDER', 'tavily'),
      apiKey: strEnv('WEB_SEARCH_API_KEY', ''),
    };
  },
  get dbQuery() {
    return {
      /** 只读库连接串，为空时回退到 DATABASE_* 拼接 */
      readonlyUrl: strEnv('DB_READONLY_URL', ''),
      /** SQL 查询模板文件路径，为空时由消费方按仓库结构解析 */
      templatesPath: strEnv('DB_QUERIES_TEMPLATE_PATH', ''),
    };
  },
  get queue() {
    return {
      attempts: intEnv('DOCUMENT_QUEUE_ATTEMPTS', 3),
      backoffMs: intEnv('DOCUMENT_QUEUE_BACKOFF_MS', 2000),
      removeOnComplete: intEnv('DOCUMENT_QUEUE_REMOVE_ON_COMPLETE', 1000),
      removeOnFail: intEnv('DOCUMENT_QUEUE_REMOVE_ON_FAIL', 100),
    };
  },
  get session() {
    return {
      cacheTtlSeconds: intEnv('SESSION_CACHE_TTL_SECONDS', 60),
    };
  },
};

const REQUIRED_VARS = ['LLM_API_KEY', 'LLM_BASE_URL'] as const;

/** 必须为正整数的变量 */
const POSITIVE_INT_VARS = [
  'DATABASE_PORT',
  'REDIS_PORT',
  'SERVER_PORT',
  'EMBEDDING_DIMENSIONS',
  'MAX_UPLOAD_SIZE_MB',
  'API_RATE_LIMIT',
  'DOCUMENT_QUEUE_ATTEMPTS',
  'AGENT_RUNTIME_TIMEOUT_MS',
] as const;

/** 允许为 0 的非负整数变量（0 有"禁用"语义） */
const NON_NEGATIVE_INT_VARS = [
  'DOCUMENT_QUEUE_BACKOFF_MS',
  'DOCUMENT_QUEUE_REMOVE_ON_COMPLETE',
  'DOCUMENT_QUEUE_REMOVE_ON_FAIL',
] as const;

const SEARCH_PROVIDERS = ['tavily', 'serper'];

/**
 * ConfigModule validate 钩子：在进程启动阶段校验合并后的环境变量。
 * 任一规则不满足即抛错终止启动（fail fast），错误信息逐条列出便于排障。
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const errors: string[] = [];

  const raw = (key: string): string | undefined => {
    const v = config[key];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  };

  for (const key of REQUIRED_VARS) {
    if (!raw(key)) errors.push(`${key} 必填（当前缺失或为空）`);
  }

  const checkInt = (key: string, min: number): void => {
    const v = raw(key);
    if (v === undefined) return;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min) {
      errors.push(`${key} 必须为 >= ${min} 的整数（当前值 "${v}"）`);
    }
  };
  for (const key of POSITIVE_INT_VARS) checkInt(key, 1);
  for (const key of NON_NEGATIVE_INT_VARS) checkInt(key, 0);

  const provider = raw('WEB_SEARCH_PROVIDER');
  if (provider && !SEARCH_PROVIDERS.includes(provider.toLowerCase())) {
    errors.push(
      `WEB_SEARCH_PROVIDER 必须为 ${SEARCH_PROVIDERS.join(' | ')}（当前值 "${provider}"）`,
    );
  }

  const dimensions = raw('EMBEDDING_DIMENSIONS');
  if (
    dimensions !== undefined &&
    ![384, 512, 768, 1024, 1536, 2048, 3072].includes(Number(dimensions))
  ) {
    errors.push(
      `EMBEDDING_DIMENSIONS 必须为常见 embedding 输出维度之一 [384, 512, 768, 1024, 1536, 2048, 3072]（当前值 "${dimensions}"），且需与数据库向量列维度一致`,
    );
  }

  if (errors.length > 0) {
    throw new Error(`环境变量校验失败，请检查 .env 配置：\n  - ${errors.join('\n  - ')}`);
  }

  return config;
}
