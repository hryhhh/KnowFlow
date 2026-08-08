import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
} from "typeorm";

@Entity("chunks")
@Index("idx_chunk_doc", ["docId"])
@Index("idx_chunk_kb", ["kbId"])
export class Chunk {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  docId: string;

  @Column({ type: "uuid" })
  kbId: string;

  @Column({ type: "int" })
  chunkIndex: number;

  @Column({ type: "text" })
  content: string;

  @Column({ length: 256, nullable: true })
  title: string;

  @Column({ type: "int", default: 0 })
  tokenCount: number;

  @Column({ length: 256, nullable: true })
  sourceFile: string;

  @CreateDateColumn()
  createdAt: Date;
}
