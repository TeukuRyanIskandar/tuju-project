import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { JobEnvelope, JobResult } from '@tuju/contracts';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Repository } from 'typeorm';
import { TechnicalAnalysis } from '../data/entities/technical-analysis.entity';
import { FundamentalAnalysis } from '../data/entities/fundamental-analysis.entity';
import { Instrument } from '../data/entities/instrument.entity';
import type { PriceBar } from '../data/entities/price-bar.entity';
import { StockAnalysisStatus } from '../data/entities/enums';
import { InMemoryJobBus } from '../jobbus/in-memory-job-bus';
import { JobNames } from '../jobbus/job-names';
import {
  buildFundamentalEnvelope,
  buildTechnicalEnvelope,
} from '../ingestion/klci-enqueue.service';
import type { ReadModelCache } from '../cache';
import type { AnalysisResultStore } from './analysis-result.store';
import { StockAnalysis } from './stock-analysis';

const FIXTURES = resolve(__dirname, '../../../../packages/contracts/fixtures');

const TECHNICAL_RESULT = JSON.parse(
  readFileSync(resolve(FIXTURES, 'job-result-technical-system.json'), 'utf-8'),
) as JobResult;

const FUNDAMENTAL_RESULT = JSON.parse(
  readFileSync(resolve(FIXTURES, 'job-result-fundamental-system.json'), 'utf-8'),
) as JobResult;

/** The fixtures' asOf hour, so enqueued bull ids and result ids line up. */
const NOW = new Date('2026-10-08T18:00:00.000Z');

function fakeRepo<T extends object>(): {
  repo: Repository<T>;
  rows: Map<string, T>;
  upsertCalls: T[];
} {
  const rows = new Map<string, T>();
  const upsertCalls: T[] = [];
  const repo = {
    create: (input: Partial<T>) => ({ ...input }) as T,
    upsert: async (row: T) => {
      upsertCalls.push(row);
      const instrumentId = (row as { instrumentId: string }).instrumentId;
      rows.set(instrumentId, { ...rows.get(instrumentId), ...row } as T);
    },
    findOne: async ({ where }: { where: { instrumentId: string } }) =>
      rows.get(where.instrumentId) ?? null,
  } as unknown as Repository<T>;
  return { repo, rows, upsertCalls };
}

function setup() {
  const bus = new InMemoryJobBus();
  const ta = fakeRepo<TechnicalAnalysis>();
  const fa = fakeRepo<FundamentalAnalysis>();
  const instruments = {
    findOne: jest.fn(async ({ where }: { where: { stockCode: string } }) =>
      where.stockCode === '1155' ? ({ id: 'inst-1155', stockCode: '1155' } as Instrument) : null,
    ),
  };
  const legacy = { persist: jest.fn(async () => undefined) };
  const readCache = { changed: jest.fn(async () => undefined) };
  const store = new StockAnalysis(
    bus,
    ta.repo,
    fa.repo,
    instruments as unknown as Repository<Instrument>,
    {} as Repository<PriceBar>,
    legacy as unknown as AnalysisResultStore,
    readCache as unknown as ReadModelCache,
    {} as S3Client,
  );
  store.onModuleInit();
  return { bus, store, ta, fa, instruments, legacy, readCache };
}

describe('StockAnalysis job family (landing via the bus)', () => {
  it.each([
    {
      jobName: JobNames.technical,
      envelope: buildTechnicalEnvelope('1155', NOW) as JobEnvelope<unknown>,
      result: TECHNICAL_RESULT,
      table: 'ta' as const,
      other: 'fa' as const,
    },
    {
      jobName: JobNames.fundamental,
      envelope: buildFundamentalEnvelope('1155', NOW) as JobEnvelope<unknown>,
      result: FUNDAMENTAL_RESULT,
      table: 'fa' as const,
      other: 'ta' as const,
    },
  ])(
    '$jobName: ready → failed, one row per instrument, never facts_only',
    async ({ jobName, envelope, result, table, other }) => {
      const ctx = setup();
      const { rows, upsertCalls } = ctx[table];

      // markPending is a conditional SQL write: covered in stock-analysis.int-spec.ts.
      const { jobId } = await ctx.bus.enqueue(jobName, envelope);

      await ctx.bus.complete(result);
      expect(rows.get('inst-1155')).toMatchObject({
        status: StockAnalysisStatus.Ready,
        jobId: result.jobId,
        headline: result.summary.headline,
        artifactBucket: result.pointer.bucket,
        artifactKey: result.pointer.key,
        errorMessage: null,
      });

      await ctx.bus.failJob(jobId, { userMessage: 'worker blew up' });
      expect(rows.get('inst-1155')).toMatchObject({
        status: StockAnalysisStatus.Failed,
        errorMessage: 'worker blew up',
        // The last good result survives a later failure.
        headline: result.summary.headline,
        correlationId: result.correlationId,
      });

      expect(rows.size).toBe(1);
      expect(ctx[other].rows.size).toBe(0);
      expect(upsertCalls.every((r) => r.status !== StockAnalysisStatus.FactsOnly)).toBe(true);

      // Land and fail each announce the change to the read-model cache.
      const analysis = jobName === JobNames.technical ? 'technical' : 'fundamental';
      expect(ctx.readCache.changed.mock.calls).toEqual([
        [{ kind: 'stockAnalysisChanged', stockCode: '1155', analysis }],
        [{ kind: 'stockAnalysisChanged', stockCode: '1155', analysis }],
      ]);
    },
  );

  it('facts-only headline → FactsOnly status', async () => {
    const { bus, ta, fa } = setup();
    await bus.complete({
      ...TECHNICAL_RESULT,
      summary: { ...TECHNICAL_RESULT.summary, headline: 'facts-only: Grounding check failed.' },
    });
    await bus.complete({
      ...FUNDAMENTAL_RESULT,
      summary: {
        ...FUNDAMENTAL_RESULT.summary,
        headline: 'facts-only: Narration stopped by cost guard.',
      },
    });
    expect(ta.rows.get('inst-1155')?.status).toBe(StockAnalysisStatus.FactsOnly);
    expect(fa.rows.get('inst-1155')?.status).toBe(StockAnalysisStatus.FactsOnly);
  });

  it('a verdict-bearing result lands in the scaffold analysis_results table instead', async () => {
    const { bus, ta, legacy } = setup();
    const verdict: JobResult = {
      ...TECHNICAL_RESULT,
      summary: { verdict: 'bullish', headline: 'x', asOf: '2026-10-08T18:00:00Z' },
    };
    await bus.complete(verdict);
    expect(legacy.persist).toHaveBeenCalledWith(verdict);
    expect(ta.rows.size).toBe(0);
  });

  it('a stock code with no instrument writes nothing', async () => {
    const { bus, ta, instruments, readCache } = setup();
    await bus.complete({ ...TECHNICAL_RESULT, jobId: 'technical:9999:1D:2026-10-08T18' });
    expect(instruments.findOne).toHaveBeenCalledWith({ where: { stockCode: '9999' } });
    expect(ta.rows.size).toBe(0);
    expect(readCache.changed).not.toHaveBeenCalled();
  });
});
