import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IngestionQueueModule } from './ingestion.module';
import { IngestionProcessor } from './ingestion.processor';
import { Document } from '../document/entities/document.entity';
import { Chunk } from '../chunk/entities/chunk.entity';

/**
 * Worker 进程专用模块：导入队列模块并注册 processor。
 *
 * 不含任何 Controller，防止在 Worker 进程中启动 HTTP listener。
 */
@Module({
  imports: [IngestionQueueModule, TypeOrmModule.forFeature([Document, Chunk])],
  providers: [IngestionProcessor],
})
export class IngestionWorkerModule {}
