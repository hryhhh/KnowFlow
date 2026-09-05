import { MigrationInterface, QueryRunner } from 'typeorm';

export class AgentTraces1722400000 implements MigrationInterface {
  name = 'AgentTraces1722400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "agent_traces" (
        "id" character varying(36) NOT NULL,
        "sessionId" character varying(36) NOT NULL,
        "kbId" character varying(36) NOT NULL,
        "query" text NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'running',
        "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "completedAt" TIMESTAMP WITH TIME ZONE,
        "steps" jsonb NOT NULL DEFAULT '[]',
        "summary" jsonb,
        "tokensUsed" jsonb,
        "errorMsg" text,
        CONSTRAINT "PK_agent_traces_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_agent_traces_session" ON "agent_traces" ("sessionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_agent_traces_created" ON "agent_traces" ("startedAt" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_agent_traces_created"`);
    await queryRunner.query(`DROP INDEX "idx_agent_traces_session"`);
    await queryRunner.query(`DROP TABLE "agent_traces"`);
  }
}
