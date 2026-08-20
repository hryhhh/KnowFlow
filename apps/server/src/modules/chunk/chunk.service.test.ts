import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChunkService } from './chunk.service.js';

function makeMockRepo(
  findOneResult: any = null,
  saveResult: any = null,
  findResult: any[] = [],
  countResult: number = 0,
) {
  return {
    findOne: vi.fn().mockResolvedValue(findOneResult),
    save: vi.fn().mockImplementation(async (entity: any) => {
      return (
        saveResult ?? {
          ...entity,
          id: entity.id ?? `chunk-${Date.now()}`,
          createdAt: entity.createdAt ?? new Date(),
        }
      );
    }),
    create: vi.fn((entity: any) => entity),
    findAndCount: vi.fn().mockResolvedValue([findResult, countResult]),
    remove: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValue({ max: '2' }),
      getRawMany: vi.fn().mockResolvedValue([]),
    })),
  };
}

describe('ChunkService', () => {
  let chunkRepo: any;
  let docRepo: any;
  let service: ChunkService;

  beforeEach(() => {
    vi.clearAllMocks();
    chunkRepo = makeMockRepo();
    docRepo = makeMockRepo();
    // Re-bind save after clearAllMocks resets the mock
    const makeSaved = (entity: any) => ({
      ...entity,
      id: entity.id ?? `chunk-${Date.now()}`,
      createdAt: entity.createdAt ?? new Date(),
    });
    chunkRepo.save = vi
      .fn()
      .mockImplementation((entity: any) => Promise.resolve(makeSaved(entity)));
    service = Object.create(ChunkService.prototype);
    service.chunkRepo = chunkRepo;
    service.docRepo = docRepo;
  });

  it('finds chunks by docId with pagination', async () => {
    const chunks = [
      {
        id: 'c1',
        docId: 'd1',
        kbId: 'kb-1',
        chunkIndex: 0,
        content: 'chunk1',
        title: 'C1',
        tokenCount: 5,
        sourceFile: 'test.pdf',
        createdAt: new Date(),
      },
      {
        id: 'c2',
        docId: 'd1',
        kbId: 'kb-1',
        chunkIndex: 1,
        content: 'chunk2',
        title: 'C2',
        tokenCount: 3,
        sourceFile: 'test.pdf',
        createdAt: new Date(),
      },
    ];
    chunkRepo.findAndCount.mockResolvedValue([chunks, 2]);

    const result = await service.findByDoc('d1', 10, 1);
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].index).toBe(0);
  });

  it('returns empty chunks for non-existent doc', async () => {
    chunkRepo.findAndCount.mockResolvedValue([[], 0]);
    const result = await service.findByDoc('nonexistent');
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it('finds a single chunk by ID', async () => {
    const chunk = {
      id: 'c1',
      docId: 'd1',
      kbId: 'kb-1',
      chunkIndex: 0,
      content: 'test',
      title: 'Test',
      tokenCount: 3,
      sourceFile: 'f.pdf',
      createdAt: new Date(),
    };
    chunkRepo.findOne.mockResolvedValue(chunk);
    const result = await service.findOne('c1');
    expect(result.id).toBe('c1');
    expect(result.contentPreview).toBe('test');
    expect(typeof result.updatedAt).toBe('string');
  });

  it('throws NotFoundException for missing chunk', async () => {
    chunkRepo.findOne.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toThrow('切片不存在');
  });

  it('creates a chunk with auto-incremented index', async () => {
    const doc = { id: 'd1', kbId: 'kb-1', name: 'test.pdf' };
    docRepo.findOne.mockResolvedValue(doc);
    chunkRepo.createQueryBuilder.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValue({ max: '2' }),
    });

    const result = await service.create('d1', 'New chunk content');
    expect(result.index).toBe(3);
    expect(result.tokenCount).toBeGreaterThan(0);
    expect(result.title).toContain('切片');
  });

  it('updates chunk content and tokenCount', async () => {
    const chunk = {
      id: 'c1',
      docId: 'd1',
      kbId: 'kb-1',
      chunkIndex: 0,
      content: 'old',
      title: 'Old',
      tokenCount: 2,
      sourceFile: 'f.pdf',
      createdAt: new Date(),
    };
    chunkRepo.findOne.mockResolvedValue(chunk);

    const result = await service.update('c1', 'updated content');
    expect(result.contentPreview).toBe('updated content');
    expect(result.tokenCount).toBeGreaterThan(2);
  });

  it('throws NotFoundException when updating missing chunk', async () => {
    chunkRepo.findOne.mockResolvedValue(null);
    await expect(service.update('missing', 'content')).rejects.toThrow('切片不存在');
  });

  it('removes a chunk', async () => {
    const chunk = { id: 'c1', chunkIndex: 0, createdAt: new Date() };
    chunkRepo.findOne.mockResolvedValue(chunk);
    await service.remove('c1');
    expect(chunkRepo.remove).toHaveBeenCalledWith(chunk);
  });

  it('throws NotFoundException when removing missing chunk', async () => {
    chunkRepo.findOne.mockResolvedValue(null);
    await expect(service.remove('missing')).rejects.toThrow('切片不存在');
  });

  it('creates chunk fails when document not found', async () => {
    docRepo.findOne.mockResolvedValue(null);
    await expect(service.create('nonexistent', 'content')).rejects.toThrow('文档不存在');
  });

  it('finds chunks by kbId with pagination', async () => {
    const chunks = [
      {
        id: 'c1',
        docId: 'd1',
        kbId: 'kb-1',
        chunkIndex: 0,
        content: 'x',
        title: 'C1',
        tokenCount: 1,
        sourceFile: 'f.pdf',
        createdAt: new Date(),
      },
    ];
    chunkRepo.findAndCount.mockResolvedValue([chunks, 1]);
    const result = await service.findByKb('kb-1', 10, 1);
    expect(result.total).toBe(1);
  });

  it('calculates tokenCount correctly for Chinese text', async () => {
    docRepo.findOne.mockResolvedValue({ id: 'd1', kbId: 'kb-1', name: 'test.pdf' });
    chunkRepo.createQueryBuilder.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValue({ max: null }),
    });
    chunkRepo.findOne.mockImplementation((q: any) => {
      if (q?.where?.id) {
        return Promise.resolve({
          id: 'chunk-888',
          docId: 'd1',
          kbId: 'kb-1',
          chunkIndex: 0,
          content: '中文测试文本',
          title: '切片 1',
          tokenCount: Math.ceil('中文测试文本'.length / 1.5),
          sourceFile: 'test.pdf',
          createdAt: new Date(),
        });
      }
      return Promise.resolve(null);
    });
    const result = await service.create('d1', '中文测试文本');
    expect(result.tokenCount).toBe(4);
  });
});
