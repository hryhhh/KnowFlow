import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeBase } from './entities/knowledge-base.entity';
import { Document } from '../document/entities/document.entity';
import { Chunk } from '../chunk/entities/chunk.entity';
import { CreateKbDto, UpdateKbDto } from './dto/create-kb.dto';

export interface KbListItem {
  id: string;
  name: string;
  description: string;
  type: string;
  documentCount: number;
  chunkCount: number;
  createdAt: string;
}

@Injectable()
export class KnowledgeBaseService {
  constructor(
    @InjectRepository(KnowledgeBase)
    private readonly kbRepo: Repository<KnowledgeBase>,
    @InjectRepository(Document)
    private readonly docRepo: Repository<Document>,
    @InjectRepository(Chunk)
    private readonly chunkRepo: Repository<Chunk>,
  ) {}

  async create(dto: CreateKbDto): Promise<KnowledgeBase> {
    const exists = await this.kbRepo.findOne({ where: { name: dto.name } });
    if (exists) throw new ConflictException(`知识库名称已存在: ${dto.name}`);
    const kb = this.kbRepo.create({
      name: dto.name,
      description: dto.description,
      type: dto.type ?? 'free',
    });
    return this.kbRepo.save(kb);
  }

  async findAll(search?: string): Promise<KbListItem[]> {
    const qb = this.kbRepo.createQueryBuilder('kb');
    if (search) qb.where('kb.name ILIKE :s', { s: `%${search}%` });
    const list = await qb.orderBy('kb.createdAt', 'DESC').getMany();

    return Promise.all(list.map((kb) => this.toListItem(kb)));
  }

  async findOne(id: string): Promise<KbListItem> {
    const kb = await this.kbRepo.findOne({ where: { id } });
    if (!kb) throw new NotFoundException(`知识库不存在: ${id}`);
    return this.toListItem(kb);
  }

  async update(id: string, dto: UpdateKbDto): Promise<KnowledgeBase> {
    const kb = await this.kbRepo.findOne({ where: { id } });
    if (!kb) throw new NotFoundException(`知识库不存在: ${id}`);
    Object.assign(kb, dto);
    return this.kbRepo.save(kb);
  }

  async remove(id: string): Promise<{ success: boolean }> {
    const kb = await this.kbRepo.findOne({ where: { id } });
    if (!kb) throw new NotFoundException(`知识库不存在: ${id}`);
    await this.kbRepo.remove(kb);
    return { success: true };
  }

  private async toListItem(kb: KnowledgeBase): Promise<KbListItem> {
    const [docCount, chunkCount] = await Promise.all([
      this.docRepo.count({ where: { kbId: kb.id } }),
      this.chunkRepo.count({ where: { kbId: kb.id } }),
    ]);
    return {
      id: kb.id,
      name: kb.name,
      description: kb.description ?? '',
      type: kb.type,
      documentCount: docCount,
      chunkCount,
      createdAt: this.fmt(kb.createdAt),
    };
  }

  private fmt(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}
