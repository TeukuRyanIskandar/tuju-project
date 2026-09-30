import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Free-tier domain model foundation (spec 01, build ticket 01).
 *
 * Creates the shared relational model every other free-tier spec FKs to:
 * provenance-lineage root (`ingestion_runs`, single-table inheritance for the
 * synthetic run), reference entities (`sectors`/`companies`/`instruments`),
 * the sourced timelines/snapshots, disclosures, and the account-bound watchlist.
 *
 * Provenance is lineage, not a per-row column: every sourced table carries
 * `ingestion_run_id` → `ingestion_runs(id)` (ON DELETE RESTRICT, so the
 * decision-B purge deletes the rows first, then the run). Adds the `pg_trgm`
 * extension + a GIN index on instrument name columns for spec 02 fuzzy search.
 *
 * `pgcrypto` (gen_random_uuid) is already enabled by the initial schema.
 */
export class FreeTierDomainModel1727700000000 implements MigrationInterface {
  name = 'FreeTierDomainModel1727700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);

    // --- enum types (adapter-mapped stable internal vocabularies) -------------
    // Native Postgres enums give a DB-level guarantee; a later licensed feed maps
    // its own labels onto these same values (ADR-0004 sole-writer). Adding a value
    // is an explicit `ALTER TYPE ... ADD VALUE` migration, by design.
    await queryRunner.query(
      `CREATE TYPE "provenance_class" AS ENUM ('synthetic', 'aggregator', 'real')`,
    );
    await queryRunner.query(
      `CREATE TYPE "ingestion_run_kind" AS ENUM ('standard', 'synthetic')`,
    );
    await queryRunner.query(
      `CREATE TYPE "announcement_category" AS ENUM (` +
        `'FINANCIAL_RESULTS', 'ENTITLEMENT', 'SHAREHOLDING_CHANGE', 'GENERAL', ` +
        `'ADDITIONAL_LISTING', 'MEETING', 'CIRCULAR', 'ANNUAL_REPORT', 'LISTING', 'OTHER')`,
    );
    await queryRunner.query(
      `CREATE TYPE "corporate_action_type" AS ENUM ('DIVIDEND', 'BONUS', 'SPLIT', 'RIGHTS')`,
    );
    await queryRunner.query(
      `CREATE TYPE "shariah_compliance_status" AS ENUM ('COMPLIANT', 'NON_COMPLIANT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "listing_board" AS ENUM ('MAIN', 'ACE', 'LEAP')`,
    );

    // --- provenance lineage root (STI: standard + synthetic in one table) -----
    await queryRunner.query(`
      CREATE TABLE "ingestion_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "kind" "ingestion_run_kind" NOT NULL,
        "adapter" varchar(128) NOT NULL,
        "provenance_class" "provenance_class" NOT NULL,
        "ran_at" timestamptz NOT NULL,
        "seed" bigint,
        "params" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ingestion_runs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_ingestion_runs_provenance_class" ON "ingestion_runs" ("provenance_class")`,
    );

    // --- reference entities ---------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "sectors" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(128) NOT NULL,
        "subsector" varchar(128),
        "ingestion_run_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sectors" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_sectors_name" UNIQUE ("name"),
        CONSTRAINT "FK_sectors_ingestion_run" FOREIGN KEY ("ingestion_run_id")
          REFERENCES "ingestion_runs" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_sectors_ingestion_run_id" ON "sectors" ("ingestion_run_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "companies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "full_name" varchar(256) NOT NULL,
        "board" "listing_board" NOT NULL,
        "aliases" text[] NOT NULL DEFAULT '{}',
        "sector_id" uuid NOT NULL,
        "ingestion_run_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_companies" PRIMARY KEY ("id"),
        CONSTRAINT "FK_companies_sector" FOREIGN KEY ("sector_id")
          REFERENCES "sectors" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_companies_ingestion_run" FOREIGN KEY ("ingestion_run_id")
          REFERENCES "ingestion_runs" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_companies_sector_id" ON "companies" ("sector_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_companies_ingestion_run_id" ON "companies" ("ingestion_run_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "instruments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "stock_code" varchar(16) NOT NULL,
        "short_name" varchar(64) NOT NULL,
        "full_name" varchar(256) NOT NULL,
        "company_id" uuid NOT NULL,
        "ingestion_run_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_instruments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_instruments_stock_code" UNIQUE ("stock_code"),
        CONSTRAINT "FK_instruments_company" FOREIGN KEY ("company_id")
          REFERENCES "companies" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_instruments_ingestion_run" FOREIGN KEY ("ingestion_run_id")
          REFERENCES "ingestion_runs" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_instruments_company_id" ON "instruments" ("company_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_instruments_ingestion_run_id" ON "instruments" ("ingestion_run_id")`,
    );
    // pg_trgm fuzzy-search support (spec 02): GIN indexes on the name columns.
    await queryRunner.query(
      `CREATE INDEX "IDX_instruments_short_name_trgm" ON "instruments" USING gin ("short_name" gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_instruments_full_name_trgm" ON "instruments" USING gin ("full_name" gin_trgm_ops)`,
    );

    // --- sourced timelines / snapshots ---------------------------------------
    await queryRunner.query(`
      CREATE TABLE "price_bars" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "instrument_id" uuid NOT NULL,
        "trade_date" date NOT NULL,
        "open" numeric(18,6) NOT NULL,
        "high" numeric(18,6) NOT NULL,
        "low" numeric(18,6) NOT NULL,
        "close" numeric(18,6) NOT NULL,
        "volume" bigint NOT NULL,
        "ingestion_run_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_price_bars" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_price_bars_instrument_date" UNIQUE ("instrument_id", "trade_date"),
        CONSTRAINT "FK_price_bars_instrument" FOREIGN KEY ("instrument_id")
          REFERENCES "instruments" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_price_bars_ingestion_run" FOREIGN KEY ("ingestion_run_id")
          REFERENCES "ingestion_runs" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_price_bars_instrument_id" ON "price_bars" ("instrument_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_price_bars_trade_date" ON "price_bars" ("trade_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_price_bars_ingestion_run_id" ON "price_bars" ("ingestion_run_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "quarterly_financials" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL,
        "fiscal_year" int NOT NULL,
        "fiscal_quarter" smallint NOT NULL,
        "period_end" date NOT NULL,
        "revenue" numeric(20,2) NOT NULL,
        "net_profit" numeric(20,2) NOT NULL,
        "eps" numeric(18,6) NOT NULL,
        "equity" numeric(20,2) NOT NULL,
        "nta" numeric(20,2) NOT NULL,
        "intangibles" numeric(20,2) NOT NULL,
        "total_borrowings" numeric(20,2) NOT NULL,
        "ingestion_run_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_quarterly_financials" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_quarterly_financials_company_period" UNIQUE ("company_id", "fiscal_year", "fiscal_quarter"),
        CONSTRAINT "FK_quarterly_financials_company" FOREIGN KEY ("company_id")
          REFERENCES "companies" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_quarterly_financials_ingestion_run" FOREIGN KEY ("ingestion_run_id")
          REFERENCES "ingestion_runs" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_quarterly_financials_company_id" ON "quarterly_financials" ("company_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_quarterly_financials_period_end" ON "quarterly_financials" ("period_end")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_quarterly_financials_ingestion_run_id" ON "quarterly_financials" ("ingestion_run_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "fundamentals_snapshots" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL,
        "shares_outstanding" bigint NOT NULL,
        "nta_per_share" numeric(18,6) NOT NULL,
        "ttm_eps" numeric(18,6) NOT NULL,
        "ttm_revenue" numeric(20,2) NOT NULL,
        "ttm_net_profit" numeric(20,2) NOT NULL,
        "pe_ratio" numeric(18,6),
        "dividend_yield" numeric(18,6),
        "pnta_ratio" numeric(18,6),
        "roe" numeric(18,6),
        "debt_to_equity" numeric(18,6),
        "psr" numeric(18,6),
        "consecutive_growth_quarters" int NOT NULL DEFAULT 0,
        "ingestion_run_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fundamentals_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_fundamentals_snapshots_company" UNIQUE ("company_id"),
        CONSTRAINT "FK_fundamentals_snapshots_company" FOREIGN KEY ("company_id")
          REFERENCES "companies" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_fundamentals_snapshots_ingestion_run" FOREIGN KEY ("ingestion_run_id")
          REFERENCES "ingestion_runs" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_fundamentals_snapshots_ingestion_run_id" ON "fundamentals_snapshots" ("ingestion_run_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "indicator_snapshots" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "instrument_id" uuid NOT NULL,
        "latest_close" numeric(18,6) NOT NULL,
        "sma_20" numeric(18,6),
        "sma_50" numeric(18,6),
        "sma_200" numeric(18,6),
        "rsi_14" numeric(18,6),
        "macd" numeric(18,6),
        "macd_signal" numeric(18,6),
        "week52_high" numeric(18,6),
        "week52_low" numeric(18,6),
        "ingestion_run_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_indicator_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_indicator_snapshots_instrument" UNIQUE ("instrument_id"),
        CONSTRAINT "FK_indicator_snapshots_instrument" FOREIGN KEY ("instrument_id")
          REFERENCES "instruments" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_indicator_snapshots_ingestion_run" FOREIGN KEY ("ingestion_run_id")
          REFERENCES "ingestion_runs" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_indicator_snapshots_ingestion_run_id" ON "indicator_snapshots" ("ingestion_run_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "corporate_actions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL,
        "type" "corporate_action_type" NOT NULL,
        "ex_date" date NOT NULL,
        "amount" numeric(18,6),
        "ingestion_run_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_corporate_actions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_corporate_actions_company" FOREIGN KEY ("company_id")
          REFERENCES "companies" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_corporate_actions_ingestion_run" FOREIGN KEY ("ingestion_run_id")
          REFERENCES "ingestion_runs" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_corporate_actions_company_id" ON "corporate_actions" ("company_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_corporate_actions_ex_date" ON "corporate_actions" ("ex_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_corporate_actions_ingestion_run_id" ON "corporate_actions" ("ingestion_run_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "shariah_statuses" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL,
        "status" "shariah_compliance_status" NOT NULL,
        "effective_date" date NOT NULL,
        "ingestion_run_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_shariah_statuses" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_shariah_statuses_company_effective" UNIQUE ("company_id", "effective_date"),
        CONSTRAINT "FK_shariah_statuses_company" FOREIGN KEY ("company_id")
          REFERENCES "companies" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_shariah_statuses_ingestion_run" FOREIGN KEY ("ingestion_run_id")
          REFERENCES "ingestion_runs" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_shariah_statuses_company_id" ON "shariah_statuses" ("company_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_shariah_statuses_effective_date" ON "shariah_statuses" ("effective_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_shariah_statuses_ingestion_run_id" ON "shariah_statuses" ("ingestion_run_id")`,
    );

    // --- disclosures ----------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "announcements" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL,
        "category" "announcement_category" NOT NULL,
        "title" varchar(512) NOT NULL,
        "filed_at" timestamptz NOT NULL,
        "source_url" varchar(1024),
        "ai_summary" text,
        "ingestion_run_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_announcements" PRIMARY KEY ("id"),
        CONSTRAINT "FK_announcements_company" FOREIGN KEY ("company_id")
          REFERENCES "companies" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_announcements_ingestion_run" FOREIGN KEY ("ingestion_run_id")
          REFERENCES "ingestion_runs" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_announcements_company_id" ON "announcements" ("company_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_announcements_category" ON "announcements" ("category")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_announcements_filed_at" ON "announcements" ("filed_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_announcements_ingestion_run_id" ON "announcements" ("ingestion_run_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "news_articles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "headline" varchar(512) NOT NULL,
        "url" varchar(1024) NOT NULL,
        "source" varchar(128) NOT NULL,
        "published_at" timestamptz NOT NULL,
        "ingestion_run_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_news_articles" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_news_articles_url" UNIQUE ("url"),
        CONSTRAINT "FK_news_articles_ingestion_run" FOREIGN KEY ("ingestion_run_id")
          REFERENCES "ingestion_runs" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_news_articles_published_at" ON "news_articles" ("published_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_news_articles_ingestion_run_id" ON "news_articles" ("ingestion_run_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "news_article_tags" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "news_article_id" uuid NOT NULL,
        "company_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_news_article_tags" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_news_article_tags_article_company" UNIQUE ("news_article_id", "company_id"),
        CONSTRAINT "FK_news_article_tags_article" FOREIGN KEY ("news_article_id")
          REFERENCES "news_articles" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_news_article_tags_company" FOREIGN KEY ("company_id")
          REFERENCES "companies" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_news_article_tags_news_article_id" ON "news_article_tags" ("news_article_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_news_article_tags_company_id" ON "news_article_tags" ("company_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "ipo_listings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "company_name" varchar(256) NOT NULL,
        "board" "listing_board" NOT NULL,
        "listing_date" date,
        "offer_price" numeric(18,6),
        "prospectus_s3_key" varchar(512),
        "ingestion_run_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ipo_listings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ipo_listings_ingestion_run" FOREIGN KEY ("ingestion_run_id")
          REFERENCES "ingestion_runs" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_ipo_listings_listing_date" ON "ipo_listings" ("listing_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ipo_listings_ingestion_run_id" ON "ipo_listings" ("ingestion_run_id")`,
    );

    // --- account-bound (no ingestion lineage; not sourced data) ---------------
    await queryRunner.query(`
      CREATE TABLE "watchlists" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "name" varchar(128) NOT NULL DEFAULT 'My Watchlist',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_watchlists" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_watchlists_user_id" ON "watchlists" ("user_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "watchlist_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "watchlist_id" uuid NOT NULL,
        "instrument_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_watchlist_items" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_watchlist_items_watchlist_instrument" UNIQUE ("watchlist_id", "instrument_id"),
        CONSTRAINT "FK_watchlist_items_watchlist" FOREIGN KEY ("watchlist_id")
          REFERENCES "watchlists" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_watchlist_items_instrument" FOREIGN KEY ("instrument_id")
          REFERENCES "instruments" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_watchlist_items_watchlist_id" ON "watchlist_items" ("watchlist_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_watchlist_items_instrument_id" ON "watchlist_items" ("instrument_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse dependency order.
    await queryRunner.query(`DROP TABLE "watchlist_items"`);
    await queryRunner.query(`DROP TABLE "watchlists"`);
    await queryRunner.query(`DROP TABLE "ipo_listings"`);
    await queryRunner.query(`DROP TABLE "news_article_tags"`);
    await queryRunner.query(`DROP TABLE "news_articles"`);
    await queryRunner.query(`DROP TABLE "announcements"`);
    await queryRunner.query(`DROP TABLE "shariah_statuses"`);
    await queryRunner.query(`DROP TABLE "corporate_actions"`);
    await queryRunner.query(`DROP TABLE "indicator_snapshots"`);
    await queryRunner.query(`DROP TABLE "fundamentals_snapshots"`);
    await queryRunner.query(`DROP TABLE "quarterly_financials"`);
    await queryRunner.query(`DROP TABLE "price_bars"`);
    await queryRunner.query(`DROP TABLE "instruments"`);
    await queryRunner.query(`DROP TABLE "companies"`);
    await queryRunner.query(`DROP TABLE "sectors"`);
    await queryRunner.query(`DROP TABLE "ingestion_runs"`);

    // Enum types (dropped after every table that references them is gone).
    await queryRunner.query(`DROP TYPE "listing_board"`);
    await queryRunner.query(`DROP TYPE "shariah_compliance_status"`);
    await queryRunner.query(`DROP TYPE "corporate_action_type"`);
    await queryRunner.query(`DROP TYPE "announcement_category"`);
    await queryRunner.query(`DROP TYPE "ingestion_run_kind"`);
    await queryRunner.query(`DROP TYPE "provenance_class"`);
    // pg_trgm left installed — it is an extension, not owned by this schema.
  }
}
