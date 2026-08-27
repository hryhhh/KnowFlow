import { Injectable, Logger } from '@nestjs/common';
import { RedisClientService } from '../../common/redis/redis-client.service';

/**
 * 会话与热点元数据 Redis 缓存
 *
 * 缓存目标：
 * - 会话列表（按 kbId）
 * - 知识库列表
 * - 文档列表（按 kbId）
 * - API Key 校验结果（短期缓存）
 *
 * TTL 通过环境变量配置，默认 60 秒（热点数据短 TTL，避免脏读）
 */
@Injectable()
export class SessionCacheService {
  private readonly logger = new Logger(SessionCacheService.name);
  private readonly redis: RedisClientService;
  private readonly ttlSeconds: number;

  constructor(redis: RedisClientService) {
    this.redis = redis;
    this.ttlSeconds = parseInt(process.env.SESSION_CACHE_TTL_SECONDS ?? '60', 10);
  }

  private key(...parts: string[]): string {
    return `ks:cache:${parts.join(':')}`;
  }

  /** 获取会话列表缓存（按 kbId） */
  async getSessions(kbId: string): Promise<any[] | null> {
    try {
      const raw = await this.redis.client.get(this.key('sessions', kbId));
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      this.logger.warn(`获取会话缓存失败 kbId=${kbId}: ${err}`);
      return null;
    }
  }

  /** 写入会话列表缓存 */
  async setSessions(kbId: string, sessions: any[]): Promise<void> {
    try {
      await this.redis.client.setex(
        this.key('sessions', kbId),
        this.ttlSeconds,
        JSON.stringify(sessions),
      );
    } catch (err) {
      this.logger.warn(`写入会话缓存失败 kbId=${kbId}: ${err}`);
    }
  }

  /** 失效指定 kbId 的会话缓存（删除会话/消息时调用） */
  async invalidateSessions(kbId: string): Promise<void> {
    try {
      await this.redis.client.del(this.key('sessions', kbId));
    } catch {
      // 忽略失效失败
    }
  }

  /** 获取知识库列表缓存 */
  async getKnowledgeBases(): Promise<any[] | null> {
    try {
      const raw = await this.redis.client.get(this.key('kbs'));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /** 写入知识库列表缓存 */
  async setKnowledgeBases(kbs: any[]): Promise<void> {
    try {
      await this.redis.client.setex(this.key('kbs'), this.ttlSeconds, JSON.stringify(kbs));
    } catch {
      // 忽略
    }
  }

  /** 失效知识库缓存（创建/删除 KB 时调用） */
  async invalidateKnowledgeBases(): Promise<void> {
    try {
      await this.redis.client.del(this.key('kbs'));
    } catch {
      // 忽略
    }
  }

  /** 获取文档列表缓存（按 kbId） */
  async getDocuments(kbId: string): Promise<any[] | null> {
    try {
      const raw = await this.redis.client.get(this.key('docs', kbId));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /** 写入文档列表缓存 */
  async setDocuments(kbId: string, docs: any[]): Promise<void> {
    try {
      await this.redis.client.setex(this.key('docs', kbId), this.ttlSeconds, JSON.stringify(docs));
    } catch {
      // 忽略
    }
  }

  /** 失效指定 kbId 的文档缓存（删除文档时调用） */
  async invalidateDocuments(kbId: string): Promise<void> {
    try {
      await this.redis.client.del(this.key('docs', kbId));
    } catch {
      // 忽略
    }
  }

  /** 获取 API Key 校验缓存（短 TTL，防止频繁查询 DB） */
  async getApiKeyHash(apiKey: string): Promise<string | null> {
    try {
      const raw = await this.redis.client.get(this.key('apikey', apiKey));
      return raw ?? null;
    } catch {
      return null;
    }
  }

  /** 写入 API Key 校验缓存 */
  async setApiKeyHash(apiKey: string, hash: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.client.setex(this.key('apikey', apiKey), ttlSeconds, hash);
    } catch {
      // 忽略
    }
  }

  /** 获取缓存统计 */
  async stats(): Promise<{ keys: number; memory: string }> {
    try {
      const info = await this.redis.client.info('memory');
      const memoryLine = info.split('\n').find((l) => l.startsWith('used_memory:'));
      const keys = await this.redis.client.dbsize();
      return {
        keys,
        memory: memoryLine ? memoryLine.split(':')[1].trim() : 'unknown',
      };
    } catch {
      return { keys: 0, memory: 'error' };
    }
  }
}
