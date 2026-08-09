import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { KnowledgeBase } from "../knowledge-base/entities/knowledge-base.entity";
import { Document } from "../document/entities/document.entity";
import { Chunk } from "../chunk/entities/chunk.entity";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { UsageLogModule } from "../usage/usage-log.module";

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeBase, Document, Chunk]), UsageLogModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
