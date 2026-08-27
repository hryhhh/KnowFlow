import { Module } from '@nestjs/common';
import { RedisCacheProvider } from './redis-cache.provider';

@Module({
  providers: [RedisCacheProvider],
  exports: [RedisCacheProvider],
})
export class CacheModule {}
