# Frontend showcase — local data readiness

## Latest outcome — approved free-model execution, 2026-10-15 06:42–06:57 UTC

**Incomplete / blocked. No complete stock or prospectus selected (0/3 and 0/2;
minimum one each not met).** This supersedes earlier execution-approval gates,
not the historical evidence below. Operator explicitly approved all 115 queued
jobs and two curated prospectuses using `openrouter/free` only. No paid fallback,
force re-enqueue, purge/reset, resident ingestion or application edits occurred.
Tickets 11/13 remain outstanding; private sharing/rights review remains required.

### Execution and bounded monitoring

- Read Compose, AI Dockerfile/context, worker/model client, backend CLI and
  prospectus enqueue code first. Existing unrelated/uncommitted work preserved.
- At `06:42:15.760Z`, queue: 115 waiting (30 TA, 30 FA, 55 announcements), no
  active/completed/failed/delayed. Read-only SQL confirmed actual listing IDs and
  zero prospectus results. An initial SQL probe used camelCase column names and
  failed read-only; corrected snake_case query succeeded; no data was changed.
- Both stored PDF objects passed HEAD: Insights Analytics **2,408,406 bytes**,
  Fibromat **2,571,691 bytes**, both `application/pdf`. These are the previously
  seeded **Part-1-only** regulatory PDFs, not full multi-part prospectuses.
- `docker compose build ai-worker` succeeded with frozen uv dependencies.
  Built image: `sha256:337189b62f8d2a0bb353d4f8a7c42e8c177e0310742cff6f7fb9374dcc7a3a2e`.
- Ran `docker compose exec -T backend node dist/worker-main.js enqueue-prospectus
  094fd734-c812-4bcf-921d-72dea6f21fb6`, then the same command for
  `5a9e9d7f-97e9-4cbf-9126-98965756ef5b`. Each enqueued once at approximately
  `06:42:41Z`, with empty `alreadyInFlight`; no pre-existing results were replaced.
  Both short-lived contexts registered schedulers, but no unexpected replay tick
  appeared in their command output. No resident ingestion worker was started.
- `docker compose up -d --no-deps ai-worker` started only AI. Runtime check
  printed credential **presence only** and asserted model `openrouter/free`.
- Read-only BullMQ `Queue.getJobCounts/getJobs` checks at `06:42:50`, `06:44:31`,
  `06:46:26`, then ten checks at approximately one-minute intervals through
  `06:55:41` measured progress rather than relying on process exit status.
  At 06:42:50 all 55 announcements had completed. TA/FA calls took minutes and
  repeatedly exhausted structured-output correction, not merely a slow queue.
- Stopped with `docker compose stop -t 240 ai-worker` after persistent failures.
  Graceful shutdown let the current TA finish; container **Exited (0)**.
  At `06:56:41.411Z`: **59 completed, 9 failed, 49 waiting, 0 active/delayed**
  (also zero paused/prioritized/waiting-children). Waiting: 23 TA, 24 FA, 2
  prospectuses. Completed: 55 announcement jobs + 2 TA + 2 FA; all four TA/FA
  landed as **facts_only**, not successful narration. No failed job was retried
  manually. Retained queue states are preserved, not reset.
- Failures: TA `6888`, `6947`, `1023`, `5398`, `5819`; FA `5326`, `6888`,
  `1023`, `5819`. Each has one BullMQ attempt and terminal reason:
  `LLM output was still invalid after the corrective retries: step 'narrate':
  the model's reply was still unusable after 3 retries (Expecting value:
  line 1 column 1 (char 0))`. Bounded corrective LLM retries are distinct from
  queue attempts. Sanitized worker-log aggregation counted **52 OpenRouter HTTP
  200 responses**, 68 job starts, 59 done/artifact-written events. This does not
  prove useful model output or establish the underlying empty/invalid-response
  cause; no 429/auth/outage conclusion is warranted from this evidence.
- Final SQL confirms TA: 23 pending / 5 failed / 2 facts_only; FA: 24 pending /
  4 failed / 2 facts_only; **0 prospectus analyses**. Backend/Postgres/Redis/
  LocalStack remain healthy; both resident workers are off. BullMQ warned that
  existing Redis `allkeys-lru` policy should be `noeviction`; no config changed.

### API re-audit — 06:57:06 UTC

For all three codes, core and `series?interval=1d&range=2y` remain HTTP 200,
490 points, `2024-10-15`–`2026-10-15`, real provenance / private-demo. These
dates are stored bar dates, not proof of a completed current trading session.
All six analysis envelopes are HTTP 200 with correct code/jobName discriminants.

| Code | TA | FA | Artifact reads |
| --- | --- | --- | --- |
| `1155` MAYBANK | pending, null headline/asOf | pending, null headline/asOf | both 404, `No analysis artifact for stockCode=1155` |
| `1023` CIMB | failed, null headline/asOf | failed, null headline/asOf | both 404, `No analysis artifact for stockCode=1023`; envelopes contain terminal narration error above |
| `5326` 99SMART | **facts_only**, `facts-only: Grounding check failed.` | failed, null headline/asOf | TA 200; FA 404, `No analysis artifact for stockCode=5326` |

5326 TA is **diagnostic evidence only**, not an approved complete stock:

- Envelope `asOf`: `2026-10-15T04:25:29.756Z`; artifact `symbol: 5326`,
  `jobName: analyze-technical`, `timeframe: 1D`, `schemaVersion: technical-analysis-1`.
  Artifact `asOf`: `2026-10-15 04:25:29.756000+00:00`: same parsed instant,
  **not the contract's ISO wire format**. No artifact root headline is required.
- Artifact generation: `2026-10-15 06:45:32.611010+00:00`; source `real`,
  adapter `yfinance`, configured model `openrouter/free`, narrative language `en`.
  Text is exactly `Narrative withheld: failed the grounding check.` It must not
  be presented as generated explanatory prose. Example facts: SMA20 3.1495,
  SMA50 3.3474, RSI14 39.727682; these are not fabricated fallback narratives.
- Direct validation against built `TechnicalAnalysisArtifact` failed on `asOf`
  and `provenance.generatedAt`. Raw schema also requires cost, but the backend
  intentionally strips it: validation with `.omit({cost:true})` still fails on
  **both timestamp fields**. Two additional API reads at `06:57:19Z` reproduced
  those failures. Hence no coherence/contract approval despite instant equality.
  Scoped generation-readiness follow-up: [ticket 14](issues/14-ai-generation-readiness.md).

| Prospectus ID | Verified company / listing date | Summary + artifact |
| --- | --- | --- |
| `094fd734-c812-4bcf-921d-72dea6f21fb6` | Insights Analytics Berhad / 2025-10-27 | both 404, `No prospectus analysis yet for id=<id>` |
| `5a9e9d7f-97e9-4cbf-9126-98965756ef5b` | Fibromat (M) Berhad / 2025-05-08 | both 404, same ID-specific error |

Both prospectus jobs are **waiting, not failed or generated**. No summary/artifact
ID, generation/headline coherence, language, parse routing/truncation or financial
extraction completeness can yet be approved. Part-1-only inputs remain a hard
source limitation even after eventual generation; absent sections must not be
described as absent in the issuer's complete prospectus.

### Next decision / verification limits

Coordinator approval is required for diagnosing structured-output failures and
the timestamp serialization defect before more generation. Do not restart the
worker blindly: it will consume the remaining queue. No force retries or model
changes are authorized here. Resume/ordering decisions for the two waiting
prospectuses should be explicit. No application code changed; no unit/e2e tests
were run in this operations-only pass. Verification was Docker build, runtime
model/presence assertion, read-only SQL/queue/log checks and actual API/schema
reads. Prior backend test results below belong to the earlier preparation pass.

## Historical audit target and outcome

- Operator selected the existing local stack for ticket 01.
- Initial inspection: 2026-10-15T04:11:58Z (UTC).
- Follow-up API audit: 2026-10-15T04:17:59Z; database confirmation:
  2026-10-15T04:18:09Z (UTC).
- Workspace revision: `9f175ed6f5de2b6d5c0a886fa2aef2fd455e7436`;
  this is not a verified running deployment revision.
- Expected API base from `docker-compose.yml`: `http://localhost:3000`.
- **Current outcome (04:28 UTC): raw stock/corpus inputs prepared; analysis and
  market/news readiness remain blocked.** See the preparation/re-audit section
  below. The following startup notes describe the earlier empty-database phase.
  Following the operator's shutdown of conflicting containers, the backend was
  built from this workspace and started with Postgres, Redis and LocalStack.
  Compose created new Tuju Postgres/Redis volumes. Neither worker was started.
- Backend image ID reported by Docker:
  `sha256:fda205279a6673cb6e5a8284eeecd3c17606d9e070b9244cbeafbda1fd08bcfe`.
  No application source/configuration was modified for this startup.

## Initial read-only evidence (before startup)

| Check | Observed result |
| --- | --- |
| `docker compose ps` | No services listed |
| `docker compose ls --all` | No Tuju project listed |
| `docker ps -a --filter label=com.docker.compose.project=tuju` | No containers listed |
| `docker volume ls --filter label=com.docker.compose.project=tuju` | No matching volumes listed; this does not rule out unlabelled/external storage |
| Listener inspection for 3000, 5173, 8080 | No listeners found |
| `GET http://localhost:3000/health` (10-second maximum) | Connection refused, curl exit 7, HTTP code `000` (no HTTP response) |
| Default dependency ports | Ports 5432 and 6379 are published by another project's running Postgres and Redis containers |

At this initial inspection no stack was started and no persistent data changed.
Subsequently the operator stopped the unrelated containers. The agent executed
`docker compose up -d --build postgres redis localstack backend`; this created
Tuju resources and ran API boot migrations. No unrelated containers were stopped
or inspected internally by the agent. No data preparation jobs were run.

## Initial endpoint audit and example selection (before preparation)

The following GET results were observed on the healthy local API. There are no
selected showcase IDs. Candidate stock codes come from the KLCI reference module,
not populated backend identity responses; they are probes, not approved examples.

| Area | Reads | Observed result |
| --- | --- | --- |
| Health | `/health` | HTTP 200; database and Redis up |
| Indices | `/market/indices` | HTTP 200, `{"indices":[]}`; no headline ID to select |
| Index history | `/market/indices/:id/series?range=1m` (also `3m`, `1y`) | Not requested: no actual index ID exists; do not invent one |
| Sectors | `/market/sectors` | HTTP 200, `{"sectors":[]}` |
| Movers | `/market/movers?type=gainers&limit=10` (also `losers`, `actives`) | Each HTTP 200, echoed type/limit, `rows: []` |
| Identity discovery | `/search?q=1155&limit=10`, `/screener?limit=5` | HTTP 200, empty items; screener total 0 |
| Stock core | `/stocks/:code` for `1155`, `1023`, `5326` | Each HTTP 404: `No stock found for stockCode=<code>` |
| Stock history | `/stocks/:code/series?interval=1d&range=2y`, same three codes | Each HTTP 404, same missing-stock message |
| Stock TA/FA | `/stocks/:code/analysis/technical`, `/stocks/:code/analysis/fundamental`, and each `/artifact`, same three codes | All 12 requests HTTP 404, same missing-stock message; no envelopes/artifacts to compare |
| Supporting news | `/news?companyCode=1155&limit=5` | HTTP 200, empty items, total 0; no company exists, so this is not proof of prepared-company news coverage |
| Prospectuses | `/ipo/:id/at-a-glance` and `/ipo/:id/at-a-glance/artifact` | Not requested: read-only database discovery found zero IPO listings and zero prospectus analyses, hence no genuine IDs to audit |

Supplemental database evidence used Tuju's own Postgres container with
`psql -X -v ON_ERROR_STOP=1` and a `BEGIN READ ONLY` transaction. Exact `count(*)`
was **0** for each of: `instruments`, `companies`, `price_bars`,
`fundamentals_snapshots`, `indicator_snapshots`, `market_indices`, `index_levels`,
`technical_analyses`, `fundamental_analyses`, `ipo_listings`,
`prospectus_analyses`, `news_articles`, and `ingestion_runs`.
`SELECT id FROM ipo_listings` returned no rows.

**Coverage shortfall:** stocks 0/3 (minimum 1 not met); prospectuses 0/2 (minimum 1
not met). Actual trading/result/generation dates, source classes, language and
artifact coherence are **unavailable**, not inferred from fixtures or producer
defaults. Market/KLCI coexistence and source consistency cannot yet be verified.
The confirmed gap is tracked in [ticket 10](issues/10-local-data-preparation.md).

If an envelope/artifact pair differs during reads, re-read once, then record an
unresolved coherence failure rather than approving the example. Do not substitute
contract fixtures or corpus identifiers for verified API-backed examples.

## Known contract limitations (code inspection, not live evidence)

`packages/contracts/src/http/market.ts` supplies provenance but no quote timestamp
for indices or sectors; mover lineage also does not prove quote time. History
dates and client retrieval time must not be presented as current quote time.
Synthetic analogues must retain their backend identities and illustrative labels;
they are not official/live Bursa indices.

## Preparation and re-audit — 2026-10-15, 04:25–04:28 UTC

Operator approved local data preparation. No reset/purge or paid analysis ran.
The API was rebuilt after the small Yahoo request fix described below. Its new
image ID is `sha256:d9ca96198e9245757cf340dff59973ce7cad57d92afe5a3dd86e510b5d81e487`
(workspace revision above plus uncommitted adapter/test changes).

### Executed preparation

1. `docker compose exec -T -e DATA_SOURCE=yfinance backend node dist/worker-main.js ingest`
   populated reference data, 55 announcements, 25 corporate actions, 10 news rows,
   8 news tags, 5 Shariah statuses, 1 demo IPO, 5 indices and 3,750 index levels.
   Initial Yahoo requests failed for all 30 codes because yahoo-finance2 4.0.3
   passes omitted `period2` through to chart validation as `undefined`.
   The command exited successfully despite reporting 60 per-item fetch failures:
   exit status alone is not a readiness check.
2. Created the missing **local emulator** bucket using `awslocal s3api
   create-bucket --bucket tuju-local --region ap-southeast-1
   --create-bucket-configuration LocationConstraint=ap-southeast-1`.
   The initial corpus attempt failed before upload/DB writes. The init hook is
   tracked non-executable (`100644`); LocalStack logs confirm permission denied.
   Reproducibility fix is tracked in ticket 12.
3. Retried `seed-prospectus /corpus` through a disposable backend Compose container
   with the repository corpus directory mounted read-only at `/corpus`, bypassing
   the API entrypoint. All 3 configured Part-1 PDFs uploaded and 3 listing rows
   created. This does not upload the remaining PDF parts or create analyses.
4. Added explicit request end dates to market/fundamentals Yahoo reads, with
   regression assertions. Rebuilt backend, then ran
   `docker compose exec -T -e DATA_SOURCE=yfinance backend node dist/worker-main.js ingest-klci`.
   Result: **21,859 bars, 173 quarterly rows, 30 fundamentals snapshots and 30
   indicator snapshots, zero fetch failures**. Run ID:
   `2b49e41e-0913-4fa7-b34f-1aa55ebb3df3`.

The full ingestion command queued **55 announcement + 60 TA/FA jobs**. Redis
confirmed 115 waiting and 0 active. Neither resident worker is running; no worker
results or LLM calls have been generated. A scheduled synthetic replay also
ran while the one-shot ingestion context was alive across a five-minute boundary;
one-shot CLI mode currently registers schedulers. Its ephemeral prices are not
the real EOD prices and expire after 15 minutes without replay.

Effective API `DATA_SOURCE` remains its default `synthetic`; only the manual
ingestion processes explicitly used `yfinance`. The API reads persisted lineage,
and does not ingest data itself. **Do not start the default ingestion-worker**:
its default synthetic adapter would overwrite overlapping reference-stock data.
Any future ingestion must explicitly retain `DATA_SOURCE=yfinance`.

### Stock candidates (not yet approved complete examples)

All three core reads returned HTTP 200 with real price/fundamental lineage.
Each `/series?interval=1d&range=2y` returned **490 points**,
`2024-10-15`–`2026-10-15`, `provenance: real`, `demoLabel: private-demo`.

| Code | Backend company | Latest stored close | TA / FA | Artifact reads |
| --- | --- | --- | --- | --- |
| `1155` | Malayan Banking Berhad (MAYBANK) | 10.040000 | Both pending, null headline/asOf/pointer | Both 404, no artifact |
| `1023` | CIMB Group Holdings Berhad (CIMB) | 7.500000 | Both pending, null headline/asOf/pointer | Both 404, no artifact |
| `5326` | 99 Speed Mart Retail Holdings Berhad (99SMART) | 3.090000 | Both pending, null headline/asOf/pointer | Both 404, no artifact |

Latest stored date is not a quote timestamp or proof of a completed trading day;
the audit was during trading hours. No result dates/language/coherence can yet be
verified. No selected candidate meets the complete TA+FA requirement.

### Prospectus candidates (real listing IDs; no completed results)

| ID | Company | Listing date |
| --- | --- | --- |
| `094fd734-c812-4bcf-921d-72dea6f21fb6` | Insights Analytics Berhad | 2025-10-27 |
| `5a9e9d7f-97e9-4cbf-9126-98965756ef5b` | Fibromat (M) Berhad | 2025-05-08 |
| `df8f7c39-bb7a-47bb-a0fc-fc556b210f01` | Lim Seong Hai Capital Berhad | 2025-03-21 |

For every ID, both summary and artifact reads returned HTTP 404,
`No prospectus analysis yet`. None was enqueued for analysis. Two final examples
must be selected after actual output is reviewed. The additional Demo Newco row
is not an approved prospectus example. Generation dates/extraction completeness
remain unavailable; configured corpus inputs are Part-1-only.

### Market and news evidence

- During trading hours `/market/indices` and `/market/sectors` still return
  HTTP 200 with empty arrays despite stored index data. Code inspection confirms
  the intraday reader requires an outside-hours-warmed identity cache, while
  ingestion invalidates it. Track the cold-start failure in ticket 11; do not
  falsify time or inject cache fixtures to claim successful API discovery.
- Headline ID discovered from actual stored rows:
  `dd38053f-6396-482b-80bc-85742fbe3f32`, `kind: headline`, name
  **Tuju Composite Index**, synthetic provenance. History reads returned HTTP 200:
  `1m`: 23 points (2025-12-01–2025-12-31); `3m`: 65 points
  (2025-10-02–2025-12-31); `1y`: 262 points (2024-12-31–2025-12-31);
  `all`: 750 points (2023-02-16–2025-12-31). Latest history level 122.787008.
  Ranges anchor to latest stored date, not today's date. This is old illustrative
  history, not an official/live Bursa index or a current-market explanation.
- Four synthetic sector indices each have 750 stored points over the same dates:
  Financial Services, Industrial Products & Services, Technology,
  Telecommunications & Media. These are not a real KLCI sector board.
- All three movers reads returned 5 synthetic rows at the observed replay tick.
  Example: MAYBANK synthetic mover price 3.843584 versus real latest stored close
  10.040000. Provenance is labelled, but the presentation must not conflate them;
  prices cannot reconcile. Without a resident replay their TTL will expire and
  trading-hours boards become empty. Ticket 11 covers the presentation-readiness
  decision; no synthetic bars were substituted into stock series.
- `/news?companyCode=1155&limit=5` and `1023` each return 2 entries; `5326` returns
  zero. Entries say `Demo Wire`, use `example.test` source links and generated
  headlines, despite `aggregator` lineage. One MAYBANK timestamp is 08:00 UTC,
  later than this audit. These are demonstrator snapshots, **not verified real
  media coverage**, and must not be approved as real supporting news. Ticket 13
  records the needed source/availability decision.

### Post-preparation verification

- Read-only SQL: 31 instruments, 21,859 price bars, 173 quarters, 30 fundamentals
  and 30 indicator snapshots, 3,750 index levels, 30 pending TA and 30 pending FA
  rows, 4 IPO listings, **0 prospectus analyses**, 10 demonstrator news rows.
- `pnpm --filter backend test --runInBand`: **41 suites / 432 tests passed**.
- Targeted Yahoo adapter tests: **5 passed**; backend typecheck and Docker build
  passed. No frontend code changed; frontend/e2e tests were not run.
- OpenRouter credential presence was checked without printing its value:
  configured; model `openrouter/free`. **No AI execution approved/performed in
  this preparation pass.** A separate explicit execution decision is needed
  before starting the worker, which would consume all 115 waiting jobs, not only
  the three chosen stocks. No claim of a completed analysis is made.

## Preparation reference and remaining prerequisites

Sources: root `README.md` (Local runtime), `apps/backend/CONTEXT.md`,
`apps/backend/src/worker-main.ts`, and
`apps/backend/src/ingestion/eod-ingest.service.ts`.

1. Local startup is complete after the operator freed the default ports. Preserve
   isolation from unrelated databases/brokers; do not delete the new volumes.
2. Leave resident ingestion/AI workers off pending execution approval: scheduled
   work or queued jobs could run. Root README's full-stack
   `docker compose up --build` is not a read-only audit command.
3. Raw data preparation is complete; analysis generation and market/news readiness
   still need follow-up. See tickets 10–13 before starting workers or sharing.
4. If approved separately, existing worker CLI commands are invoked as
   `node dist/worker-main.js <command>` in the correctly configured backend runtime:
   - `seed-klci` → `ingest-klci` → `enqueue-klci [--force] [stockCode]`:
     reference writes, market-data ingestion/materialisation, then TA/FA jobs.
     `ingest-klci` alone does not populate index/sector/news panels.
   - `seed-prospectus [corpusDir]` → `enqueue-prospectus [ipoListingId]`:
     corpus upload/listing writes, then potentially paid prospectus analysis.
   - `ingest`: broader nightly path, including market panels and follow-on job
     enqueues. It is not a safe automatic read-only repair.
   These require configured Postgres/Redis, appropriate data-source settings,
   migrations and, for artifacts/jobs, S3 access and a compatible AI worker.
   LLM work additionally requires operator-approved credentials/budget. Confirm
   runtime data-source configuration before any ingest; do not assume real data.

No destructive reset, purge, deploy, paid job or preparation command is approved
by the choice to audit the existing local stack.

## Remaining blockers and operator review

- [x] Resolve port conflicts with the operator and start only dependencies/API.
- [x] Make a Tuju API reachable and record its workspace/image identity.
- [x] Audit available reads and document empty/missing coverage without mocks.
- [x] Operator approves local raw data preparation; source settings inspected.
- [x] Populate raw stock/corpus inputs and re-audit dates/provenance/availability.
- [ ] Approve AI execution/model/budget and generate/re-audit coherent artifacts.
- [ ] Resolve market cold-cache/mixed-provenance and demonstrator-news gaps.
- [ ] Select verified stock/prospectus IDs, or document measured shortfalls.
- [x] Create a scoped data-preparation follow-up for the confirmed empty-data gap
  (ticket 10); further backend issues require additional evidence.
- [ ] Operator confirms private access and non-redistribution restrictions before
  sharing. Local findings do not establish hosted deployment readiness or rights.

Ticket 01 remains `needs-info`: raw inputs are prepared, but minimum completed
 analysis coverage is not met. Tickets 10–13 track remaining decisions/gaps.

## LocalStack audit — 2026-10-15 14:45–14:47 UTC

This is a separate, read-only audit; it does not supersede or rewrite the earlier
execution snapshot above.

### Verified observations

- At the audit time, LocalStack, backend, Postgres and Redis services were
  running; the AI worker was stopped. No ingestion container was present.
- Read-only database status: stock `1155` TA and FA pending; `1023` TA and FA
  failed; `5326` TA `facts_only` and FA failed. The two prospectus listing IDs
  recorded above have stored PDFs but no prospectus analysis rows.
- Verified `5326` TA S3 object: `analysis/technical/5326/2026-10-15T04.json`,
  **2,310 bytes**, SHA-256
  `99d4c18fdf0bf6c413a9eccee31547499792b48ad84bc805574073f0cd6d4ecb`;
  HEAD/content-type: `application/json`. The object was read twice. Schema
  validation fails on `asOf` (`2026-10-15 04:25:29.756000+00:00`) and
  `provenance.generatedAt` (`2026-10-15 06:45:32.611010+00:00`); both raw
  validation and validation with cost omitted fail.
- The Part-1-only PDFs are Insights Analytics, **2,408,406 bytes**, and Fibromat,
  **2,571,691 bytes**. These are not complete multi-part prospectuses.
- Image IDs were inspected, but no OCI revision labels were present; whether the
  source-pipeline fix is included in the running image is unknown.
- API routes whose reads can populate/read-through cache were skipped because
  their possible Redis writes fell outside this read-only audit's scope.
- Market, news and rights readiness remain unresolved.

### Historical references and unverified items

- The earlier `06:56:41Z` queue snapshot recorded 49 waiting jobs. This is a
  historical reference only; the queue was not inspected at 14:45–14:47, and 49
  waiting must not be represented as the current queue state.
- Running service state above was observed at the audit time only, not established
  as a continuing state. Only the current queue state remains unknown.
- No files, runtime, queue, or artifacts were modified during this audit. No
  ticket was marked passed.
