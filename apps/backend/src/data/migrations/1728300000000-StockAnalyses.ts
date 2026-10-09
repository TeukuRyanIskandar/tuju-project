import type { MigrationInterface, QueryRunner } from 'typeorm';

export class StockAnalyses1728300000000 implements MigrationInterface {
  name = 'StockAnalyses1728300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "stock_analysis_status" AS ENUM (
        'pending',
        'running',
        'ready',
        'facts_only',
        'failed',
        'stale'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "technical_analyses" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "instrument_id" uuid NOT NULL,
        "status" "stock_analysis_status" NOT NULL,
        "headline" text,
        "as_of" timestamptz,
        "artifact_bucket" varchar(255),
        "artifact_key" varchar(512),
        "error_message" text,
        "correlation_id" uuid NOT NULL,
        "job_id" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_technical_analyses" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_technical_analyses_instrument_id" UNIQUE ("instrument_id"),
        CONSTRAINT "FK_technical_analyses_instrument" FOREIGN KEY ("instrument_id")
          REFERENCES "instruments" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_technical_analyses_correlation_id" ON "technical_analyses" ("correlation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_technical_analyses_job_id" ON "technical_analyses" ("job_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "fundamental_analyses" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "instrument_id" uuid NOT NULL,
        "status" "stock_analysis_status" NOT NULL,
        "headline" text,
        "as_of" timestamptz,
        "artifact_bucket" varchar(255),
        "artifact_key" varchar(512),
        "error_message" text,
        "correlation_id" uuid NOT NULL,
        "job_id" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fundamental_analyses" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_fundamental_analyses_instrument_id" UNIQUE ("instrument_id"),
        CONSTRAINT "FK_fundamental_analyses_instrument" FOREIGN KEY ("instrument_id")
          REFERENCES "instruments" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_fundamental_analyses_correlation_id" ON "fundamental_analyses" ("correlation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fundamental_analyses_job_id" ON "fundamental_analyses" ("job_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "fundamental_analyses"`);
    await queryRunner.query(`DROP TABLE "technical_analyses"`);
    await queryRunner.query(`DROP TYPE "stock_analysis_status"`);
  }
}
