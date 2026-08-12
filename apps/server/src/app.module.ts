import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import * as path from "node:path";
import { RagConfigModule } from "./config/rag-config.module";
import { KnowledgeBaseModule } from "./modules/knowledge-base/knowledge-base.module";
import { DocumentModule } from "./modules/document/document.module";
import { ChunkModule } from "./modules/chunk/chunk.module";
import { RetrievalModule } from "./modules/retrieval/retrieval.module";
import { ChatModule } from "./modules/chat/chat.module";
import { ApiServiceModule } from "./modules/api-service/api-service.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { UsageLogModule } from "./modules/usage/usage-log.module";
import { SessionModule } from "./modules/session/session.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.resolve(__dirname, "../../../.env"),
        path.resolve(process.cwd(), "../../.env"),
        ".env",
      ],
    }),
    RagConfigModule,
    TypeOrmModule.forRoot({
      type: "postgres",
      host: process.env.DATABASE_HOST ?? "localhost",
      port: parseInt(process.env.DATABASE_PORT ?? "5432", 10),
      username: process.env.DATABASE_USER ?? "postgres",
      password: process.env.DATABASE_PASSWORD ?? "123456",
      database: process.env.DATABASE_NAME ?? "knowledge_rag",
      autoLoadEntities: true,
      synchronize: true,
      ssl: false,
    }),
    KnowledgeBaseModule,
    DocumentModule,
    ChunkModule,
    RetrievalModule,
    ChatModule,
    ApiServiceModule,
    DashboardModule,
    UsageLogModule,
    SessionModule,
  ],
})
export class AppModule {}
