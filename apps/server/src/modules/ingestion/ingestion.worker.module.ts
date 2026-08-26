import { Module } from '@nestjs/common';
import { IngestionQueueModule } from './ingestion.module';
import { IngestionProcessor } from './ingestion.processor';

/**
 * Worker 进程专用模块：导入队列模块并注册 processor。
 *
 * 不含任何 Controller，防止在 Worker 进程中启动 HTTP listener。
 */
@Module({
  imports: [IngestionQueueModule],
  providers: [IngestionProcessor],
})
export class IngestionWorkerModule {}
