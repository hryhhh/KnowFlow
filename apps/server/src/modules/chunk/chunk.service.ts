import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chunk } from './entities/chunk.entity';
import { Document } from '../document/entities/document.entity';

export interface ChunkCard {
  id: string;
  index: number;
  title: string;
  contentPreview: string;
  sourceFile: string;
  tokenCount: number;
  updatedAt: string;
}

@Injectable()
export class ChunkService {
  constructor(
    @InjectRepository(Chunk)
    private readonly chunkRepo: Repository<Chunk>,
    @InjectRepository(Document)
    private readonly docRepo: Repository<Document>,
  ) {}

  async findByDoc(
    docId: string,
    pageSize = 10,
    page = 1,
  ): Promise<{ total: number; items: ChunkCard[] }> {
    const [items, total] = await this.chunkRepo.findAndCount({
      where: { docId },
      order: { chunkIndex: 'ASC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    });
    return { total, items: items.map((c) => this.toCard(c)) };
  }

  async findOne(chunkId: string): Promise<ChunkCard> {
    const c = await this.chunkRepo.findOne({ where: { id: chunkId } });
    if (!c) throw new NotFoundException(`切片不存在: ${chunkId}`);
    return this.toCard(c);
  }

  async findByKb(
    kbId: string,
    pageSize = 10,
    page = 1,
  ): Promise<{ total: number; items: ChunkCard[] }> {
    const [items, total] = await this.chunkRepo.findAndCount({
      where: { kbId },
      order: { docId: 'ASC', chunkIndex: 'ASC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    });
    return { total, items: items.map((c) => this.toCard(c)) };
  }

  async create(docId: string, content: string, title?: string): Promise<ChunkCard> {
    const doc = await this.docRepo.findOne({ where: { id: docId } });
    if (!doc) throw new NotFoundException(`文档不存在: ${docId}`);

    const maxIndex = await this.chunkRepo
      .createQueryBuilder('chunk')
      .select('MAX(chunk.chunkIndex)', 'max')
      .where('chunk.docId = :docId', { docId })
      .getRawOne();

    const newChunk = this.chunkRepo.create({
      docId,
      kbId: doc.kbId,
      chunkIndex: parseInt(maxIndex.max ?? '0', 10) + 1,
      content,
      title: title || `切片 ${parseInt(maxIndex.max ?? '0', 10) + 1}`,
      tokenCount: Math.ceil(content.length / 1.5),
      sourceFile: doc.name,
    });

    const saved = await this.chunkRepo.save(newChunk);
    return this.toCard(saved);
  }

  async update(chunkId: string, content: string, title?: string): Promise<ChunkCard> {
    const chunk = await this.chunkRepo.findOne({ where: { id: chunkId } });
    if (!chunk) throw new NotFoundException(`切片不存在: ${chunkId}`);

    chunk.content = content;
    chunk.tokenCount = Math.ceil(content.length / 1.5);
    if (title) chunk.title = title;
    await this.chunkRepo.save(chunk);
    return this.toCard(chunk);
  }

  async remove(chunkId: string): Promise<void> {
    const chunk = await this.chunkRepo.findOne({ where: { id: chunkId } });
    if (!chunk) throw new NotFoundException(`切片不存在: ${chunkId}`);
    await this.chunkRepo.remove(chunk);
  }

  private toCard(c: Chunk): ChunkCard {
    return {
      id: c.id,
      index: c.chunkIndex,
      title: c.title || `doc_${c.docId.slice(0, 8)}-${c.chunkIndex}`,
      contentPreview: c.content,
      sourceFile: c.sourceFile ?? '',
      tokenCount: c.tokenCount,
      updatedAt: this.fmt(c.createdAt),
    };
  }

  private fmt(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}
