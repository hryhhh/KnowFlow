import { Module } from "@nestjs/common";
import { ChatService } from "./chat.service";
import { ChatController } from "./chat.controller";
import { UsageLogModule } from "../usage/usage-log.module";
import { AgentModule } from "../agents/agent.module";
import { SessionModule } from "../session/session.module";

@Module({
  imports: [UsageLogModule, AgentModule, SessionModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
