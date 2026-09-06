import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TraceService } from './trace.service';
import { AgentTrace } from './entities/agent-trace.entity';

describe('TraceService', () => {
  let mockRepo: any;
  let service: TraceService;

  beforeEach(() => {
    mockRepo = {
      upsert: vi.fn().mockResolvedValue(undefined),
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockResolvedValue([]),
    };
    service = new TraceService(mockRepo);
  });

  it('save 调用 repo.upsert', async () => {
    const trace: Partial<AgentTrace> = {
      id: 'trace-1',
      sessionId: 'sess-1',
      kbId: 'kb-1',
      query: '测试',
      status: 'completed',
      steps: [],
      summary: null,
      tokensUsed: null,
      errorMsg: null,
    };

    await service.save(trace as AgentTrace);
    expect(mockRepo.upsert).toHaveBeenCalledWith(trace, ['id']);
  });

  it('save 失败时不抛出异常', async () => {
    mockRepo.upsert.mockRejectedValue(new Error('DB error'));
    // 不应抛出
    await expect(service.save({ id: 't1' } as any)).resolves.toBeUndefined();
  });

  it('get 返回找到的 trace', async () => {
    const trace = { id: 'trace-1', query: 'test' };
    mockRepo.findOne.mockResolvedValue(trace);

    const result = await service.get('trace-1');
    expect(result).toEqual(trace);
    expect(mockRepo.findOne).toHaveBeenCalledWith({ where: { id: 'trace-1' } });
  });

  it('get 找不到时返回 null', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    expect(await service.get('nonexistent')).toBeNull();
  });

  it('list 无 kbId 返回最近 20 条', async () => {
    mockRepo.find.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    const result = await service.list();
    expect(mockRepo.find).toHaveBeenCalledWith({
      where: {},
      order: { startedAt: 'DESC' },
      take: 20,
    });
    expect(result).toHaveLength(2);
  });

  it('list 带 kbId 过滤', async () => {
    mockRepo.find.mockResolvedValue([]);
    await service.list('kb-1', 5);
    expect(mockRepo.find).toHaveBeenCalledWith({
      where: { kbId: 'kb-1' },
      order: { startedAt: 'DESC' },
      take: 5,
    });
  });
});
