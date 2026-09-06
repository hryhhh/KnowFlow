import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DOCUMENT_INGEST_QUEUE_NAME } from './ingestion.constants';
import { env } from '../../config/env';
import type { DocumentIngestJobPayload } from './ingestion.types';

/**
 * 文档摄入队列封装
 *
 * 提供入队方法和 jobId 生成，供 DocumentService 调用。
 * jobId 使用稳定格式 `document-{docId}`，确保同一文档不重复入队。
 */
@Injectable()
export class IngestionQueue {
  private readonly logger = new Logger(IngestionQueue.name);

  constructor(
    @InjectQueue(DOCUMENT_INGEST_QUEUE_NAME)
    private readonly queue: Queue,
  ) {}

  /**
   * 将文档摄入任务入队
   *
   * @returns jobId 字符串，供 DocumentService 回写到 documents.jobId
   */
  async enqueue(payload: DocumentIngestJobPayload): Promise<string> {
    const jobId = `document-${payload.docId}`;

    try {
      await this.queue.add('process-document', payload, {
        jobId,
        // 指数退避重试
        attempts: env.queue.attempts,
        backoff: {
          type: 'exponential',
          delay: env.queue.backoffMs,
        },
        // 保留已完成和失败 job 以支持排障
        removeOnComplete: env.queue.removeOnComplete,
        removeOnFail: env.queue.removeOnFail,
        // 并发限制由 Worker 配置控制
        priority: 1,
      });
      this.logger.log(`文档 ${payload.docId} 已入队，jobId=${jobId}`);
      return jobId;
    } catch (err) {
      // Redis 不可用或内存满时返回明确错误，不伪装成成功
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('maxmemory') || msg.includes('ERR')) {
        this.logger.error(`Redis 入队失败（可能内存不足）: ${msg}`);
        throw new BadRequestException(`队列服务暂不可用：${msg}`);
      }
      this.logger.error(`入队失败: ${msg}`);
      throw err;
    }
  }

  /**
   * 取消并删除指定 jobId 的任务（用于文档删除流程）
   */
  async removeJob(jobId: string): Promise<void> {
    await this.queue.remove(jobId);
  }
}
