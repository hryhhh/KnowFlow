import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { RedisClientService } from '../../common/redis/redis-client.service';
import { RateLimiterService } from '../../common/rate-limiter/rate-limiter.service';
import { env } from '../../config/env';

/**
 * API 请求限流守卫
 *
 * 基于 Redis 滑动窗口实现，按 API Key / IP 分组限流。
 * 未通过限流时返回 429 Too Many Requests。
 *
 * 使用方式：
 *   @UseGuards(RateLimitGuard('apikey'))
 *   @UseGuards(RateLimitGuard('ip', { limit: 100, windowMs: 60_000 }))
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly keyExtractor: (ctx: ExecutionContext) => string;

  constructor(
    private readonly redisClient: RedisClientService,
    private readonly rateLimiter: RateLimiterService,
    kind: 'apikey' | 'ip' | 'user' = 'apikey',
    options?: { limit?: number; windowMs?: number },
  ) {
    this.limit = options?.limit ?? env.apiService.rateLimit;
    this.windowMs = options?.windowMs ?? 60_000; // 默认 1 分钟

    switch (kind) {
      case 'apikey':
        this.keyExtractor = (ctx) => {
          const req = ctx.switchToHttp().getRequest();
          const apiKey = (req.headers['x-api-key'] as string) ?? req.user?.apiKeyId;
          return apiKey ? `rl:apikey:${apiKey}` : 'rl:anonymous';
        };
        break;
      case 'ip':
        this.keyExtractor = (ctx) => {
          const req = ctx.switchToHttp().getRequest();
          const ip = req.ip ?? (req.headers['x-forwarded-for'] as string) ?? 'unknown';
          return `rl:ip:${ip}`;
        };
        break;
      case 'user':
        this.keyExtractor = (ctx) => {
          const req = ctx.switchToHttp().getRequest();
          const userId = req.user?.id ?? 'unknown';
          return `rl:user:${userId}`;
        };
        break;
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.keyExtractor(context);
    const result = await this.rateLimiter.check(key, this.limit, this.windowMs);

    if (!result.allowed) {
      this.logger.warn(`限流触发 key=${key} remaining=${result.remaining}`);
      const req = context.switchToHttp().getRequest();
      const res = context.switchToHttp().getResponse();
      res.header('X-RateLimit-Limit', String(this.limit));
      res.header('X-RateLimit-Remaining', '0');
      res.header('X-RateLimit-Reset', String(result.resetAt));
      res.status(429).json({
        code: 429,
        message: '请求过于频繁，请稍后重试',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      });
      return false;
    }

    // 设置响应头
    const res = context.switchToHttp().getResponse();
    res.header('X-RateLimit-Limit', String(this.limit));
    res.header('X-RateLimit-Remaining', String(result.remaining));
    res.header('X-RateLimit-Reset', String(result.resetAt));
    return true;
  }
}
