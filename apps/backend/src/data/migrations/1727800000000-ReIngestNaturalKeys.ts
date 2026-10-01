import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Re-ingest idempotency natural keys (spec 01, ticket 05).
 *
 * Adds the unique constraints that make a second `runNightly()` against a
 * populated DB an idempotent upsert instead of a duplicate-key failure:
 * every nightly persists adapter output with `upsert` on these natural keys,
 * so re-ingesting the same snapshot updates rows in place (row ids stay stable,
 * lineage re-points to the fresh run) instead of colliding on the tables the
 * first four tickets already keyed (`shariah_statuses`, both snapshots,
 * `price_bars`, `quarterly_financials`, `news_articles.url`).
 *
 * The three constraints below close the silent-duplication tables the ticket
 * found (no unique key, so identical rows would silently double):
 * `announcements`, `corporate_actions`, `ipo_listings`.
 *
 * `ipo_listings` uses `NULLS NOT DISTINCT` (PG15+; the stack runs PG16) so an
 * undated (NULL listing_date) IPO row re-ingests as an update, not a duplicate.
 */
export class ReIngestNaturalKeys1727800000000 implements MigrationInterface {
  name = 'ReIngestNaturalKeys1727800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "announcements" ` +
        `ADD CONSTRAINT "UQ_announcements_company_filed_title" ` +
        `UNIQUE ("company_id", "filed_at", "title")`,
    );
    await queryRunner.query(
      `ALTER TABLE "corporate_actions" ` +
        `ADD CONSTRAINT "UQ_corporate_actions_company_type_ex_date" ` +
        `UNIQUE ("company_id", "type", "ex_date")`,
    );
    await queryRunner.query(
      `ALTER TABLE "ipo_listings" ` +
        `ADD CONSTRAINT "UQ_ipo_listings_company_name_listing_date" ` +
        `UNIQUE NULLS NOT DISTINCT ("company_name", "listing_date")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ipo_listings" ` +
        `DROP CONSTRAINT "UQ_ipo_listings_company_name_listing_date"`,
    );
    await queryRunner.query(
      `ALTER TABLE "corporate_actions" ` +
        `DROP CONSTRAINT "UQ_corporate_actions_company_type_ex_date"`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcements" ` +
        `DROP CONSTRAINT "UQ_announcements_company_filed_title"`,
    );
  }
}
