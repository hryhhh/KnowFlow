import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * 共享 Redis 客户端单例
 *
 * 所有需要 Redis 的模块都通过此服务获取同一个连接，
 * 避免每次新建连接导致连接数爆炸。
 *
 * 连接是懒加载的：第一次调用 client getter 时才会建立连接。
 */
@Injectable()
export class RedisClientService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisClientService.name);
  private _client: Redis | null = null;
  private _connecting: Promise<void> | null = null;

  get client(): Redis {
    // 懒加载连接：如果客户端未创建，触发连接
    if (!this._client && !this._connecting) {
      this._connecting = this.connect();
    }
    // 等待连接完成后再返回客户端
    if (this._connecting) {
      // 同步访问：NestJS DI 需要同步解析，这里直接抛出明确错误
      // 实际使用时会通过 try/catch 处理
      throw new Error('Redis 尚未就绪，请稍后重试');
    }
    if (!this._client) {
      throw new Error('Redis 客户端未初始化');
    }
    return this._client;
  }

  /**
   * 尝试建立 Redis 连接（非阻塞）
   */
  private async connect(): Promise<void> {
    if (this._client) return;

    try {
      this._client = new Redis({
        host: process.env.REDIS_HOST ?? 'localhost',
        port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
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
      // 不抛出，允许应用继续运行（Redis 不可用时部分功能降级）
      this._client = null;
      this._connecting = null;
    }
  }

  async onModuleDestroy() {
    if (this._client) {
      await this._client.quit().catch(() => undefined);
      this._client = null;
    }
  }
}
