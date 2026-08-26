import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type DocStatus = 'pending' | 'processing' | 'success' | 'failed';
export type DocProcessingStage =
  'queued' | 'parsing' | 'chunking' | 'embedding' | 'persisting' | 'completed';

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

  /** 处理进度，范围 0-100 */
  @Column({ type: 'int', default: 0 })
  progress: number;

  /** 当前处理阶段 */
  @Column({ length: 32, nullable: true })
  processingStage: DocProcessingStage;

  /** BullMQ job ID，用于取消或删除活跃任务 */
  @Column({ length: 256, nullable: true })
  jobId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
