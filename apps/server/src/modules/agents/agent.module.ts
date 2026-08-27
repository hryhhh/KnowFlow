import { Module } from '@nestjs/common';
import { AgentChatService } from './agent-chat.service';
import { AgentController } from './agent.controller';
import { DbQueryService } from './db-query.service';
import { UsageLogModule } from '../usage/usage-log.module';
import { CacheModule } from './cache/cache.module';

@Module({
  imports: [UsageLogModule, CacheModule],
  controllers: [AgentController],
  providers: [AgentChatService, DbQueryService],
  exports: [AgentChatService],
})
export class AgentModule {}
