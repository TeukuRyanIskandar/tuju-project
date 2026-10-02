import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MarketIndex / IndexLevel model additions (spec 05, ticket 01).
 *
 * The additive pair the market-overview surface introduces on top of the
 * spec-01 model — entities only, no behaviour (adapters/computation/reads are
 * tickets 02–05):
 *
 * - `market_indices` — the reference entity naming an index: the FBM KLCI
 *   analogue `headline` row plus one `sector` row per Bursa `Sector` (the
 *   `kind` discriminator, Sector FK on the sector rows only). Membership is
 *   derived, never stored. Natural key `(kind, sector_id)` with
 *   `NULLS NOT DISTINCT` (PG15+; the stack runs PG16 — the `ipo_listings`
 *   precedent) so the headline row (`sector_id` NULL) also re-ingests as an
 *   in-place upsert.
 * - `index_levels` — one level per index per day, the daily series parallel to
 *   price bars. Natural key `(index_id, level_date)`: a re-ingest updates the
 *   level in place with stable row ids (the re-ingest-idempotency lesson,
 *   free-tier-data ticket 05).
 *
 * Both FK `ingestion_runs(id)` ON DELETE RESTRICT like every sourced row —
 * provenance is lineage, so a synthetic run's levels are purgeable by run
 * (decision B: delete rows first, keep the lineage).
 */
export class MarketIndexModel1728000000000 implements MigrationInterface {
  name = 'MarketIndexModel1728000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- enum type (adapter-mapped stable internal vocabulary) ---------------
    await queryRunner.query(
      `CREATE TYPE "market_index_kind" AS ENUM ('headline', 'sector')`,
    );

    // --- reference entity (headline + per-Sector) ----------------------------
    await queryRunner.query(`
      CREATE TABLE "market_indices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "kind" "market_index_kind" NOT NULL,
        "name" varchar(128) NOT NULL,
        "sector_id" uuid,
        "ingestion_run_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_market_indices" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_market_indices_kind_sector" UNIQUE NULLS NOT DISTINCT ("kind", "sector_id"),
        CONSTRAINT "FK_market_indices_sector" FOREIGN KEY ("sector_id")
          REFERENCES "sectors" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_market_indices_ingestion_run" FOREIGN KEY ("ingestion_run_id")
          REFERENCES "ingestion_runs" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_market_indices_kind" ON "market_indices" ("kind")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_market_indices_sector_id" ON "market_indices" ("sector_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_market_indices_ingestion_run_id" ON "market_indices" ("ingestion_run_id")`,
    );

    // --- daily level series (parallel to price bars) --------------------------
    await queryRunner.query(`
      CREATE TABLE "index_levels" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "index_id" uuid NOT NULL,
        "level_date" date NOT NULL,
        "level" numeric(18,6) NOT NULL,
        "ingestion_run_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_index_levels" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_index_levels_index_date" UNIQUE ("index_id", "level_date"),
        CONSTRAINT "FK_index_levels_index" FOREIGN KEY ("index_id")
          REFERENCES "market_indices" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_index_levels_ingestion_run" FOREIGN KEY ("ingestion_run_id")
          REFERENCES "ingestion_runs" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_index_levels_index_id" ON "index_levels" ("index_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_index_levels_level_date" ON "index_levels" ("level_date")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_index_levels_ingestion_run_id" ON "index_levels" ("ingestion_run_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse dependency order; the enum drops after every table using it.
    await queryRunner.query(`DROP TABLE "index_levels"`);
    await queryRunner.query(`DROP TABLE "market_indices"`);
    await queryRunner.query(`DROP TYPE "market_index_kind"`);
  }
}
