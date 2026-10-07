import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Prospectus at-a-glance result index (spec 06, ticket 05; free-tier-ai-showcase).
 *
 * `prospectus_analyses` is the claim-check index-of-record for the flagship
 * `analyze-prospectus` job — a thin row keyed (unique) by the analysed
 * `ipo_listings` row, holding the verdict-less headline + the S3 pointer to the
 * rich artifact (ADR-0004 §4). Row-exists == analysed, which is the
 * not-yet-processed predicate behind the `enqueue-prospectus` ops command.
 */
export class ProspectusAnalysis1728200000000 implements MigrationInterface {
  name = 'ProspectusAnalysis1728200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "prospectus_analyses" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "prospectus_id" uuid NOT NULL,
        "correlation_id" uuid NOT NULL,
        "job_id" varchar(255) NOT NULL,
        "headline" text NOT NULL,
        "as_of" timestamptz NOT NULL,
        "artifact_bucket" varchar(255) NOT NULL,
        "artifact_key" varchar(512) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_prospectus_analyses" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_prospectus_analyses_prospectus_id" UNIQUE ("prospectus_id"),
        CONSTRAINT "FK_prospectus_analyses_prospectus" FOREIGN KEY ("prospectus_id")
          REFERENCES "ipo_listings" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_prospectus_analyses_correlation_id" ON "prospectus_analyses" ("correlation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_prospectus_analyses_job_id" ON "prospectus_analyses" ("job_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "prospectus_analyses"`);
  }
}
