import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('chunks')
@Index('idx_chunk_doc', ['docId'])
@Index('idx_chunk_kb', ['kbId'])
export class Chunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  docId: string;

  @Column({ type: 'uuid' })
  kbId: string;

  @Column({ type: 'int' })
  chunkIndex: number;

  @Column({ type: 'text', nullable: true })
  content: string;

  @Column({ length: 256, nullable: true })
  title: string;

  @Column({ type: 'int', default: 0 })
  tokenCount: number;

  @Column({ length: 256, nullable: true })
  sourceFile: string;

  /**
   * pipeline 注入的 UUID，与 sparseSearch 返回的 metadata.chunkId 一致，
   * 用于 dense/sparse 两路结果的关联融合。
   */
  @Column({ type: 'text', nullable: true })
  chunkId: string;

  /**
   * tsvector 列，用于 PostgreSQL 全文检索（TSV 向量）。
   * 由 ingest pipeline 在文本处理后写入。
   */
  @Column({ type: 'tsvector', nullable: true })
  tsv: any;

  @CreateDateColumn()
  createdAt: Date;
}
