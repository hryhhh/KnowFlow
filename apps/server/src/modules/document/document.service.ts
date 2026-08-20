import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as iconv from 'iconv-lite';
import { Document } from './entities/document.entity';
import { Chunk } from '../chunk/entities/chunk.entity';
import { detectFileType, ingestDocument } from '@knowbase-x/rag-engine';
import type { RAGPipelineConfig, ParseStrategy } from '@knowbase-x/rag-engine';
import { RAG_CONFIG } from '../../config/rag-config.provider';

export interface DocListItem {
  id: string;
  kbId: string;
  name: string;
  status: string;
  strategy: string;
  chunkCount: number;
  importMethod: string;
  updatedAt: string;
  actions: string[];
}

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');

function decodeFilename(name: string): string {
  const buffer = Buffer.from(name, 'binary');
  const utf8 = buffer.toString('utf8');
  if (utf8.includes('\uFFFD')) {
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
  ) {}

  /** 上传并处理文档（同步执行摄入流程） */
  async upload(
    kbId: string,
    file: { originalname: string; buffer: Buffer; size: number },
    processStrategy?: string,
  ): Promise<{ code: number; data: DocListItem }> {
    if (!file) throw new BadRequestException('未接收到文件');
    const decodedName = decodeFilename(file.originalname);
    const fileType = detectFileType(decodedName);

    const savedPath = this.saveFile(kbId, decodedName, file.buffer);

    // 默认使用 MinerU Agent 轻量解析 API；可指定 mineru（自托管）或 basic（兜底）
    const parseStrategy: ParseStrategy =
      processStrategy === 'mineru' || processStrategy === 'mineru-agent'
        ? processStrategy
        : 'mineru-agent';

    const doc = this.docRepo.create({
      kbId,
      name: decodedName,
      fileType,
      fileSize: file.size,
      filePath: savedPath,
      processStrategy: processStrategy ?? 'default',
      status: 'processing',
      importMethod: 'upload',
      chunkCount: 0,
    });
    await this.docRepo.save(doc);

    try {
      const { chunkCount, chunks } = await ingestDocument(
        savedPath,
        kbId,
        this.ragConfig,
        parseStrategy,
      );

      // 落库切片元信息
      const chunkEntities = chunks.map((c, i) =>
        this.chunkRepo.create({
          docId: doc.id,
          kbId,
          chunkIndex: i,
          content: c.content,
          tokenCount: c.tokenCount,
          sourceFile: (c.metadata.source as string) ?? decodedName,
        }),
      );
      await this.chunkRepo.save(chunkEntities);

      doc.status = 'success';
      doc.chunkCount = chunkCount;
      await this.docRepo.save(doc);
    } catch (err) {
      doc.status = 'failed';
      doc.errorMessage = err instanceof Error ? err.message : String(err);
      await this.docRepo.save(doc);
    }

    return { code: 0, data: this.toListItem(doc) };
  }

  async findAll(kbId: string, search?: string): Promise<DocListItem[]> {
    const qb = this.docRepo.createQueryBuilder('doc').where('doc.kbId = :kbId', { kbId });
    if (search) qb.andWhere('doc.name ILIKE :s', { s: `%${search}%` });
    const list = await qb.orderBy('doc.createdAt', 'DESC').getMany();
    return list.map((d) => this.toListItem(d));
  }

  async remove(docId: string): Promise<{ success: boolean }> {
    const doc = await this.docRepo.findOne({ where: { id: docId } });
    if (!doc) throw new NotFoundException(`文档不存在: ${docId}`);
    await this.chunkRepo.delete({ docId });
    await this.docRepo.remove(doc);
    return { success: true };
  }

  private saveFile(kbId: string, originalname: string, buffer: Buffer): string {
    const dir = path.join(UPLOAD_ROOT, kbId);
    fs.mkdirSync(dir, { recursive: true });
    const safe = originalname.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
    const fileName = `${Date.now()}_${safe}`;
    const full = path.join(dir, fileName);
    fs.writeFileSync(full, buffer);
    return full;
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
      updatedAt: this.fmt(d.updatedAt),
      actions: ['切片详情'],
    };
  }

  private fmt(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}
