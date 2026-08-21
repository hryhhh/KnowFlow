import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashboardService } from './dashboard.service.js';

function makeMockRepo() {
  return {
    count: vi.fn().mockResolvedValue(0),
    find: vi.fn().mockResolvedValue([]),
    createQueryBuilder: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValue(null),
      getRawMany: vi.fn().mockResolvedValue([]),
    })),
  };
}

function makeMockUsageLog() {
  return {
    getTrends: vi.fn().mockResolvedValue([]),
  };
}

describe('DashboardService', () => {
  let kbRepo: any;
  let docRepo: any;
  let chunkRepo: any;
  let usageLog: ReturnType<typeof makeMockUsageLog>;
  let service: DashboardService;

  beforeEach(() => {
    vi.clearAllMocks();
    kbRepo = makeMockRepo();
    docRepo = makeMockRepo();
    chunkRepo = makeMockRepo();
    usageLog = makeMockUsageLog();
    service = new DashboardService(kbRepo, docRepo, chunkRepo, usageLog);
  });

  it('getSummary returns correct counts from all repos', async () => {
    kbRepo.count.mockResolvedValue(3);
    docRepo.count.mockImplementation((opts?: any) => {
      if (opts && opts.where && opts.where.status === 'processing') return Promise.resolve(2);
      if (opts && opts.where && opts.where.status === 'failed') return Promise.resolve(1);
      return Promise.resolve(12);
    });
    chunkRepo.count.mockResolvedValue(100);

    const result = await service.getSummary();
    expect(result.knowledgeBaseCount).toBe(3);
    expect(result.documentCount).toBe(12);
    expect(result.chunkCount).toBe(100);
    expect(result.processingCount).toBe(2);
    expect(result.errorCount).toBe(1);
  });

  it('calculates storageUsage based on chunkCount', async () => {
    chunkRepo.count.mockResolvedValue(200);
    const result = await service.getSummary();
    expect(result.storageUsage).toBe('100.0 MB');
  });

  it('sets activeKbCount equal to kbCount', async () => {
    kbRepo.count.mockResolvedValue(5);
    const result = await service.getSummary();
    expect(result.activeKbCount).toBe(5);
  });

  it('getUsageTrends delegates to usageLog.getTrends()', async () => {
    usageLog.getTrends.mockResolvedValue([{ date: '2026-01-01', apiCalls: 10 }]);
    const result = await service.getUsageTrends();
    expect(result).toEqual([{ date: '2026-01-01', apiCalls: 10 }]);
    expect(usageLog.getTrends).toHaveBeenCalledOnce();
  });

  it('getRecentActivities returns combined KB and doc items sorted desc', async () => {
    const now = new Date();
    kbRepo.find.mockResolvedValue([
      { id: 'kb-1', name: 'KB One', createdAt: new Date(now.getTime() - 1000) },
    ]);
    docRepo.find.mockResolvedValue([
      { id: 'd1', name: 'doc1.pdf', status: 'success', createdAt: now },
      {
        id: 'd2',
        name: 'doc2.pdf',
        status: 'processing',
        createdAt: new Date(now.getTime() - 500),
      },
    ]);

    const result = await service.getRecentActivities();
    expect(result.items).toHaveLength(3);
    // newest first
    expect(new Date(result.items[0].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(result.items[1].createdAt).getTime(),
    );
  });

  it('getRecentActivities limits to 8 items', async () => {
    kbRepo.find.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        id: `kb-${i}`,
        name: `KB ${i}`,
        createdAt: new Date(),
      })),
    );
    docRepo.find.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        id: `d-${i}`,
        name: `doc${i}.pdf`,
        status: 'success',
        createdAt: new Date(),
      })),
    );

    const result = await service.getRecentActivities();
    expect(result.items.length).toBeLessThanOrEqual(8);
  });

  it('getRecentActivities sets agent field correctly for docs', async () => {
    docRepo.find.mockResolvedValue([
      { id: 'd1', name: 'doc1.pdf', status: 'success', createdAt: new Date() },
      { id: 'd2', name: 'doc2.pdf', status: 'failed', createdAt: new Date() },
    ]);
    kbRepo.find.mockResolvedValue([]);

    const result = await service.getRecentActivities();
    const docItems = result.items.filter((i: any) => i.type === 'doc');
    expect(docItems[0].agent).toBe('Loader');
    expect(docItems[1].agent).toBe('系统');
  });

  it('getRecentActivities returns empty array when no data', async () => {
    kbRepo.find.mockResolvedValue([]);
    docRepo.find.mockResolvedValue([]);

    const result = await service.getRecentActivities();
    expect(result.items).toHaveLength(0);
  });
});
