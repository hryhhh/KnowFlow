import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  DOCUMENT_INGEST_QUEUE_NAME,
  DEFAULT_QUEUE_ATTEMPTS,
  DEFAULT_QUEUE_BACKOFF_MS,
  DEFAULT_REMOVE_ON_COMPLETE,
  DEFAULT_REMOVE_ON_FAIL,
} from './ingestion.constants';
import { IngestionQueue } from './ingestion.queue';

/**
 * API 进程专用模块：注册 BullMQ Redis 连接和队列，不包含任何 processor。
 *
 * Worker 进程通过 IngestionWorkerModule 复用此模块的连接和队列 token，
 * 但加载自己的 processor。
 */
@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      },
    }),
    BullModule.registerQueue({
      name: DOCUMENT_INGEST_QUEUE_NAME,
    }),
  ],
  providers: [IngestionQueue],
  exports: [BullModule, IngestionQueue],
})
export class IngestionQueueModule {}
