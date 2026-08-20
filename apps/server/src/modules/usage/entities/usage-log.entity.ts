import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type UsageType = 'chat' | 'retrieval' | 'api' | 'agent';

@Entity('usage_logs')
export class UsageLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 调用类型：chat / retrieval / api / agent */
  @Column({ length: 32 })
  type: UsageType;

  /** 关联的知识库 ID */
  @Column({ type: 'varchar', length: 64, nullable: true })
  kbId: string | null;

  /** API Key ID（仅 api 类型有值） */
  @Column({ type: 'varchar', length: 64, nullable: true })
  apiKeyId: string | null;

  /** 链路追踪 ID（agent 编排时填充） */
  @Column({ type: 'varchar', length: 32, nullable: true })
  traceId: string | null;

  /** 调用耗时（毫秒） */
  @Column({ type: 'int', default: 0 })
  duration: number;

  /** 调用结果：success / error */
  @Column({ length: 16, default: 'success' })
  status: string;

  /** 是否触发了 LLM 置信度仲裁 */
  @Column({ type: 'boolean', default: false })
  triggeredLlmArbitration: boolean;

  /** ragflow 被加入候选的原因：strict_rule | soft_rule | always_include | llm | none */
  @Column({ type: 'varchar', length: 32, nullable: true })
  ragIncludedBy: string | null;

  /** 合成阶段是否采用了 rag-priority 策略 */
  @Column({ type: 'boolean', default: false })
  composeUsedRagPriority: boolean;

  /** 仲裁时 LLM 返回的目标 Agent（仅仲裁触发时有值） */
  @Column({ type: 'varchar', length: 64, nullable: true })
  llmArbitrationAgent: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
