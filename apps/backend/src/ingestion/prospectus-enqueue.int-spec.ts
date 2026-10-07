/**
 * Prospectus ops-enqueue integration test (spec 06, ticket 05; ADR-0011).
 *
 * REAL Postgres + Redis via testcontainers; no worker consumes the queue, so
 * enqueued jobs stay waiting (observable in BullMQ). Covers the cost-bounding
 * not-yet-processed predicate:
 *
 *   1. Only curated (has prospectusS3Key) and un-analysed listings are
 *      selected; an analysed one and a calendar-only one are skipped.
 *   2. Enqueued envelopes are `system`/`system`, payload `{ prospectusId }`,
 *      BullMQ id `prospectus-{id}` (hyphen form).
 *   3. Re-running is idempotent while jobs are in flight (no duplicates), and
 *      a run after results landed (rows exist) enqueues nothing.
 *   4. An explicit id re-runs that one listing even when already analysed, and
 *      replaces a retained completed/failed job rather than silently no-op'ing.
 *   5. Unknown id / listing without a PDF reject.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import IORedis, { type Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { Worker } from 'bullmq';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

import * as entities from '../data/entities';
import { ListingBoard, ProvenanceClass } from '../data/entities/enums';
import { InitialSchema1727600000000 } from '../data/migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from '../data/migrations/1727700000000-FreeTierDomainModel';
import { ReIngestNaturalKeys1727800000000 } from '../data/migrations/1727800000000-ReIngestNaturalKeys';
import { DisclosureReadModel1727900000000 } from '../data/migrations/1727900000000-DisclosureReadModel';
import { MarketIndexModel1728000000000 } from '../data/migrations/1728000000000-MarketIndexModel';
import { ShowcaseJobsModel1728100000000 } from '../data/migrations/1728100000000-ShowcaseJobsModel';
import { ProspectusAnalysis1728200000000 } from '../data/migrations/1728200000000-ProspectusAnalysis';
import { JobBus } from '../jobbus/job-bus.service';
import { ANALYSIS_QUEUE } from '../jobbus/job-names';
import { ProspectusEnqueueService } from './prospectus-enqueue.service';

jest.setTimeout(180_000);

const ALL_ENTITIES = Object.values(entities).filter((v) => typeof v === 'function');

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 8000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('enqueue-prospectus (integration — testcontainers)', () => {
  let pg: StartedPostgreSqlContainer;
  let redisC: StartedRedisContainer;
  let dataSource: DataSource;
  let redis: Redis;
  let jobBus: JobBus;
  let service: ProspectusEnqueueService;

  let aId: string; // curated, un-analysed
  let bId: string; // curated, un-analysed
  let doneId: string; // curated, already analysed
  let calendarId: string; // no PDF

  beforeAll(async () => {
    [pg, redisC] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7.4-alpine').start(),
    ]);
    dataSource = new DataSource({
      type: 'postgres',
      url: pg.getConnectionUri(),
      synchronize: false,
      entities: ALL_ENTITIES,
      migrations: [
        InitialSchema1727600000000,
        FreeTierDomainModel1727700000000,
        ReIngestNaturalKeys1727800000000,
        DisclosureReadModel1727900000000,
        MarketIndexModel1728000000000,
        ShowcaseJobsModel1728100000000,
        ProspectusAnalysis1728200000000,
      ],
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    redis = new IORedis(redisC.getConnectionUrl(), { maxRetriesPerRequest: null });
    jobBus = new JobBus(redis);
    await jobBus.onModuleInit();
    service = new ProspectusEnqueueService(dataSource, jobBus);

    const run = await dataSource.query(
      `INSERT INTO ingestion_runs (kind, adapter, provenance_class, ran_at)
       VALUES ('standard', 'CuratedProspectusCorpusAdapter', $1, now()) RETURNING id`,
      [ProvenanceClass.Real],
    );
    const repo = dataSource.getRepository(entities.IpoListing);
    const mk = (name: string, key: string | null) =>
      repo.save(
        repo.create({
          companyName: name,
          board: ListingBoard.Ace,
          listingDate: '2025-01-01',
          prospectusS3Key: key,
          ingestionRunId: run[0].id,
        }),
      );
    aId = (await mk('Alpha Berhad', 'prospectus/a.pdf')).id;
    bId = (await mk('Beta Berhad', 'prospectus/b.pdf')).id;
    doneId = (await mk('Done Berhad', 'prospectus/done.pdf')).id;
    calendarId = (await mk('Calendar Berhad', null)).id;

    const analyses = dataSource.getRepository(entities.ProspectusAnalysis);
    await analyses.save(
      analyses.create({
        prospectusId: doneId,
        correlationId: randomUUID(),
        jobId: `prospectus:${doneId}`,
        headline: 'done',
        asOf: new Date(),
        artifactBucket: 'b',
        artifactKey: 'k',
      }),
    );
  });

  afterAll(async () => {
    await jobBus?.onModuleDestroy();
    await redis?.quit();
    if (dataSource?.isInitialized) await dataSource.destroy();
    await Promise.all([redisC?.stop(), pg?.stop()]);
  });

  it('predicate selects only curated rows with no analysis yet', async () => {
    expect(await service.selectUnanalysedIds()).toEqual([aId, bId]); // Alpha, Beta
  });

  it('enqueues system-triggered jobs for exactly those rows', async () => {
    const result = await service.enqueue();
    expect(result).toEqual({ enqueued: [aId, bId], alreadyInFlight: [] });

    const queue = jobBus.getQueue();
    const jobs = await queue.getJobs(['waiting']);
    expect(jobs.map((j) => j.id).sort()).toEqual(
      [`prospectus-${aId}`, `prospectus-${bId}`].sort(),
    );
    for (const job of jobs) {
      expect(job.name).toBe('analyze-prospectus');
      expect(job.data).toMatchObject({ requestedBy: 'system', trigger: 'system' });
      expect(job.id).not.toContain(':');
      expect(job.data.payload.prospectusId).toBe(String(job.id).replace('prospectus-', ''));
    }
  });

  it('is idempotent on re-run: in-flight jobs are not duplicated', async () => {
    const result = await service.enqueue();
    expect(result).toEqual({ enqueued: [], alreadyInFlight: [aId, bId] });
    expect(await jobBus.getQueue().getJobCountByTypes('waiting')).toBe(2);
  });

  it('once results have landed (rows exist) a run enqueues nothing', async () => {
    await jobBus.getQueue().drain();
    const analyses = dataSource.getRepository(entities.ProspectusAnalysis);
    for (const id of [aId, bId]) {
      await analyses.save(
        analyses.create({
          prospectusId: id,
          correlationId: randomUUID(),
          jobId: `prospectus:${id}`,
          headline: 'h',
          asOf: new Date(),
          artifactBucket: 'b',
          artifactKey: 'k',
        }),
      );
    }
    expect(await service.selectUnanalysedIds()).toEqual([]);
    expect(await service.enqueue()).toEqual({ enqueued: [], alreadyInFlight: [] });
    expect(await jobBus.getQueue().getJobCountByTypes('waiting')).toBe(0);
  });

  it('explicit id re-runs one analysed listing, replacing a retained COMPLETED job (no silent no-op)', async () => {
    const queue = jobBus.getQueue();
    // A real worker completes a job under the same dedup id; BullMQ retains it (1h).
    const worker = new Worker(ANALYSIS_QUEUE, async () => ({ ok: true }), {
      connection: redis,
    });
    await queue.add('analyze-prospectus', { stale: true }, { jobId: `prospectus-${doneId}` });
    await waitFor(async () => {
      const j = await queue.getJob(`prospectus-${doneId}`);
      return (await j?.getState()) === 'completed' ? true : null;
    });
    await worker.close();

    const result = await service.enqueue(doneId);
    expect(result).toEqual({ enqueued: [doneId], alreadyInFlight: [] });
    const fresh = await queue.getJob(`prospectus-${doneId}`);
    expect(await fresh?.getState()).toBe('waiting');
    expect(fresh?.data).toMatchObject({
      requestedBy: 'system',
      trigger: 'system',
      payload: { prospectusId: doneId },
    });
  });

  it('rejects an unknown / malformed id and a listing with no stored PDF', async () => {
    await expect(service.enqueue(randomUUID())).rejects.toThrow(/no IpoListing/);
    await expect(service.enqueue('nope')).rejects.toThrow(/no IpoListing/);
    await expect(service.enqueue(calendarId)).rejects.toThrow(/no prospectusS3Key/);
  });
});
