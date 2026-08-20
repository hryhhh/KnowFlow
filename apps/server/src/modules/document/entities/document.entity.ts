import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type DocStatus = 'pending' | 'processing' | 'success' | 'failed';

@Entity('documents')
@Index('idx_doc_kb', ['kbId'])
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  kbId: string;

  @Column({ length: 256 })
  name: string;

  @Column({ length: 16 })
  fileType: string;

  @Column({ type: 'int', nullable: true })
  fileSize: number;

  @Column({ length: 512, nullable: true })
  filePath: string;

  @Column({ length: 64, nullable: true })
  processStrategy: string;

  @Column({ length: 32, default: 'pending' })
  status: DocStatus;

  @Column({ type: 'int', default: 0 })
  chunkCount: number;

  @Column({ length: 16, default: 'upload' })
  importMethod: string;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
