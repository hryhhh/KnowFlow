import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { TraceService } from './trace.service';
import { AgentTrace } from './entities/agent-trace.entity';

@Controller('agents/traces')
export class TraceController {
  constructor(private readonly traceService: TraceService) {}

  /**
   * GET /api/agents/traces/:id
   * 查询单次 Agent 执行的完整 trace
   */
  @Get(':id')
  async get(@Param('id') id: string): Promise<{ data: AgentTrace }> {
    const trace = await this.traceService.get(id);
    if (!trace) {
      throw new NotFoundException('Trace 不存在');
    }
    return { data: trace };
  }

  /**
   * GET /api/agents/traces?kbId=X&limit=20
   * 列表查询（支持 kbId 过滤）
   */
  @Get()
  async list(
    @Query('kbId') kbId?: string,
    @Query('limit') limit?: string,
  ): Promise<{ data: AgentTrace[] }> {
    const parsed = limit ? parseInt(limit, 10) : 20;
    // 钳制到 1..100，避免 NaN 或超大 limit 造成 SQL 异常/全表拉取
    const parsedLimit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 20;
    return { data: await this.traceService.list(kbId, parsedLimit) };
  }
}
