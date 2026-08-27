import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentService } from './document.service.js';

// Mock rag-engine before importing DocumentService
vi.mock('@knowbase-x/rag-engine', () => ({
  deleteByDocId: vi.fn().mockResolvedValue({ deleted: 1 }),
}));

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
  unlinkSync: vi.fn(),
}));

// Mock iconv-lite
vi.mock('iconv-lite', () => ({
  decode: vi.fn((buf: Buffer) => buf.toString('utf8')),
}));

describe('DocumentService', () => {
  let docRepo: any;
  let chunkRepo: any;
  let ingestionQueue: any;
  let retrievalCache: any;
  let service: DocumentService;

  beforeEach(() => {
    vi.clearAllMocks();
    docRepo = makeMockRepo();
    chunkRepo = makeMockRepo();
    ingestionQueue = {
      enqueue: vi.fn().mockResolvedValue('job-123'),
      removeJob: vi.fn().mockResolvedValue(undefined),
    };
    retrievalCache = {
      invalidateByKbId: vi.fn().mockResolvedValue(undefined),
    };
    // Create service with mocked dependencies (bypass DI)
    service = Object.create(DocumentService.prototype);
    service.docRepo = docRepo;
    service.chunkRepo = chunkRepo;
    service.ingestionQueue = ingestionQueue;
    service.retrievalCache = retrievalCache;
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
      pgTableName: 'langchainjs',
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

  it('removes a document and its chunks with proper kbId validation', async () => {
    const doc = {
      id: 'd1',
      kbId: 'kb-1',
      name: 'test.pdf',
      status: 'success',
      jobId: 'job-123',
      filePath: '/uploads/kb-1/test.pdf',
    };
    docRepo.findOne.mockResolvedValue(doc);
    // Mock unlinkSync to avoid filesystem errors in tests
    const mockFs = await import('node:fs');
    vi.mocked(mockFs.unlinkSync).mockImplementation(() => {});

    const result = await service.remove('d1', 'kb-1');
    expect(result.success).toBe(true);
    expect(ingestionQueue.removeJob).toHaveBeenCalledWith('job-123');
    expect(chunkRepo.delete).toHaveBeenCalledWith({ docId: 'd1' });
    expect(docRepo.remove).toHaveBeenCalledWith(doc);
  });

  it('throws BadRequestException when trying to delete document from wrong kb', async () => {
    const doc = { id: 'd1', kbId: 'kb-1', name: 'test.pdf', status: 'success' };
    docRepo.findOne.mockResolvedValue(doc);

    await expect(service.remove('d1', 'kb-2')).rejects.toThrow('无权删除此文档');
  });

  it('throws NotFoundException for non-existent document', async () => {
    docRepo.findOne.mockResolvedValue(null);
    await expect(service.remove('nonexistent', 'kb-1')).rejects.toThrow('文档不存在');
  });

  it('creates a processing document and enqueues without ingesting synchronously', async () => {
    const mockDoc = {
      id: 'doc-123',
      kbId: 'kb-1',
      name: 'test.pdf',
      fileType: 'pdf',
      fileSize: 1024,
      filePath: '/uploads/kb-1/test.pdf',
      processStrategy: 'basic',
      status: 'processing',
      progress: 0,
      processingStage: 'queued',
      importMethod: 'upload',
      chunkCount: 0,
      jobId: null,
      errorMessage: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    docRepo.create.mockReturnValue(mockDoc);
    docRepo.save.mockImplementation(async (entity: any) => {
      return { ...mockDoc, id: entity.id ?? 'doc-123' };
    });
    ingestionQueue.enqueue.mockResolvedValue('job-123');

    const file = { originalname: 'test.pdf', buffer: Buffer.from('test'), size: 1024 };
    const result = await service.upload('kb-1', file, 'basic');

    expect(ingestionQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kbId: 'kb-1',
        parseStrategy: 'basic',
      }),
    );
    expect(result.data.status).toBe('processing');
    expect(result.data.progress).toBe(0);
    expect(result.data.processingStage).toBe('queued');
  });
});
