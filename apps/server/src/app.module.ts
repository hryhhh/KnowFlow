import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as path from 'node:path';
import { RagConfigModule } from './config/rag-config.module';
import { env, validateEnv } from './config/env';
import { KnowledgeBaseModule } from './modules/knowledge-base/knowledge-base.module';
import { DocumentModule } from './modules/document/document.module';
import { ChunkModule } from './modules/chunk/chunk.module';
import { RetrievalModule } from './modules/retrieval/retrieval.module';
import { ChatModule } from './modules/chat/chat.module';
import { ApiServiceModule } from './modules/api-service/api-service.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { UsageLogModule } from './modules/usage/usage-log.module';
import { SessionModule } from './modules/session/session.module';
import { AgentModule } from './modules/agents/agent.module';
import { HealthModule } from './common/health/health.module';
import { IngestionQueueModule } from './modules/ingestion/ingestion.module';
import { RedisModule } from './common/redis/redis.module';
import { OutboxCheckModule } from './common/outbox-check/outbox-check.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.resolve(__dirname, '../../../.env'),
        path.resolve(process.cwd(), '../../.env'),
        '.env',
      ],
      // 启动时 fail-fast 校验：必填缺失 / 数值或枚举非法直接终止启动
      validate: validateEnv,
    }),
    RagConfigModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: env.database.host,
      port: env.database.port,
      username: env.database.user,
      password: env.database.password,
      database: env.database.name,
      autoLoadEntities: true,
      synchronize: !env.isProduction,
      ssl: env.database.ssl,
    }),
    KnowledgeBaseModule,
    DocumentModule,
    ChunkModule,
    RetrievalModule,
    ChatModule,
    ApiServiceModule,
    DashboardModule,
    UsageLogModule,
    AgentModule,
    SessionModule,
    HealthModule,
    IngestionQueueModule,
    RedisModule,
    OutboxCheckModule,
  ],
})
export class AppModule {}
