import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { KnowledgeBase } from "../knowledge-base/entities/knowledge-base.entity";
import { Document } from "../document/entities/document.entity";
import { Chunk } from "../chunk/entities/chunk.entity";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeBase, Document, Chunk])],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
