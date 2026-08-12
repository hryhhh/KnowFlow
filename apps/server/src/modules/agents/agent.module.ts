import { Module } from "@nestjs/common";
import { AgentChatService } from "./agent-chat.service";
import { AgentController } from "./agent.controller";
import { UsageLogModule } from "../usage/usage-log.module";
import { DbQueryService } from "./db-query.service";

@Module({
  imports: [UsageLogModule],
  controllers: [AgentController],
  providers: [AgentChatService, DbQueryService],
  exports: [AgentChatService],
})
export class AgentModule {}
