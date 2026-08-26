/**
 * 文档摄入相关类型定义
 *
 * job payload、进度事件和处理阶段均集中管理，供 API 进程和 Worker 进程共享。
 */

/**
 * 文档处理阶段
 *
 * 与前端进度展示对齐；每个阶段对应一组合理的百分比范围。
 */
export type ProcessingStage =
  'queued' | 'parsing' | 'chunking' | 'embedding' | 'persisting' | 'completed';

/**
 * BullMQ job payload
 *
 * 不包含文件 Buffer（文件通过共享文件系统路径访问）。
 */
export interface DocumentIngestJobPayload {
  /** 文档 UUID */
  docId: string;
  /** 知识库 UUID */
  kbId: string;
  /** 文件绝对路径（存储在共享 volume 上） */
  filePath: string;
  /** 文件类型（pdf / word / csv / xlsx） */
  fileType: string;
  /** 解析策略：basic | mineru | mineru-agent */
  parseStrategy: string;
  /** 原始文件名（用于 chunks.sourceFile） */
  originalName: string;
}

/**
 * 进度更新事件（可选，用于未来扩展为 SSE/WebSocket）
 */
export interface DocumentProgressEvent {
  docId: string;
  kbId: string;
  stage: ProcessingStage;
  percent: number;
  errorMessage?: string;
}

/**
 * 验证进度值在 0-100 范围内
 */
export function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, value));
}
