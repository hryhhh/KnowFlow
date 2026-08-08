import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { KnowledgeBase } from "./entities/knowledge-base.entity";
import { KnowledgeBaseService } from "./knowledge-base.service";
import { KnowledgeBaseController } from "./knowledge-base.controller";
import { Document } from "../document/entities/document.entity";
import { Chunk } from "../chunk/entities/chunk.entity";

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeBase, Document, Chunk])],
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService],
  exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
