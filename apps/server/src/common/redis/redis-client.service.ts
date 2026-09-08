import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../../config/env';

/**
 * 共享 Redis 客户端单例
 *
 * 所有需要 Redis 的模块都通过此服务获取同一个连接，
 * 避免每次新建连接导致连接数爆炸。
 *
 * 连接在 onModuleInit 时建立（fail-fast），启动失败则整个服务启动失败。
 */
@Injectable()
export class RedisClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisClientService.name);
  private _client: Redis | null = null;

  async onModuleInit() {
    await this.connect();
  }

  get client(): Redis {
    if (!this._client) {
      throw new Error('Redis 客户端未初始化');
    }
    return this._client;
  }

  /**
   * 建立 Redis 连接（阻塞等待，启动失败则服务不可用）
   */
  private async connect(): Promise<void> {
    try {
      this._client = new Redis({
        host: env.redis.host,
        port: env.redis.port,
        maxRetriesPerRequest: null,
        retryStrategy: (times) => {
          if (times > 3) {
            this.logger.error(`Redis 重连失败（${times} 次），停止重试`);
            return null;
          }
          return Math.min(times * 200, 2000);
        },
      });

      this._client.on('error', (err) => {
        this.logger.warn(`Redis 错误: ${err.message}`);
      });
      this._client.on('connect', () => {
        this.logger.log('Redis 连接已建立');
      });

      await this._client.ping();
      this.logger.log('Redis 连接验证通过');
    } catch (err) {
      this.logger.error(`Redis 连接失败: ${err}`);
      throw err; // 启动失败时直接抛出，确保服务不会在 Redis 不可用时启动
    }
  }

  async onModuleDestroy() {
    if (this._client) {
      await this._client.quit().catch(() => undefined);
      this._client = null;
    }
  }
}
