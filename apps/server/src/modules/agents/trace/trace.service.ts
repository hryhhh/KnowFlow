import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentTrace } from './entities/agent-trace.entity';

@Injectable()
export class TraceService {
  private readonly logger = new Logger(TraceService.name);

  constructor(
    @InjectRepository(AgentTrace)
    private readonly repo: Repository<AgentTrace>,
  ) {}

  /**
   * 保存或更新 trace（upsert，以 id 为冲突键）
   */
  async save(trace: AgentTrace): Promise<void> {
    try {
      await this.repo.upsert(trace, ['id']);
    } catch (err) {
      // Trace 写入失败不影响主流程
      this.logger.warn(`Trace 保存失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 按 ID 查询单次 trace */
  async get(id: string): Promise<AgentTrace | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * 列表查询（支持 kbId 过滤，按时间倒序）
   * @param kbId 可选，过滤特定知识库
   * @param limit 返回数量上限，默认 20
   */
  async list(kbId?: string, limit = 20): Promise<AgentTrace[]> {
    const where = kbId ? { kbId } : {};
    return this.repo.find({
      where,
      order: { startedAt: 'DESC' },
      take: limit,
    });
  }
}
