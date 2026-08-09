import { Module } from "@nestjs/common";
import { RetrievalService } from "./retrieval.service";
import { RetrievalController } from "./retrieval.controller";
import { UsageLogModule } from "../usage/usage-log.module";

@Module({
  imports: [UsageLogModule],
  controllers: [RetrievalController],
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
