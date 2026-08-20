import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 128 })
  serviceName: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ length: 128 })
  keyHash: string;

  @Column({ length: 32 })
  keyPrefix: string;

  @Column({ type: 'uuid' })
  kbId: string;

  @Column({ length: 64, nullable: true })
  creator: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'bigint', default: 0 })
  callCount: number;

  @Column({ type: 'timestamp', nullable: true })
  lastCalledAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
