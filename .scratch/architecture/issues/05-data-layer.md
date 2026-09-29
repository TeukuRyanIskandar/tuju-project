# Decide: data layer — database, market-data landing, caching

Type: grilling
Status: resolved
Blocked by: (none)

## Question

Decide the data layer for Product A.

Must settle:

- **Primary database** (e.g. Postgres) and ORM/query approach on the NestJS side.
- **Where market/fundamental data feeds land** — ingested into our DB, cached, or proxied live? How the dashboard's aggregated views (IPO calendar, prices, top-5 movers, watchlist) are served.
- **Caching strategy** for hot/expensive data (prices, computed TA/FA results).
- **Where AI job results are persisted** and how the FE reads them.
- Time-series considerations for price data (does it warrant anything beyond Postgres for Product A? keep lean).

Output: an ADR recording the data-layer choices. Architecture must not preclude Products B/C later.


## Answer

Recorded as [ADR-0004](../../../docs/adr/0004-data-layer-postgres-typeorm-hybrid-ingestion-s3-claimcheck.md). Informed by research ticket 09.

1. **DB + ORM:** Postgres + **TypeORM** (`@nestjs/typeorm`, first-party, tracks NestJS v11), pinned as a version-set to avoid the historical TypeORM drift. Entities live in `apps/backend`, not `packages/contracts` (DB schema ≠ cross-language wire contract).
2. **Data landing:** hybrid, **licensing-driven** — KLSE data is licensed content, so Postgres = system of record for what we're licensed to persist (EODHD commercial EOD + fundamentals + self-sourced IPO/prospectus). Scheduled/staggered ingest, source-adapter seam. Live intraday is a **deferred, ephemeral Redis-only layer** (cannot be persisted by licence). IPO/prospectus via scrape/scheduled-ingest. **NestJS sole Postgres writer; Python stateless.**
3. **Caching:** Redis, three classes (read-through AI results, aggregated dashboard views, deferred live layer), never a system of record; cold-rebuildable from Postgres.
4. **AI result persistence:** **claim-check over BullMQ** — Python writes full artifact to **S3** + returns pointer + tiny inline summary; NestJS persists pointer/metadata to Postgres (Postgres = index, S3 = blob store) and **proxies** full-artifact reads to the FE (fetch-time authz/audit/revocation; presigned kept as reversible future swap). Summary path needs neither S3 nor queue when a fresh result exists.
5. **Time-series:** plain Postgres, no TSDB for Product A (Timescale noted for Product C only).

**Handoff to ticket 08:** the exact field schema of the S3 pointer + inline summary + progress/failure schemas belongs to the job contract (08), not re-decided here.
**Feeds ticket 07:** object storage (MinIO/S3/R2) is a new infra dependency to provision per environment.
