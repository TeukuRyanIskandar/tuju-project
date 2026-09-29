import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema — the one trivial migration that proves the migration wiring
 * (ADR-0004). Creates `analysis_results`, the Postgres index-of-record for the
 * S3 claim-check pointer + inline summary. NestJS is the sole writer.
 */
export class InitialSchema1727600000000 implements MigrationInterface {
  name = 'InitialSchema1727600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE EXTENSION IF NOT EXISTS "pgcrypto"`,
    );
    await queryRunner.query(`
      CREATE TABLE "analysis_results" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "correlation_id" uuid NOT NULL,
        "job_id" varchar(255) NOT NULL,
        "symbol" varchar(64) NOT NULL,
        "verdict" varchar(32) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_analysis_results" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_analysis_results_correlation_id" ON "analysis_results" ("correlation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_analysis_results_job_id" ON "analysis_results" ("job_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_analysis_results_job_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_analysis_results_correlation_id"`,
    );
    await queryRunner.query(`DROP TABLE "analysis_results"`);
  }
}
