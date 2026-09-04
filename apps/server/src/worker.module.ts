import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RagConfigModule } from './config/rag-config.module';
import { Document } from './modules/document/entities/document.entity';
import { Chunk } from './modules/chunk/entities/chunk.entity';
import { IngestionQueueModule } from './modules/ingestion/ingestion.module';
import { IngestionWorkerModule } from './modules/ingestion/ingestion.worker.module';
import * as path from 'node:path';

/**
 * Worker 专用根模块
 *
 * 复用数据库连接和 RAG_CONFIG，但只消费 BullMQ 队列，不暴露 HTTP。
 */
@Module({
  imports: [
    // 数据库连接（与 API 进程共用同一 DS）
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DATABASE_HOST ?? 'localhost',
      port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
      username: process.env.DATABASE_USER ?? 'postgres',
      password: process.env.DATABASE_PASSWORD ?? '123456',
      database: process.env.DATABASE_NAME ?? 'knowledge_rag',
      autoLoadEntities: true,
      // 自动加载 entities 目录下的所有实体
      entities: [path.join(__dirname, './modules/**/*.entity{.ts,.js}')],
      // Worker 必须使用 migration 路径，禁止 synchronize
      synchronize: false,
      ssl: process.env.DATABASE_SSL === 'true',
    }),
    // RAG 配置（通过全局模块注入）
    RagConfigModule,
    // 队列模块（含 Redis 连接和队列注册）
    IngestionQueueModule,
    // Processor（含 BullModule.registerHandlers 自动注册）
    IngestionWorkerModule,
  ],
})
export class WorkerModule {}
