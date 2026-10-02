import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Market-brief model addition (spec 06, ticket 02; free-tier-ai-showcase).
 *
 * `market_briefs` is the claim-check index-of-record for the daily market
 * brief — the same shape as the scaffold's `analysis_results` table (ADR-0004
 * §4), keyed by `brief_date` so a same-day re-run upserts in place (ADR-0007
 * §2 idempotency). The announcement-summaries showcase (ticket 03) needs no
 * migration: it writes into the existing `announcements.ai_summary` /
 * `ai_summary_as_of` columns (spec 04, already present).
 */
export class ShowcaseJobsModel1728100000000 implements MigrationInterface {
  name = 'ShowcaseJobsModel1728100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "market_briefs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "correlation_id" uuid NOT NULL,
        "job_id" varchar(255) NOT NULL,
        "brief_date" date NOT NULL,
        "headline" text NOT NULL,
        "as_of" timestamptz NOT NULL,
        "artifact_bucket" varchar(255) NOT NULL,
        "artifact_key" varchar(512) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_market_briefs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_market_briefs_brief_date" UNIQUE ("brief_date")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_market_briefs_correlation_id" ON "market_briefs" ("correlation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_market_briefs_job_id" ON "market_briefs" ("job_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "market_briefs"`);
  }
}
