import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Redis-backed CacheProvider 实现
 *
 * 实现 @knowbase-x/agents 的 CacheProvider 接口，
 * 替代 WebSearchAgent 内部的 noop 缓存。
 */
@Injectable()
export class RedisCacheProvider {
  private readonly logger = new Logger(RedisCacheProvider.name);
  private readonly client: Redis;
  private readonly prefix: string;

  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      // 复用 BullMQ 的 Redis 连接，不单独建立
      maxRetriesPerRequest: null,
    });
    this.prefix = 'ks:cache:';

    this.client.on('error', (err) => {
      this.logger.warn(`Redis 缓存连接错误: ${err.message}`);
    });
    this.client.on('connect', () => {
      this.logger.log('Redis 缓存客户端已连接');
    });
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

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }
}
