import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DOCUMENT_INGEST_QUEUE_NAME } from '../modules/ingestion/ingestion.constants';
import { env } from '../config/env';

/**
 * Worker 健康检查服务
 *
 * 查询 Redis 连接状态和队列活跃 job 数量，
 * 供 docker-compose healthcheck 使用。
 */
@Injectable()
export class WorkerHealthService {
  private readonly logger = new Logger(WorkerHealthService.name);
  private queue: Queue | null = null;
  private _healthy = false;

  async connect(): Promise<void> {
    try {
      this.queue = new Queue(DOCUMENT_INGEST_QUEUE_NAME, {
        connection: {
          host: env.redis.host,
          port: env.redis.port,
        },
      });
      // ping 验证 Redis 连接
      const client = await (this.queue as any).client;
      if (client && typeof client.ping === 'function') {
        await client.ping();
      }
      this._healthy = true;
      this.logger.log('Worker 健康检查：Redis 连接正常');
    } catch (err) {
      this._healthy = false;
      this.logger.error(`Worker 健康检查失败: ${err}`);
    }
  }

  /** 返回 true 表示 Worker 健康 */
  async isHealthy(): Promise<{ healthy: boolean; activeJobs: number; details: string }> {
    if (!this._healthy || !this.queue) {
      return { healthy: false, activeJobs: 0, details: 'Redis 未连接' };
    }
    try {
      // 获取活跃 job 数（waiting + active）
      const [waiting, active] = await Promise.all([
        (this.queue as any).getJobCount(true),
        (this.queue as any).getJobCount(false),
      ]);
      return {
        healthy: true,
        activeJobs: waiting + active,
        details: `活跃 job 数: ${waiting + active}`,
      };
    } catch (err) {
      return {
        healthy: false,
        activeJobs: 0,
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
