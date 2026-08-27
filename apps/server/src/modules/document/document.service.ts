import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as iconv from 'iconv-lite';
import { Document } from './entities/document.entity';
import { Chunk } from '../chunk/entities/chunk.entity';
import { IngestionQueue } from '../ingestion/ingestion.queue';
import { DOCUMENT_INGEST_QUEUE_NAME } from '../ingestion/ingestion.constants';
import { RAG_CONFIG } from '../../config/rag-config.provider';
import type { RAGPipelineConfig } from '@knowbase-x/rag-engine';
import { RetrievalCacheService } from '../retrieval/retrieval-cache.service';

export interface DocListItem {
  id: string;
  kbId: string;
  name: string;
  status: string;
  strategy: string;
  chunkCount: number;
  importMethod: string;
  progress: number;
  processingStage?: string;
  errorMessage?: string;
  updatedAt: string;
  actions: string[];
}

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');
const VALID_PARSE_STRATEGIES = ['basic', 'mineru', 'mineru-agent'];

function decodeFilename(name: string): string {
  const buffer = Buffer.from(name, 'binary');
  const utf8 = buffer.toString('utf8');
  if (utf8.includes('�')) {
    try {
      return iconv.decode(buffer, 'gbk');
    } catch {
      return utf8;
    }
  }
  return utf8;
}

@Injectable()
export class DocumentService {
  constructor(
    @Inject(RAG_CONFIG) private readonly ragConfig: RAGPipelineConfig,
    @InjectRepository(Document)
    private readonly docRepo: Repository<Document>,
    @InjectRepository(Chunk)
    private readonly chunkRepo: Repository<Chunk>,
    private readonly ingestionQueue: IngestionQueue,
    private readonly retrievalCache: RetrievalCacheService,
  ) {}

  /**
   * 上传文档并异步入队处理
   *
   * 流程：校验文件 → 保存文件 → 创建文档记录 → 入队 → 返回文档信息
   * 若任一步骤失败，执行补偿删除
   */
  async upload(
    kbId: string,
    file: { originalname: string; buffer: Buffer; size: number },
    processStrategy?: string,
  ): Promise<{ code: number; data: DocListItem }> {
    if (!file) throw new BadRequestException('未接收到文件');
    if (file.size === 0) throw new BadRequestException('文件大小为 0');

    const decodedName = decodeFilename(file.originalname);
    const fileType = this.detectFileType(decodedName);

    // 验证解析策略
    const parseStrategy = this.validateParseStrategy(processStrategy);

    let savedPath: string | null = null;
    let doc: Document | null = null;

    try {
      // 1. 保存文件
      savedPath = this.saveFile(kbId, decodedName, file.buffer);

      // 2. 创建文档记录（状态 processing）
      doc = this.docRepo.create({
        kbId,
        name: decodedName,
        fileType,
        fileSize: file.size,
        filePath: savedPath,
        processStrategy: parseStrategy,
        status: 'processing',
        progress: 0,
        processingStage: 'queued',
        importMethod: 'upload',
        chunkCount: 0,
      });
      doc = await this.docRepo.save(doc);

      // 3. 入队（不在 DB 事务内，最终一致性补偿）
      const jobId = await this.ingestionQueue.enqueue({
        docId: doc.id,
        kbId,
        filePath: savedPath,
        fileType,
        parseStrategy,
        originalName: decodedName,
      });

      // 4. 写回 jobId
      doc.jobId = jobId;
      await this.docRepo.save(doc);
    } catch (err) {
      // 补偿逻辑：独立 try/catch，不掩盖原始错误
      try {
        await this.compensate(savedPath, doc?.id ?? null);
      } catch (compErr) {
        // eslint-disable-next-line no-console
        console.error('[DocumentService] 补偿失败', {
          compErr,
          docId: doc?.id,
          filePath: savedPath,
        });
      }
      throw err;
    }

    return { code: 0, data: this.toListItem(doc) };
  }

  async findAll(kbId: string, search?: string): Promise<DocListItem[]> {
    const qb = this.docRepo.createQueryBuilder('doc').where('doc.kbId = :kbId', { kbId });
    if (search) qb.andWhere('doc.name ILIKE :s', { s: `%${search}%` });
    const list = await qb.orderBy('doc.createdAt', 'DESC').getMany();
    return list.map((d) => this.toListItem(d));
  }

  async remove(
    docId: string,
    callerKbId: string,
  ): Promise<{ success: boolean; errors?: string[] }> {
    const doc = await this.docRepo.findOne({ where: { id: docId } });
    if (!doc) throw new NotFoundException(`文档不存在: ${docId}`);

    // 校验 kbId 防止跨知识库删除
    if (doc.kbId !== callerKbId) {
      throw new BadRequestException('无权删除此文档');
    }

    const errors: string[] = [];

    // ① 取消 BullMQ job
    if (doc.jobId) {
      try {
        await this.ingestionQueue.removeJob(doc.jobId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`取消 job 失败: ${msg}`);
      }
    }

    // ② 删除 PGVector 向量
    try {
      const { deleteByDocId } = await import('@knowbase-x/rag-engine');
      await deleteByDocId(this.ragConfig.pg, this.ragConfig.pgTableName, docId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`清理向量失败: ${msg}`);
    }

    // ③ 删除 chunks 和文档记录
    try {
      await this.chunkRepo.delete({ docId });
      await this.docRepo.remove(doc);
      // 失效该 kbId 下的检索缓存
      this.retrievalCache.invalidateByKbId(doc.kbId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`删除记录失败: ${msg}`);
    }

    // ④ 删除上传文件
    if (doc.filePath) {
      try {
        fs.unlinkSync(doc.filePath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`删除文件失败: ${msg}`);
      }
    }

    return { success: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  private saveFile(kbId: string, originalname: string, buffer: Buffer): string {
    const dir = path.join(UPLOAD_ROOT, kbId);
    fs.mkdirSync(dir, { recursive: true });
    const safe = originalname.replace(/[^a-zA-Z0-9一-龥._-]/g, '_');
    const fileName = `${Date.now()}_${safe}`;
    const full = path.join(dir, fileName);
    fs.writeFileSync(full, buffer);
    return full;
  }

  private detectFileType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
      case '.pdf':
        return 'pdf';
      case '.doc':
      case '.docx':
        return 'word';
      case '.csv':
        return 'csv';
      case '.xlsx':
      case '.xls':
        return 'xlsx';
      default:
        return 'other';
    }
  }

  private validateParseStrategy(strategy?: string): string {
    if (strategy && VALID_PARSE_STRATEGIES.includes(strategy)) {
      return strategy;
    }
    return 'mineru-agent'; // 默认策略
  }

  /**
   * 补偿函数：当上传流程失败时清理已创建的资源
   */
  private async compensate(filePath: string | null, docId: string | null): Promise<void> {
    const cleanupTasks: Promise<void>[] = [];

    // 删除文件
    if (filePath) {
      cleanupTasks.push(
        new Promise<void>((resolve) => {
          fs.unlink(filePath, (err) => {
            if (err)
              /* eslint-disable-next-line no-console */
              console.error('[DocumentService] 补偿删除文件失败:', filePath, err);
            resolve();
          });
        }),
      );
    }

    // 删除文档记录
    if (docId) {
      cleanupTasks.push(
        this.docRepo.findOne({ where: { id: docId } }).then((foundDoc) => {
          if (foundDoc) {
            void this.docRepo.remove(foundDoc);
          }
        }),
      );
    }

    await Promise.all(cleanupTasks);
  }

  private toListItem(d: Document): DocListItem {
    return {
      id: d.id,
      kbId: d.kbId,
      name: d.name,
      status: d.status,
      strategy: d.processStrategy ?? '',
      chunkCount: d.chunkCount,
      importMethod: d.importMethod === 'upload' ? '本地上传' : 'URL',
      progress: d.progress ?? 0,
      processingStage: d.processingStage ?? undefined,
      errorMessage: d.errorMessage || undefined,
      updatedAt: this.fmt(d.updatedAt),
      actions: ['切片详情'],
    };
  }

  private fmt(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}
