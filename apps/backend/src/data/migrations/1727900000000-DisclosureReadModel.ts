import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Disclosure read-model additions (spec 04, ticket 01).
 *
 * Two additive columns the announcement/news read surface (spec 04) needs on
 * top of the spec-01 model:
 *
 * - `announcements.ai_summary_as_of` — when the optional AI summary was
 *   generated. Spec 04 owns the FIELD (null until spec 06's job populates
 *   `ai_summary`); it is never set by the adapter or the ingest worker.
 * - `news_article_tags.matched_alias` — the alias that whole-word-matched the
 *   headline (auditability, spec 04 §2). Added NOT NULL: the tagger introduced
 *   by this ticket is the only writer of the table (it is empty everywhere),
 *   and it always knows the alias that matched.
 */
export class DisclosureReadModel1727900000000 implements MigrationInterface {
  name = 'DisclosureReadModel1727900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "announcements" ADD "ai_summary_as_of" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "news_article_tags" ADD "matched_alias" varchar(256) NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "news_article_tags" DROP COLUMN "matched_alias"`,
    );
    await queryRunner.query(
      `ALTER TABLE "announcements" DROP COLUMN "ai_summary_as_of"`,
    );
  }
}
