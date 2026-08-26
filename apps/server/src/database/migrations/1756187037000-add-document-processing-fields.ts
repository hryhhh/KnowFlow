import { MigrationInterface, QueryRunner, Table, Index } from 'typeorm';

export class AddDocumentProcessingFields1756187037000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 新增 progress 列（0-100，默认0）
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0`,
    );

    // 新增 processingStage 列（nullable）
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN "processing_stage" VARCHAR(32) DEFAULT NULL`,
    );

    // 新增 jobId 列（nullable，用于记录 BullMQ job ID）
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN "job_id" VARCHAR(256) DEFAULT NULL`,
    );

    // 为已有 success 文档填充 progress=100，其余为0（默认值已满足）
    await queryRunner.query(`UPDATE "documents" SET "progress" = 100 WHERE "status" = 'success'`);

    // 为 progress 添加索引，便于按进度筛选
    await queryRunner.query(`CREATE INDEX "idx_doc_progress" ON "documents" ("progress")`);

    // 为 jobId 添加唯一索引（同一文档只应有一个活跃 job）
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_doc_job_id_unique" ON "documents" ("job_id") WHERE "job_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_doc_progress" ON "documents"`);
    await queryRunner.query(`DROP INDEX "idx_doc_job_id_unique" ON "documents"`);
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "job_id"`);
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "processing_stage"`);
    await queryRunner.query(`ALTER TABLE "documents" DROP COLUMN "progress"`);
  }
}
