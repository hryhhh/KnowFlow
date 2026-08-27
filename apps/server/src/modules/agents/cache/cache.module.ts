import { Module } from '@nestjs/common';
import { RedisModule } from '../../../common/redis/redis.module';
import { RedisCacheProvider } from './redis-cache.provider';

@Module({
  imports: [RedisModule],
  providers: [RedisCacheProvider],
  exports: [RedisCacheProvider],
})
export class CacheModule {}
