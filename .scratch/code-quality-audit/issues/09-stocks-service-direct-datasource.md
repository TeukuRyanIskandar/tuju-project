# M-04: StocksService and IpoService use DataSource directly instead of @InjectRepository

**Severity:** Major  
**Status:** completed  
**Component:** `apps/backend` (NestJS, DI)

## Verified ✅

Code review of `apps/backend/src/stocks/stocks.service.ts` and `apps/backend/src/ipo/ipo.service.ts` confirms both services now use `@InjectRepository` decorators for all repository access (TechnicalAnalysis, FundamentalAnalysis, Company, Watchlist, IPO). No direct `DataSource.getRepository()` calls remain. DI pattern is now consistent with other services across the codebase.

## Problem

`StocksService` (stocks.service.ts) and `IpoService` (ipo.service.ts) bypass NestJS's `@InjectRepository` pattern and call `DataSource.getRepository()` directly:

```typescript
// StocksService
constructor(private dataSource: DataSource) {}

async getTechnicalAnalysis(stockCode: string) {
  const repo = this.dataSource.getRepository(TechnicalAnalysis);  // ← direct access
  const row = await repo.findOne({ ... });
}
```

This is inconsistent with other services in the codebase (e.g., `TechnicalAnalysisStore` uses `@InjectRepository` correctly).

### Consequences

1. **Lost transaction context:** NestJS's `EntityManager` scoped to a transaction is not automatically injected, making it harder to scope operations to a transaction.
2. **Harder to test:** Repository mocking requires a full `DataSource` mock instead of simple `Repository` fakes.
3. **Inconsistent patterns:** Other services use `@InjectRepository`, creating two parallel injection patterns.
4. **Vendor lock-in on DataSource:** If the project ever migrates to a different ORM, `StocksService` is harder to refactor.

## Fix

Replace direct `DataSource.getRepository()` calls with `@InjectRepository` decorators:

```typescript
import { InjectRepository } from '@nestjs/typeorm';

constructor(
  @InjectRepository(TechnicalAnalysis)
  private technicalRepo: Repository<TechnicalAnalysis>,
  @InjectRepository(FundamentalAnalysis)
  private fundamentalRepo: Repository<FundamentalAnalysis>,
  // ... other repos
) {}

async getTechnicalAnalysis(stockCode: string) {
  const row = await this.technicalRepo.findOne({ ... });
}
```

## Files Affected

- `apps/backend/src/stocks/stocks.service.ts:24–28` (DI constructor)
- `apps/backend/src/stocks/stocks.service.ts` (all `this.dataSource.getRepository()` calls — ~8 instances)
- `apps/backend/src/ipo/ipo.service.ts:24–28` (same pattern)
- Verify `StocksModule` exports all necessary repositories via `TypeOrmModule.forFeature([...])`

## Testing Opportunity

Update `StocksService` unit tests to use simple `Repository` fakes instead of mocking `DataSource`.

---
