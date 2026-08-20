import { Module } from '@nestjs/common';
import { AgentChatService } from './agent-chat.service';
import { AgentController } from './agent.controller';
import { DbQueryService } from './db-query.service';
import { UsageLogModule } from '../usage/usage-log.module';

@Module({
  imports: [UsageLogModule],
  controllers: [AgentController],
  providers: [AgentChatService, DbQueryService],
  exports: [AgentChatService],
})
export class AgentModule {}
