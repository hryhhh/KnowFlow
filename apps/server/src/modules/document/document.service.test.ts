import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentService } from './document.service.js';

function makeMockRepo(
  findOneResult: any = null,
  saveResult: any = null,
  findResult: any[] = [],
  countResult: number = 0,
) {
  return {
    findOne: vi.fn().mockResolvedValue(findOneResult),
    save: vi.fn().mockImplementation(async (entity: any) => {
      return saveResult ?? { ...entity, id: entity.id ?? `doc-${Date.now()}` };
    }),
    create: vi.fn((entity: any) => entity),
    find: vi.fn().mockResolvedValue(findResult),
    count: vi.fn().mockResolvedValue(countResult),
    remove: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue(findResult),
      getOne: vi.fn().mockResolvedValue(findOneResult),
    })),
  };
}

// Mock fs to avoid writing real files
vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
  statSync: vi.fn(),
  rmSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  createReadStream: vi.fn(),
}));

// Mock iconv-lite
vi.mock('iconv-lite', () => ({
  decode: vi.fn((buf: Buffer) => buf.toString('utf8')),
}));

describe('DocumentService', () => {
  let docRepo: any;
  let chunkRepo: any;
  let service: DocumentService;

  beforeEach(() => {
    vi.clearAllMocks();
    docRepo = makeMockRepo();
    chunkRepo = makeMockRepo();
    // Create service with mocked RAG_CONFIG via constructor injection simulation
    service = Object.create(DocumentService.prototype);
    service.docRepo = docRepo;
    service.chunkRepo = chunkRepo;
    service.ragConfig = {
      pg: { host: 'localhost', port: 5432, user: 'test', password: 'test', database: 'test' },
      llm: { apiKey: 'test', model: 'gpt-4', baseURL: 'https://api.test.com' },
      embedding: {
        apiKey: 'test',
        model: 'text-embedding-3-small',
        baseURL: 'https://api.test.com',
        dimensions: 3,
      },
      chunkSize: 1000,
      chunkOverlap: 200,
    };
  });

  it('finds documents by kbId', async () => {
    const docs = [
      {
        id: 'd1',
        kbId: 'kb-1',
        name: 'doc1.pdf',
        status: 'success',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    docRepo.find = vi.fn().mockResolvedValue(docs);
    docRepo.createQueryBuilder.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue(docs),
    });

    const result = await service.findAll('kb-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('d1');
  });

  it('returns empty array when no documents', async () => {
    docRepo.createQueryBuilder.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    });
    const result = await service.findAll('kb-1');
    expect(result).toHaveLength(0);
  });

  it('searches documents by name pattern', async () => {
    docRepo.createQueryBuilder.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    });
    await service.findAll('kb-1', 'test');
    expect(docRepo.createQueryBuilder().andWhere).toHaveBeenCalled();
  });

  it('removes a document and its chunks', async () => {
    const doc = { id: 'd1', kbId: 'kb-1', name: 'test.pdf', status: 'success' };
    docRepo.findOne.mockResolvedValue(doc);

    const result = await service.remove('d1');
    expect(result.success).toBe(true);
    expect(chunkRepo.delete).toHaveBeenCalledWith({ docId: 'd1' });
    expect(docRepo.remove).toHaveBeenCalledWith(doc);
  });

  it('throws NotFoundException for non-existent document', async () => {
    docRepo.findOne.mockResolvedValue(null);
    await expect(service.remove('nonexistent')).rejects.toThrow('文档不存在');
  });
});
