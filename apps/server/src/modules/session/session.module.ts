import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConversationSession } from "./entities/conversation-session.entity";
import { SessionMessage } from "./entities/session-message.entity";
import { SessionService } from "./session.service";
import { SessionController } from "./session.controller";

@Module({
  imports: [TypeOrmModule.forFeature([ConversationSession, SessionMessage])],
  controllers: [SessionController],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
