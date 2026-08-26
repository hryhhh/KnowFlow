/**
 * 文档摄入队列常量
 *
 * 所有队列名、job 名和默认重试配置集中在此，避免 API 与 Worker
 * 使用字符串散落在多个文件中导致不一致。
 */

/** BullMQ 队列名称 */
export const DOCUMENT_INGEST_QUEUE_NAME = 'document-ingest';

/** job 名称（用于标识处理器类型） */
export const PROCESS_DOCUMENT_JOB_NAME = 'process-document';

/** 默认重试次数 */
export const DEFAULT_QUEUE_ATTEMPTS = 3;

/** 默认退避策略起始延迟（毫秒） */
export const DEFAULT_QUEUE_BACKOFF_MS = 2000;

/** 默认保留已完成 job 的最大数量，防止 Redis 内存无限增长 */
export const DEFAULT_REMOVE_ON_COMPLETE = 1000;

/** 默认保留失败 job 的最大数量 */
export const DEFAULT_REMOVE_ON_FAIL = 100;

/** 并发数（由环境变量 DOCUMENT_QUEUE_CONCURRENCY 覆盖） */
export const DEFAULT_CONCURRENCY = 2;
