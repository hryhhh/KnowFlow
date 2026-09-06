import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RagConfigModule } from './config/rag-config.module';
import { Document } from './modules/document/entities/document.entity';
import { Chunk } from './modules/chunk/entities/chunk.entity';
import { IngestionQueueModule } from './modules/ingestion/ingestion.module';
import { IngestionWorkerModule } from './modules/ingestion/ingestion.worker.module';
import * as path from 'node:path';
import { env } from './config/env';

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
      host: env.database.host,
      port: env.database.port,
      username: env.database.user,
      password: env.database.password,
      database: env.database.name,
      autoLoadEntities: true,
      // 自动加载 entities 目录下的所有实体
      entities: [path.join(__dirname, './modules/**/*.entity{.ts,.js}')],
      // Worker 必须使用 migration 路径，禁止 synchronize
      synchronize: false,
      ssl: env.database.ssl,
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
