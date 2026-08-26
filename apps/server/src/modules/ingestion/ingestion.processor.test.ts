import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PROCESS_DOCUMENT_JOB_NAME } from './ingestion.constants.js';

// Hoist all mocks to module scope so they survive vi.mock closures
const _hoisted = vi.hoisted(() => ({
  ingestDocument: vi.fn(),
  deleteByDocId: vi.fn().mockResolvedValue({ deleted: 0 }),
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('@nestjs/bullmq', () => ({
  Processor: () => () => {},
  OnWorkerEvent: () => () => {},
  InjectQueue: () => () => {},
  WorkerHost: class WorkerHost {},
}));

vi.mock('node:fs', () => ({
  existsSync: _hoisted.existsSync,
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('iconv-lite', () => ({
  decode: vi.fn((buf: Buffer) => buf.toString('utf8')),
}));

vi.mock('@knowbase-x/rag-engine', () => ({
  ingestDocument: (...args: any[]) => _hoisted.ingestDocument(...args),
  deleteByDocId: (...args: any[]) => _hoisted.deleteByDocId(...args),
}));

describe('IngestionProcessor', () => {
  let processor: any;
  let docRepo: any;
  let chunkRepo: any;
  let ingestionQueue: any;
  let ragConfig: any;
  const {
    ingestDocument: ingestDocumentMock,
    deleteByDocId: deleteByDocIdMock,
    existsSync: existsSyncMock,
  } = _hoisted;

  beforeEach(async () => {
    vi.clearAllMocks();
    ingestDocumentMock.mockClear();
    deleteByDocIdMock.mockClear();
    existsSyncMock.mockReturnValue(true);

    docRepo = {
      findOne: vi.fn(), // Will be set per-test via mockReturnValue or mockImplementation
      save: vi.fn().mockImplementation(async (doc: any) => doc),
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    chunkRepo = {
      findOne: vi.fn(),
      save: vi.fn().mockImplementation(async (c: any) => c),
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
      remove: vi.fn().mockResolvedValue(undefined),
      create: vi.fn((entity: any) => entity),
    };
    ingestionQueue = {
      enqueue: vi.fn().mockResolvedValue('job-123'),
      removeJob: vi.fn().mockResolvedValue(undefined),
    };
    ragConfig = {
      pg: { host: 'localhost', port: 5432, user: 'test', password: 'test', database: 'test' },
      pgTableName: 'langchainjs',
      chunkSize: 1000,
      chunkOverlap: 200,
    };

    const { IngestionProcessor } = await import('./ingestion.processor.js');
    processor = Object.create(IngestionProcessor.prototype);
    processor.docRepo = docRepo;
    processor.chunkRepo = chunkRepo;
    processor.ingestionQueue = ingestionQueue;
    processor.ragConfig = ragConfig;
    processor.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  });

  function makeDoc(status: string, docId = 'doc-123', kbId = 'kb-1') {
    return {
      id: docId,
      kbId,
      name: 'test.pdf',
      status,
      progress: status === 'processing' ? 0 : 100,
      processingStage: status === 'processing' ? 'queued' : 'completed',
      jobId: 'job-123',
      filePath: `/uploads/${kbId}/test.pdf`,
      chunkCount: status === 'success' ? 5 : 0,
      errorMessage: '',
    };
  }

  function makeJob(data: any, attemptsMade = 1) {
    return {
      data,
      attemptsMade,
      opts: { attempts: 3 },
      name: PROCESS_DOCUMENT_JOB_NAME,
      updateProgress: vi.fn().mockResolvedValue(undefined),
    };
  }

  describe('success path', () => {
    it('updates stages parsing -> chunking -> embedding -> persisting -> completed', async () => {
      const doc = makeDoc('processing');
      docRepo.findOne.mockResolvedValue(doc);
      ingestDocumentMock.mockResolvedValue({ chunkCount: 3, chunks: [] });

      const job = makeJob({
        docId: 'doc-123',
        kbId: 'kb-1',
        filePath: '/uploads/kb-1/test.pdf',
        fileType: 'pdf',
        parseStrategy: 'basic',
        originalName: 'test.pdf',
      });

      await processor.process(job);

      expect(ingestDocumentMock).toHaveBeenCalledWith(
        '/uploads/kb-1/test.pdf',
        'kb-1',
        expect.any(Object),
        'basic',
        undefined,
        'doc-123',
        expect.any(Function),
      );
      expect(doc.status).toBe('success');
      expect(doc.progress).toBe(100);
      expect(doc.processingStage).toBe('completed');
    });
  });

  describe('retry idempotency', () => {
    it('deletes previous vectors and chunks on retry (attempt > 1)', async () => {
      const doc = makeDoc('processing');
      // Use mockReturnValue so findOne always returns THE SAME doc object
      docRepo.findOne.mockReturnValue(doc);
      ingestDocumentMock.mockResolvedValue({ chunkCount: 2, chunks: [] });
      deleteByDocIdMock.mockResolvedValue({ deleted: 5 });

      const job = makeJob(
        {
          docId: 'doc-123',
          kbId: 'kb-1',
          filePath: '/uploads/kb-1/test.pdf',
          fileType: 'pdf',
          parseStrategy: 'basic',
          originalName: 'test.pdf',
        },
        2,
      );

      await processor.process(job);

      // Cleanup ran (progress reset to 0) then success path set it back to 100
      expect(deleteByDocIdMock).toHaveBeenCalledWith(expect.any(Object), 'langchainjs', 'doc-123');
      expect(chunkRepo.delete).toHaveBeenCalledWith({ docId: 'doc-123' });
      expect(doc.status).toBe('success');
      expect(doc.progress).toBe(100);
      expect(doc.processingStage).toBe('completed');
    });

    it('same docId executed twice does not produce duplicate data', async () => {
      // Create a fresh doc for this test — mockReturnValue so all findOne calls see the same object
      const doc = makeDoc('processing');
      docRepo.findOne.mockReturnValue(doc);
      ingestDocumentMock.mockResolvedValue({ chunkCount: 2, chunks: [] });
      deleteByDocIdMock.mockResolvedValue({ deleted: 0 });

      // First execution (attempt 1) — no cleanup
      const job1 = makeJob({
        docId: 'doc-123',
        kbId: 'kb-1',
        filePath: '/uploads/kb-1/test.pdf',
        fileType: 'pdf',
        parseStrategy: 'basic',
        originalName: 'test.pdf',
      });
      await processor.process(job1);
      expect(deleteByDocIdMock).not.toHaveBeenCalled();
      // After first run, doc is now 'success'
      expect(doc.status).toBe('success');

      // Reset doc to 'processing' for second execution (retry scenario)
      doc.status = 'processing';
      doc.progress = 0;
      doc.processingStage = 'queued';

      // Second execution (attempt 2, retry) — cleanup runs first
      const job2 = makeJob(
        {
          docId: 'doc-123',
          kbId: 'kb-1',
          filePath: '/uploads/kb-1/test.pdf',
          fileType: 'pdf',
          parseStrategy: 'basic',
          originalName: 'test.pdf',
        },
        2,
      );
      await processor.process(job2);
      // Cleanup ran (attempt > 1)
      expect(deleteByDocIdMock).toHaveBeenCalledTimes(1);
      expect(chunkRepo.delete).toHaveBeenCalledWith({ docId: 'doc-123' });
      // Then success path ran
      expect(doc.status).toBe('success');
      expect(doc.progress).toBe(100);
    });
  });

  describe('concurrent protection', () => {
    it('skips processing if document is not in processing status', async () => {
      const doc = makeDoc('success');
      docRepo.findOne.mockResolvedValue(doc);
      ingestDocumentMock.mockResolvedValue({ chunkCount: 0, chunks: [] });

      const job = makeJob({
        docId: 'doc-123',
        kbId: 'kb-1',
        filePath: '/uploads/kb-1/test.pdf',
        fileType: 'pdf',
        parseStrategy: 'basic',
        originalName: 'test.pdf',
      });

      await processor.process(job);
      expect(ingestDocumentMock).not.toHaveBeenCalled();
    });

    it('skips processing if document no longer exists', async () => {
      docRepo.findOne.mockResolvedValue(null);
      ingestDocumentMock.mockResolvedValue({ chunkCount: 0, chunks: [] });

      const job = makeJob({
        docId: 'doc-999',
        kbId: 'kb-1',
        filePath: '/uploads/kb-1/test.pdf',
        fileType: 'pdf',
        parseStrategy: 'basic',
        originalName: 'test.pdf',
      });

      await processor.process(job);
      expect(ingestDocumentMock).not.toHaveBeenCalled();
    });
  });

  describe('unrecoverable errors', () => {
    it('marks failed immediately for file not found', async () => {
      existsSyncMock.mockReturnValue(false);
      const doc = makeDoc('processing');
      docRepo.findOne.mockResolvedValue(doc);

      const job = makeJob({
        docId: 'doc-123',
        kbId: 'kb-1',
        filePath: '/uploads/kb-1/nonexistent.pdf',
        fileType: 'pdf',
        parseStrategy: 'basic',
        originalName: 'nonexistent.pdf',
      });

      await expect(processor.process(job)).rejects.toThrow('文件不存在');
      expect(doc.status).toBe('failed');
    });

    it('marks failed for unsupported format', async () => {
      const doc = makeDoc('processing');
      docRepo.findOne.mockResolvedValue(doc);
      ingestDocumentMock.mockRejectedValue(new Error('格式不支持：未知文件类型'));

      const job = makeJob({
        docId: 'doc-123',
        kbId: 'kb-1',
        filePath: '/uploads/kb-1/test.xyz',
        fileType: 'other',
        parseStrategy: 'basic',
        originalName: 'test.xyz',
      });

      await expect(processor.process(job)).rejects.toThrow('格式不支持');
      expect(doc.status).toBe('failed');
    });
  });

  describe('retryable errors', () => {
    it('keeps document as processing when embedding fails', async () => {
      const doc = makeDoc('processing');
      docRepo.findOne.mockResolvedValue(doc);
      ingestDocumentMock.mockRejectedValue(new Error('embedding service timeout'));

      const job = makeJob({
        docId: 'doc-123',
        kbId: 'kb-1',
        filePath: '/uploads/kb-1/test.pdf',
        fileType: 'pdf',
        parseStrategy: 'basic',
        originalName: 'test.pdf',
      });

      await expect(processor.process(job)).rejects.toThrow('embedding service timeout');
      expect(doc.status).toBe('processing');
    });
  });

  describe('onFailed event handler', () => {
    it('marks document as failed when attempts exceed max', async () => {
      const doc = makeDoc('processing');
      docRepo.findOne.mockResolvedValue(doc);

      const job = { data: { docId: 'doc-123' }, attemptsMade: 3, opts: { attempts: 3 } };
      const err = new Error('final failure');

      await processor.onFailed(job as any, err);
      expect(doc.status).toBe('failed');
      expect(doc.errorMessage).toBe('final failure');
    });

    it('does NOT mark as failed when attempts not exceeded', async () => {
      const doc = makeDoc('processing');
      docRepo.findOne.mockResolvedValue(doc);

      const job = { data: { docId: 'doc-123' }, attemptsMade: 1, opts: { attempts: 3 } };
      const err = new Error('temporary error');

      await processor.onFailed(job as any, err);
      expect(doc.status).toBe('processing');
    });
  });
});
