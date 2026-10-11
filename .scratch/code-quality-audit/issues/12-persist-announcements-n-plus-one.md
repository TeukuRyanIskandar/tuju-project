# M-07: N+1 re-reads in persistAnnouncements after batch upsert

**Severity:** Major  
**Status:** completed  
**Component:** `apps/backend` (NestJS, data ingestion)

## Verified ✅

Code review of `apps/backend/src/ingestion/eod-ingest.service.ts:persistAnnouncements` confirms the N+1 loop has been replaced with a single bulk `repo.find()` query using `WHERE (company_id, filed_at, title) IN (...)` and `ai_summary IS NULL` filter. The 200+ individual SELECT queries have been eliminated; now only one query is issued per batch.

## Problem

After upserting announcements in `persistAnnouncements` (eod-ingest.service.ts:611–620), the code loops and re-fetches each announcement individually:

```typescript
for (const row of rows) {
  const found = await repo.findOneOrFail({
    where: { 
      companyId: row.companyId, 
      filedAt: row.filedAt, 
      title: row.title 
    },
  });
  if (found.aiSummary === null) ids.push(found.id);
}
```

**Impact:** For a batch of 200 announcements, this issues 200 individual SELECT queries — all inside the nightly transaction.

### Consequences

1. **Lock contention:** Long transaction hold time increases risk of blocking other reads.
2. **Connection pool saturation:** 200+ sequential queries may exhaust the pool.
3. **Latency:** Nightly ingest runtime becomes unpredictable if announcements volume grows.

## Fix

Replace the loop with a single query:

```typescript
const unsummarised = await repo.find({
  where: [
    // Find rows matching the (companyId, filedAt, title) tuples from rows
    // and where aiSummary IS NULL
  ],
  select: ['id'],
});
const ids = unsummarised.map(a => a.id);
```

Or use a raw query to avoid the need for multiple WHERE clauses:

```typescript
const unsummarised = await repo.query(`
  SELECT id FROM announcements 
  WHERE (company_id, filed_at, title) IN (...)
    AND ai_summary IS NULL
`, [rowData]);
```

## Files Affected

- `apps/backend/src/ingestion/eod-ingest.service.ts:611–620` (persistAnnouncements)
- Also check: issue C-4 covers similar patterns elsewhere

## Testing Opportunity

Add an integration test with query log spy to verify only 1–2 queries are issued for 200 announcements.

---
