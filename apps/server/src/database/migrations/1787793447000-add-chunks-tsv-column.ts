import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChunksTsvColumn1787793447000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 添加 tsv 列 + GIN 索引
    await queryRunner.query(`ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "tsv" tsvector`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_chunks_tsv" ON "chunks" USING GIN ("tsv")`,
    );
    // 2. 添加 chunk_id 列用于跨 dense/sparse 两路关联（UUID，pipeline 注入）
    await queryRunner.query(`ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "chunk_id" text`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_chunks_chunk_id" ON "chunks" ("chunk_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_chunks_tsv" ON "chunks"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_chunks_chunk_id" ON "chunks"`);
    await queryRunner.query(`ALTER TABLE "chunks" DROP COLUMN IF EXISTS "tsv"`);
    await queryRunner.query(`ALTER TABLE "chunks" DROP COLUMN IF EXISTS "chunk_id"`);
  }
}
