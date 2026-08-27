import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { RedisClientService } from '../../common/redis/redis-client.service';

/**
 * 滑动窗口限流器（基于 Redis INCR + EXPIRE）
 *
 * 按 API Key / IP / 用户分组，支持多种限流策略：
 * - perMinute: 每分钟最多 N 次
 * - perSecond: 每秒最多 N 次
 * - perHour: 每小时最多 N 次
 */
@Injectable()
export class RateLimiterService implements OnModuleDestroy {
  private readonly logger = new Logger(RateLimiterService.name);

  constructor(private readonly redisClient: RedisClientService) {}

  /**
   * 检查请求是否超过限流阈值
   * @param key 限流键（如 apikey:xxx 或 ip:127.0.0.1）
   * @param limit 最大请求次数
   * @param windowMs 时间窗口（毫秒）
   * @returns { allowed: boolean, remaining: number, resetAt: number }
   */
  async check(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const client = this.redisClient.client;
    const redisKey = `rate:${key}`;
    const windowKey = `${(Date.now() / windowMs) | 0}`; // 当前窗口序号

    try {
      // 使用 hash 结构存储每个窗口的计数
      const currentWindow = Math.floor(Date.now() / windowMs);
      const countKey = `rl:${key}:${currentWindow}`;
      const ttl = windowMs * 2; // TTL 设为窗口的 2 倍，确保数据不会过早消失

      const count = await client.incr(countKey);
      if (count === 1) {
        await client.expire(countKey, ttl);
      }

      const remaining = Math.max(0, limit - count);
      const resetAt = (currentWindow + 1) * windowMs;

      return {
        allowed: count <= limit,
        remaining,
        resetAt,
      };
    } catch (err) {
      this.logger.warn(`限流检查失败 key=${key}: ${err}`);
      // Redis 不可用时放行（fail-open）
      return { allowed: true, remaining: limit, resetAt: Date.now() + windowMs };
    }
  }

  /** 获取当前窗口的请求计数 */
  async getCount(key: string, windowMs: number): Promise<number> {
    try {
      const client = this.redisClient.client;
      const currentWindow = Math.floor(Date.now() / windowMs);
      const countKey = `rl:${key}:${currentWindow}`;
      const count = await client.get(countKey);
      return count ? parseInt(count, 10) : 0;
    } catch {
      return 0;
    }
  }

  async onModuleDestroy() {
    // Redis 连接由 RedisClientService 统一管理
  }
}
