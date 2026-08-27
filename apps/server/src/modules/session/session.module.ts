import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationSession } from './entities/conversation-session.entity';
import { SessionMessage } from './entities/session-message.entity';
import { SessionService } from './session.service';
import { SessionController } from './session.controller';
import { SessionCacheModule } from './session-cache.module';

@Module({
  imports: [TypeOrmModule.forFeature([ConversationSession, SessionMessage]), SessionCacheModule],
  controllers: [SessionController],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
