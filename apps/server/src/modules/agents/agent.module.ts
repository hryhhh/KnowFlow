import { Module } from '@nestjs/common';
import { AgentChatService } from './agent-chat.service';
import { AgentController } from './agent.controller';
import { DbQueryService } from './db-query.service';
import { UsageLogModule } from '../usage/usage-log.module';
import { CacheModule } from './cache/cache.module';
import { TraceModule } from './trace/trace.module';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [UsageLogModule, CacheModule, TraceModule, SessionModule],
  providers: [AgentChatService, DbQueryService],
  controllers: [AgentController],
  exports: [AgentChatService],
})
export class AgentModule {}
