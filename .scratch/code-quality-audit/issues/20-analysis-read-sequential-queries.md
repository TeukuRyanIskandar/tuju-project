# m-06: 3 sequential DB queries per analysis read call

**Severity:** Minor  
**Status:** needs-triage  
**Component:** `apps/backend` (NestJS, performance)

## Problem

`StocksService.getTechnicalAnalysis` and `getFundamentalAnalysis` issue 3 sequential DB queries that could be batched:

```typescript
// stocks.service.ts:143–149
async getTechnicalAnalysis(stockCode: string) {
  const instrument = await this.requireKlciInstrument(stockCode);  // Query 1
  const row = await this.dataSource.getRepository(TechnicalAnalysis)
    .findOne({ where: { instrumentId: instrument.id } });         // Query 2
  if (!row) return pendingTechnicalAnalysis(stockCode);
  const latestEod = await this.latestEodCloseDay(instrument.id);   // Query 3
  return toTechnicalAnalysisResponse(stockCode, row, latestEod);
}
```

Each call does:
1. Fetch instrument by stock code
2. Fetch analysis by instrument id
3. Fetch latest EOD close day

### Consequences

1. **High latency:** Each page render may make multiple calls to these endpoints, each issuing 3 queries.
2. **Read cache bypass:** These queries are not cached; a single user page load can cause 9+ queries.
3. **Connection pool contention:** At scale, this becomes a bottleneck.

## Fix

**Option A: Batch queries with JOIN**
```typescript
async getTechnicalAnalysis(stockCode: string) {
  const result = await this.dataSource.getRepository(Instrument).query(`
    SELECT i.id, i.stock_code, ta.*, eod.close
    FROM instruments i
    LEFT JOIN technical_analyses ta ON ta.instrument_id = i.id
    LEFT JOIN eod_closes eod ON eod.instrument_id = i.id
    WHERE i.stock_code = $1 AND i.board = 'KLCI30'
    ORDER BY eod.as_of DESC LIMIT 1
  `, [stockCode]);
  if (!result[0]) return pendingTechnicalAnalysis(stockCode);
  return toTechnicalAnalysisResponse(...);
}
```

**Option B: Add read cache**
```typescript
return this.cache.remember(
  `technical-analysis:${stockCode}`,
  () => getTechnicalAnalysis(stockCode),
  { ttl: 3600 },
);
```

## Files Affected

- `apps/backend/src/stocks/stocks.service.ts:143–163` (getTechnicalAnalysis)
- `apps/backend/src/stocks/stocks.service.ts:~200` (getFundamentalAnalysis — similar pattern)
- `apps/backend/src/ipo/ipo.service.ts:~` (getTechnicalArtifact — same pattern)

## Related

- Issue M-6 (READ_CACHE_TTL_SECONDS) — cache is already partially implemented

---
