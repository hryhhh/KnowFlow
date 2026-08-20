import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsageLogService } from './usage-log.service.js';
import type { UsageType } from './entities/usage-log.entity.js';

function makeMockRepo() {
  const records: any[] = [];
  return {
    insert: vi.fn(async (data: any) => {
      records.push({ ...data, id: `log-${Date.now()}-${Math.random()}` });
      return { raw: [], generatedMaps: [] };
    }),
    createQueryBuilder: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getRawMany: vi.fn().mockResolvedValue([]),
    })),
    _records: records,
  };
}

function buildService(mockRepo: any) {
  return new UsageLogService(mockRepo);
}

describe('UsageLogService', () => {
  let mockRepo: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo = makeMockRepo();
  });

  it('records a chat call', async () => {
    const service = buildService(mockRepo);
    await service.record({ type: 'chat', kbId: 'kb-1', duration: 1500, status: 'success' });
    expect(mockRepo.insert).toHaveBeenCalledOnce();
    const call = mockRepo.insert.mock.calls[0][0];
    expect(call.type).toBe('chat');
    expect(call.kbId).toBe('kb-1');
    expect(call.duration).toBe(1500);
  });

  it('defaults missing fields', async () => {
    const service = buildService(mockRepo);
    await service.record({ type: 'retrieval' });
    const call = mockRepo.insert.mock.calls[0][0];
    expect(call.duration).toBe(0);
    expect(call.status).toBe('success');
    expect(call.triggeredLlmArbitration).toBe(false);
    expect(call.composeUsedRagPriority).toBe(false);
  });

  it('records agent call with orchestration metadata', async () => {
    const service = buildService(mockRepo);
    await service.record({
      type: 'agent',
      kbId: 'kb-1',
      traceId: 'trace-abc',
      triggeredLlmArbitration: true,
      ragIncludedBy: 'strict_rule',
      composeUsedRagPriority: true,
      llmArbitrationAgent: 'ragflow',
      duration: 2000,
      status: 'success',
    });
    const call = mockRepo.insert.mock.calls[0][0];
    expect(call.triggeredLlmArbitration).toBe(true);
    expect(call.ragIncludedBy).toBe('strict_rule');
    expect(call.llmArbitrationAgent).toBe('ragflow');
  });

  it('records error status', async () => {
    const service = buildService(mockRepo);
    await service.record({ type: 'api', status: 'error', duration: 100 });
    const call = mockRepo.insert.mock.calls[0][0];
    expect(call.status).toBe('error');
  });

  it('getTrends returns empty array when no logs', async () => {
    const service = buildService(mockRepo);
    const trends = await service.getTrends();
    expect(trends).toHaveLength(7);
    trends.forEach((t) => {
      expect(t.apiCalls).toBe(0);
      expect(t.retrievalCalls).toBe(0);
      expect(t.chatCalls).toBe(0);
    });
  });

  it('getTrends maps log data to date series', async () => {
    // Use today's date to match the date range computed by getTrends
    const today = new Date().toISOString().slice(0, 10);
    const qbMock = {
      select: vi.fn().mockReturnThis(),
      addSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getRawMany: vi
        .fn()
        .mockResolvedValue([{ date: today, apiCalls: '5', retrievalCalls: '3', chatCalls: '10' }]),
    };
    mockRepo.createQueryBuilder = vi.fn().mockReturnValue(qbMock);

    const service = buildService(mockRepo);
    const trends = await service.getTrends();
    expect(trends.length).toBe(7);
    // Today should have the recorded values
    const todayEntry = trends[trends.length - 1];
    expect(todayEntry.apiCalls).toBe(5);
    expect(todayEntry.retrievalCalls).toBe(3);
    expect(todayEntry.chatCalls).toBe(10);
  });

  it('supports all usage types', async () => {
    const service = buildService(mockRepo);
    for (const type of ['chat', 'retrieval', 'api', 'agent'] as UsageType[]) {
      mockRepo._records.length = 0;
      await service.record({ type, kbId: 'kb-1' });
      expect(mockRepo.insert).toHaveBeenCalled();
    }
  });
});
