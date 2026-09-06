import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * usage_logs.traceId 加宽到 64：系统同时存在 16 位 nanoid 与 36 位 UUID 两种
 * trace 标识（agent_traces 主键即 UUID），32 位会导致合法值写入失败。
 */
export class WidenUsageTraceId1722400001 implements MigrationInterface {
  name = 'WidenUsageTraceId1722400001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "usage_logs" ALTER COLUMN "traceId" TYPE varchar(64)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "usage_logs" ALTER COLUMN "traceId" TYPE varchar(32)`);
  }
}
