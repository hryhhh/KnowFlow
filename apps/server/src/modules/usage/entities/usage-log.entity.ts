import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

export type UsageType = "chat" | "retrieval" | "api";

@Entity("usage_logs")
export class UsageLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** 调用类型：chat / retrieval / api */
  @Column({ length: 32 })
  type: UsageType;

  /** 关联的知识库 ID，API 调用时为 apiKey */
  @Column({ type: "varchar", length: 64, nullable: true })
  kbId: string | null;

  /** API Key ID（仅 api 类型有值） */
  @Column({ type: "varchar", length: 64, nullable: true })
  apiKeyId: string | null;

  /** 调用耗时（毫秒） */
  @Column({ type: "int", default: 0 })
  duration: number;

  /** 调用结果：success / error */
  @Column({ length: 16, default: "success" })
  status: string;

  @CreateDateColumn()
  createdAt: Date;
}
