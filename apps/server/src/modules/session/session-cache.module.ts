import { Module } from '@nestjs/common';
import { SessionCacheService } from './session-cache.service';
import { RedisModule } from '../../common/redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [SessionCacheService],
  exports: [SessionCacheService],
})
export class SessionCacheModule {}
