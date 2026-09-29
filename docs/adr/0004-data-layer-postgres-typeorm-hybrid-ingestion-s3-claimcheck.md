# ADR-0004: Data layer for Product A — Postgres + TypeORM, hybrid licensed-data ingestion, Redis read-through cache, S3 claim-check for AI artifacts (proxied)

- Status: Accepted
- Date: 2026-09-28
- Deciders: Bursa platform architecture effort (wayfinder map: Architecture Map — Bursa Platform (Product A))
- Context ticket: `.scratch/architecture/issues/05-data-layer.md`
- Informed by research: `.scratch/architecture/issues/09-data-source-research.md` → `docs/research/0001-bursa-market-data-sources.md`
- Builds on: [ADR-0001](0001-redis-bullmq-nestjs-python-jobbus.md) (Redis + BullMQ behind a `JobBus`), [ADR-0002](0002-monorepo-pnpm-turborepo-python-own-world.md) (`packages/contracts` as the cross-language seam), [ADR-0003](0003-async-only-transport-sync-deferred.md) (async-only transport)

## Context

Product A needs a data layer that serves the dashboard (IPO calendar, prices,
top-5 movers, watchlist), persists AI (TA/FA/doc-analysis) results, and feeds the
Python AI module — while staying lean for a warm-500 launch and not precluding
Products B/C.

Facts that fixed the decisions:

- **Postgres is the chosen primary DB**, with **TypeORM** as the ORM (the team's
  most familiar tool; `@nestjs/typeorm` is first-party and tracks NestJS's major
  version, currently v11). Known gotcha: TypeORM ↔ `@nestjs/typeorm` version
  drift (the historical 0.2→0.3 break) — pin as a version-set.
- **KLSE market data is *licensed* content** (research finding, primary source: a
  CME market-data advisory directing downstream Bursa-data consumers to be
  licensed by Bursa directly). No cheap "personal" vendor tier legally backs a
  public dashboard. This makes the data-landing posture a *licensing* decision,
  not merely a performance one.
- **Redis is already in the stack** (BullMQ, ADR-0001), so it is the natural cache
  substrate — but *what* to cache had to be pinned.
- AI results range from small TA/FA JSON to large IPO/prospectus doc-analysis
  output; the transport back from Python is constrained by ADR-0003 (async over
  BullMQ) and by the rule that **Python stays out of Postgres**.

## Decision

### 1. Primary database + ORM

**Postgres + TypeORM** via `@nestjs/typeorm`, with `typeorm` / `@nestjs/typeorm`
/ `pg` **pinned as a version-set** and upgraded together. TypeORM **entities live
in `apps/backend`**, *not* in `packages/contracts`: the DB schema and the
cross-language wire/job contract are distinct concerns. `packages/contracts`
remains solely the NestJS↔Python boundary (ADR-0002). Python never uses TypeORM.

### 2. Where market/fundamental data lands — hybrid, licensing-driven

- **Postgres is the system of record** for prices (EODHD commercial-licensed EOD),
  fundamentals, and self-sourced IPO/prospectus records.
- **Ingestion is scheduled/staggered** (nightly whole-exchange bulk EOD;
  fundamentals staggered ~35 names/day as they change quarterly), per vendor
  rate/cost limits.
- **A source-adapter seam** isolates each provider (EODHD, a future live vendor,
  the IPO/prospectus scraper) so licensing terms and vendor swaps never leak into
  the app.
- **Live intraday is a deferred, ephemeral Redis-only layer** (candidate: Twelve
  Data + redistribution add-on) — its licence *forbids* long-term persistence, so
  it can never be a Postgres table. Deferred for launch; price tiles / top-5
  movers are served from **stored EOD / last-close** to stay unambiguously within
  licence.
- **IPO calendar + prospectus** come from **scrape / scheduled-ingest** (Bursa
  site + issuing houses + aggregators), not a vendor API. Scraping is confined to
  slow-moving reference data, never priced market data.
- **NestJS is the sole Postgres writer; Python is stateless** and reads only what
  it needs (via the job payload / an API), never writing to Postgres.

### 3. Caching — Redis, three classes, never a system of record

Redis is a pure read-through / aggregation cache (plus the future live layer);
everything in it is cold-rebuildable from Postgres (except the disposable live
layer). Reuse the existing Redis instance, separated by logical DB / key prefix.

1. **Read-through AI results** — latest TA/FA summary per symbol; invalidated on
   write of a newer result.
2. **Aggregated dashboard views** — top-5 movers, IPO calendar, watchlist
   rollups; TTL of minutes–hours or invalidated on nightly ingest.
3. **Deferred live-intraday layer** — short-TTL (seconds), Redis-only by legal
   necessity, never persisted.

### 4. AI result persistence — claim-check over BullMQ, S3 blob store, proxied reads

- **Claim-check pattern:** Python writes the **full result artifact to
  S3-compatible object storage** (MinIO local / S3 or R2 prod) under a scoped
  prefix, and returns on the queue a **pointer** (`bucket`, `key`, `sha256`,
  `bytes`, `contentType`) **plus a tiny inline `summary`** for first-glance UI
  rendering. Large payloads never ride the queue.
- **Write boundary:** Python writes the *blob* to S3 (language-neutral; not a
  Postgres write, so the sole-writer rule holds). **NestJS persists the pointer +
  metadata + inline summary to Postgres** (`analysis_results`). **Postgres is the
  index of record; S3 is the blob store** — neither duplicates the other.
- **FE reads via NestJS proxy** (not presigned URLs): the FE requests the full
  artifact from NestJS, which runs the tier/entitlement check (ticket 06) then
  streams the object from S3. Chosen for **fetch-time enforcement** — mid-flight
  revocation if a tier lapses, audit of the actual open (not just a grant), and
  same-origin simplicity (no bucket CORS). Artifacts are low-MB structured JSON,
  so proxying is not a scale concern at warm-500.
- **Summary path needs neither S3 nor the queue when a fresh result exists:** the
  inline summary is served from Redis/Postgres directly.
- **Access boundary:** Python = write-only to a scoped `results/*` prefix; NestJS
  = read + lifecycle/delete + sole Postgres writer + entitlement enforcement.

### 5. Time-series

**Plain Postgres, no dedicated TSDB** for Product A. Daily OHLC + short intraday
windows for a warm-500 launch don't justify Timescale/a TSDB. Noted as a
graduation path only if Product C's heavy compute later demands it.

## Rationale

- **Familiarity + first-party support** make TypeORM the low-risk ORM; the only
  real hazard (version drift) is neutralised by pinning.
- **Licensing dominates the data-landing shape.** Because KLSE data is licensed,
  the store/proxy split is dictated by *what each vendor's terms permit us to
  persist*, not by latency. Postgres holds only what we're licensed to keep; the
  un-persistable live feed is quarantined in a disposable Redis layer.
- **The queue as blob transport is wrong; claim-check is right.** Redis/BullMQ is
  a control plane, not a blob store — putting large doc-analysis output on it
  causes memory pressure. A pointer keeps the queue lean; the inline summary keeps
  the common case fast without an S3 round-trip.
- **S3 write by Python doesn't violate the sole-writer rule**, which was about
  *Postgres*. Object storage is language-neutral and lets Python own the heavy
  write while NestJS remains the relational gatekeeper.
- **Proxy over presigned** trades a little NestJS bandwidth for fetch-time
  authz/audit/revocation and same-origin simplicity — the right governance
  posture for paid, tier-gated analyses, and cheap given low-MB artifacts.

## Consequences

**Positive**

- One relational store (Postgres) as the system of record and index; Redis stays
  a rebuildable cache; S3 handles blobs — clean separation of roles.
- Python stays stateless and out of Postgres → cleanly extractable for Products
  B/C (satisfies the standing force).
- Licensing risk is contained at the adapter/store boundary, not smeared through
  the app.
- Tier enforcement (ticket 06) lands naturally at the NestJS proxy read.

**Negative / risks**

- **Vendor cost from day one:** a public dashboard needs EODHD *commercial*
  licensing; free/personal tiers are not legal. Budget accordingly.
- NestJS is on the data path for full-artifact reads (proxy) — acceptable at
  low-MB / warm-500; **presigned URLs remain a drop-in swap** behind the same read
  endpoint if a large-payload surface (Product C) appears — the FE contract is
  unchanged either way.
- Object storage is a new infra dependency (MinIO/S3/R2) to provision in every
  environment (feeds ticket 07, deployment/runtime).

## Boundary with ticket 08 (job/result/progress contract)

This ADR decides *that* the AI result travels back as an **S3 claim-check pointer
+ inline summary** over BullMQ. The **exact field schema** of that pointer and
summary (and the progress/failure schemas) belongs to ticket 08 — recorded there,
not re-decided here.

## Alternatives considered

- **Inline results → Postgres `jsonb`, no object storage:** viable for small
  TA/FA JSON, but rejected as the general rule once the user chose object storage
  for durable output and to accommodate large doc-analysis / stored source PDFs.
- **Presigned GET URLs for FE reads:** better raw scaling (NestJS off the data
  path), rejected for v1 in favour of proxy's fetch-time enforcement; kept as a
  reversible future swap.
- **Dedicated TSDB (Timescale):** rejected for Product A as premature; noted for
  Product C.
- **Proxying live intraday into Postgres:** legally impossible under the live
  vendor's terms — hence the disposable Redis-only live layer.
- **Python writing to Postgres directly:** rejected — reintroduces a second-
  language DB access/migration story and conflicting-writer risk for no latency
  benefit (the queue hop already exists; the extra write is single-digit ms
  against seconds–minutes jobs).
