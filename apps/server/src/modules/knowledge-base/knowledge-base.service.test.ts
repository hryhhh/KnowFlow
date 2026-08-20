import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KnowledgeBaseService } from './knowledge-base.service.js';

function makeMockRepo(
  findOneResult: any = null,
  saveResult: any = null,
  countResult: number = 0,
  removeResult: any = null,
) {
  const repo = {
    findOne: vi.fn().mockResolvedValue(findOneResult),
    save: vi.fn().mockImplementation(async (entity: any) => {
      const saved = {
        ...entity,
        id: entity.id ?? `id-${Date.now()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return saveResult ?? saved;
    }),
    create: vi.fn((entity: any) => entity),
    find: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(countResult),
    remove: vi.fn().mockResolvedValue(removeResult),
    createQueryBuilder: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      addWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
      getOne: vi.fn().mockResolvedValue(findOneResult),
    })),
  };
  return repo;
}

function makeDocRepo(countResult: number = 0) {
  return {
    count: vi.fn().mockResolvedValue(countResult),
  };
}

function makeChunkRepo(countResult: number = 0) {
  return {
    count: vi.fn().mockResolvedValue(countResult),
  };
}

describe('KnowledgeBaseService', () => {
  let kbRepo: any;
  let docRepo: any;
  let chunkRepo: any;
  let service: KnowledgeBaseService;

  beforeEach(() => {
    vi.clearAllMocks();
    kbRepo = makeMockRepo();
    docRepo = makeDocRepo();
    chunkRepo = makeChunkRepo();
    service = new KnowledgeBaseService(kbRepo, docRepo, chunkRepo);
  });

  it('creates a knowledge base', async () => {
    const dto = { name: 'My KB', description: 'Test KB', type: 'free' };
    const result = await service.create(dto);
    expect(result.name).toBe('My KB');
    expect(result.type).toBe('free');
    expect(kbRepo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'My KB' }));
  });

  it('throws ConflictException on duplicate name', async () => {
    kbRepo.findOne.mockResolvedValue({ id: 'existing', name: 'My KB' });
    const dto = { name: 'My KB' };
    await expect(service.create(dto)).rejects.toThrow('知识库名称已存在');
  });

  it('throws NotFoundException for non-existent KB', async () => {
    kbRepo.findOne.mockResolvedValue(null);
    await expect(service.findOne('nonexistent')).rejects.toThrow('知识库不存在');
  });

  it('returns KB with document and chunk counts', async () => {
    const kb = { id: 'kb-1', name: 'Test KB', type: 'free', createdAt: new Date('2026-01-01') };
    kbRepo.findOne.mockResolvedValue(kb);
    docRepo.count.mockResolvedValue(5);
    chunkRepo.count.mockResolvedValue(120);

    const result = await service.findOne('kb-1');
    expect(result.name).toBe('Test KB');
    expect(result.documentCount).toBe(5);
    expect(result.chunkCount).toBe(120);
  });

  it('lists all knowledge bases', async () => {
    const kbs = [
      { id: 'kb-1', name: 'KB One', type: 'free', createdAt: new Date('2026-01-01') },
      { id: 'kb-2', name: 'KB Two', type: 'paid', createdAt: new Date('2026-01-02') },
    ];
    kbRepo.createQueryBuilder.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue(kbs),
    });
    docRepo.count.mockResolvedValue(0);
    chunkRepo.count.mockResolvedValue(0);

    const result = await service.findAll();
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('KB One');
  });

  it('searches KBs by name (case-insensitive)', async () => {
    kbRepo.createQueryBuilder.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    });

    await service.findAll('test');
    expect(kbRepo.createQueryBuilder).toHaveBeenCalled();
  });

  it('updates a knowledge base', async () => {
    const kb = {
      id: 'kb-1',
      name: 'Old Name',
      type: 'free',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    kbRepo.findOne.mockResolvedValue(kb);
    kbRepo.save.mockResolvedValue({ ...kb, name: 'New Name' });

    const result = await service.update('kb-1', { name: 'New Name' });
    expect(result.name).toBe('New Name');
  });

  it('removes a knowledge base', async () => {
    const kb = { id: 'kb-1', name: 'Test KB' };
    kbRepo.findOne.mockResolvedValue(kb);

    const result = await service.remove('kb-1');
    expect(result.success).toBe(true);
    expect(kbRepo.remove).toHaveBeenCalledWith(kb);
  });

  it('throws NotFoundException when removing non-existent KB', async () => {
    kbRepo.findOne.mockResolvedValue(null);
    await expect(service.remove('nonexistent')).rejects.toThrow('知识库不存在');
  });
});
