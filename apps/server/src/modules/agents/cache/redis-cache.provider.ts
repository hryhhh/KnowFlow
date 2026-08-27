import { Injectable, Logger } from '@nestjs/common';
import { RedisClientService } from '../../../common/redis/redis-client.service';

/**
 * Redis-backed CacheProvider 实现
 *
 * 实现 @knowbase-x/agents 的 CacheProvider 接口，
 * 替代 WebSearchAgent 内部的 noop 缓存。
 * 复用共享 RedisClientService 连接，不额外创建连接。
 */
@Injectable()
export class RedisCacheProvider {
  private readonly logger = new Logger(RedisCacheProvider.name);
  private readonly client;
  private readonly prefix = 'ks:cache:';

  constructor(redisClient: RedisClientService) {
    this.client = redisClient.client;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(this.prefix + key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn(`Redis GET 失败 key=${key}: ${err}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.client.setex(this.prefix + key, ttlSeconds, JSON.stringify(value));
    } catch (err) {
      this.logger.warn(`Redis SET 失败 key=${key}: ${err}`);
    }
  }
}
