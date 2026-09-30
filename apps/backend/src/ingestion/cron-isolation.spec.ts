import { ScheduleModule } from '@nestjs/schedule';
import { AppModule } from '../app.module';
import { WorkerModule } from '../worker.module';
import { IngestionModule } from './ingestion.module';
import { IngestionScheduler } from './ingestion.scheduler';

/**
 * Cron-isolation guarantee (ticket 04 Testing seam — "the API process context does
 * not register schedule jobs").
 *
 * The `@nestjs/schedule` crons MUST live only in the ingestion worker. If the API
 * process also loaded the schedule module, every cron would double-fire (two
 * writers on the same nightly ingest). This test pins the structural invariant by
 * inspecting the NestJS module metadata directly — no infra needed — so a
 * regression (someone importing IngestionModule/ScheduleModule into AppModule)
 * fails fast.
 */
function imports(moduleClass: object): unknown[] {
  return (Reflect.getMetadata('imports', moduleClass) as unknown[]) ?? [];
}
function providers(moduleClass: object): unknown[] {
  return (Reflect.getMetadata('providers', moduleClass) as unknown[]) ?? [];
}

describe('cron isolation (schedule crons live only in the worker)', () => {
  it('the API AppModule imports neither ScheduleModule nor the ingestion worker', () => {
    const appImports = imports(AppModule);
    // No ScheduleModule (or its dynamic-module wrapper) anywhere in the API.
    const importsSchedule = appImports.some(
      (imp) =>
        imp === ScheduleModule ||
        (imp as { module?: unknown })?.module === ScheduleModule,
    );
    expect(importsSchedule).toBe(false);
    // The API does not load the ingestion worker module (which owns the crons).
    expect(appImports).not.toContain(IngestionModule);
    // And the scheduler provider is not registered on the API process.
    expect(providers(AppModule)).not.toContain(IngestionScheduler);
  });

  it('the worker composes the ingestion module, which registers the schedule + scheduler', () => {
    expect(imports(WorkerModule)).toContain(IngestionModule);

    const ingestionImports = imports(IngestionModule);
    const registersSchedule = ingestionImports.some(
      (imp) =>
        imp === ScheduleModule ||
        (imp as { module?: unknown })?.module === ScheduleModule,
    );
    expect(registersSchedule).toBe(true);
    expect(providers(IngestionModule)).toContain(IngestionScheduler);
  });

  it('the scheduler market-hours guard bounds the intraday replay to 09:00–16:45 MYT', () => {
    // 08:00 MYT = 00:00 UTC → closed; 10:00 MYT = 02:00 UTC → open; 17:00 MYT closed.
    expect(IngestionScheduler.isMarketHours(new Date('2025-01-02T00:00:00Z'))).toBe(false);
    expect(IngestionScheduler.isMarketHours(new Date('2025-01-02T02:00:00Z'))).toBe(true);
    expect(IngestionScheduler.isMarketHours(new Date('2025-01-02T09:00:00Z'))).toBe(false);
  });
});
