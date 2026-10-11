# C-03: N+1 queries in indicator materialisation and reference resolution

**Severity:** Critical  
**Status:** completed  
**Component:** `apps/backend` (NestJS, data ingestion)

## Problem

The nightly EOD ingest performs sequential SELECT queries inside a long-running transaction, creating N+1 bottlenecks:

### Location 1: `resolveKlciReferenceIds` (lines 387–397)

```typescript
for (const row of KLCI30_UNIVERSE) {
  const instrument = await instrumentRepo.findOne({  // ONE QUERY PER STOCK (30 queries)
    where: { stockCode: row.stockCode },
  });
  ...
}
```

**Issue:** 30 sequential `WHERE stock_code = $1` queries instead of a single `WHERE stock_code = ANY($1)` query.

### Location 2: `materialiseIndicators` (lines 877–887)

```typescript
for (const instrument of instruments) {
  const bars = await barRepo.find({ where: { instrumentId } });  // 1 query per instrument
  ...
  const indicators = computeIndicators(bars);
  await manager.query(...);  // 1 query per instrument to upsert indicators
}
```

**Issue:** At demo scale (30 instruments): 30 `find` queries + 30 upsert queries = 60 queries total. At production scale (500+ listed companies): 1,000+ queries inside a transaction.

## Consequences

1. **Transaction lock contention:** Long transaction hold time increases the risk of blocking other reads.
2. **Connection pool saturation:** Each sequential query acquires a connection; 60+ simultaneous sequential queries may exhaust the pool.
3. **Latency:** Nightly ingest runtime becomes a reliability hazard if it extends past the market open next day.
4. **Database CPU:** Each query incurs planning overhead; batch queries are more efficient.

## Fix

### Location 1
Replace the loop with a single `findBy`:
```typescript
const instruments = await instrumentRepo.find({
  where: { stockCode: In(KLCI30_UNIVERSE.map(r => r.stockCode)) },
});
```

### Location 2
Replace the inner loop with a `IN` subquery:
```typescript
const bars = await barRepo.find({
  where: { instrumentId: In(instruments.map(i => i.id)) },
});
// Build a map for O(1) lookup per instrument
const barsByInstrument = groupBy(bars, b => b.instrumentId);
for (const instrument of instruments) {
  const instrumentBars = barsByInstrument[instrument.id] || [];
  ...
}
```

Then batch the upserts using `manager.createQueryBuilder().insert().orIgnore()...`.

## Files Affected

- `apps/backend/src/ingestion/eod-ingest.service.ts:387–397` (resolveKlciReferenceIds)
- `apps/backend/src/ingestion/eod-ingest.service.ts:877–887` (materialiseIndicators)
- Also check: `persistAnnouncements` (issue M-7 covers a similar pattern)

## Testing Opportunity

Add an integration test with a query log spy to verify:
1. No more than 5 total queries issued during indicator materialisation for 30 instruments
2. The entire ingest completes within a time budget (e.g., 5 seconds for KLCI-30)

---
