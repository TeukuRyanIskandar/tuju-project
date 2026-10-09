import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { JobFailure, JobResult } from '@tuju/contracts';
import type { JobBus } from '../jobbus/job-bus.service';
import type { Repository } from 'typeorm';
import { TechnicalAnalysis } from '../data/entities/technical-analysis.entity';
import { FundamentalAnalysis } from '../data/entities/fundamental-analysis.entity';
import { Instrument } from '../data/entities/instrument.entity';
import { StockAnalysisStatus } from '../data/entities/enums';
import { TechnicalAnalysisStore } from './technical-analysis.store';
import { FundamentalAnalysisStore } from './fundamental-analysis.store';
import {
  stockCodeFromFundamentalBullJobId,
  stockCodeFromFundamentalJobResultId,
  stockCodeFromTechnicalBullJobId,
  stockCodeFromTechnicalJobResultId,
} from './stock-analysis.upsert';

const FIXTURES = resolve(__dirname, '../../../../packages/contracts/fixtures');

const TECHNICAL_RESULT = JSON.parse(
  readFileSync(resolve(FIXTURES, 'job-result-technical-system.json'), 'utf-8'),
) as JobResult;

const FUNDAMENTAL_RESULT = JSON.parse(
  readFileSync(resolve(FIXTURES, 'job-result-fundamental-system.json'), 'utf-8'),
) as JobResult;

type ResultHandler = (r: JobResult) => void;
type FailureHandler = (f: JobFailure) => void;

function fakeJobBus(): {
  bus: JobBus;
  results: ResultHandler[];
  failures: FailureHandler[];
} {
  const results: ResultHandler[] = [];
  const failures: FailureHandler[] = [];
  const bus = {
    onResult: (h: ResultHandler) => {
      results.push(h);
    },
    onFailure: (h: FailureHandler) => {
      failures.push(h);
    },
  } as unknown as JobBus;
  return { bus, results, failures };
}

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

function instrument(stockCode: string, id = 'inst-1155'): Instrument {
  return { id, stockCode } as Instrument;
}

describe('stock analysis job id parsing', () => {
  it('extracts stockCode from JobResult and BullMQ ids', () => {
    expect(stockCodeFromTechnicalJobResultId(TECHNICAL_RESULT.jobId)).toBe(
      '1155',
    );
    expect(stockCodeFromFundamentalJobResultId(FUNDAMENTAL_RESULT.jobId)).toBe(
      '1155',
    );
    expect(stockCodeFromTechnicalBullJobId('ta-1155-1D-2026-10-08T18')).toBe(
      '1155',
    );
    expect(
      stockCodeFromFundamentalBullJobId('fa-1155-quarterly-2026-10-08T18'),
    ).toBe('1155');
    expect(stockCodeFromTechnicalJobResultId('brief:2026-10-08')).toBeNull();
    expect(stockCodeFromFundamentalBullJobId('ta-1155-1D-x')).toBeNull();
  });
});

describe('TechnicalAnalysisStore', () => {
  it('upsert pending → ready; unique per instrument; failure path; never facts_only', async () => {
    const { bus, results, failures } = fakeJobBus();
    const { repo, rows, upsertCalls } = fakeRepo<TechnicalAnalysis>();
    const instruments = {
      findOne: async ({ where }: { where: { stockCode: string } }) =>
        where.stockCode === '1155' ? instrument('1155') : null,
    } as unknown as Repository<Instrument>;

    const store = new TechnicalAnalysisStore(bus, repo, instruments);
    store.onModuleInit();

    await store.upsert({
      instrumentId: 'inst-1155',
      status: StockAnalysisStatus.Pending,
      correlationId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      jobId: 'ta-1155-1D-2026-10-08T18',
    });
    expect(rows.get('inst-1155')?.status).toBe(StockAnalysisStatus.Pending);

    await Promise.resolve(results[0](TECHNICAL_RESULT));
    await new Promise((r) => setImmediate(r));

    const ready = rows.get('inst-1155');
    expect(ready?.status).toBe(StockAnalysisStatus.Ready);
    expect(ready?.headline).toBe(TECHNICAL_RESULT.summary.headline);
    expect(ready?.artifactBucket).toBe(TECHNICAL_RESULT.pointer.bucket);
    expect(ready?.artifactKey).toBe(TECHNICAL_RESULT.pointer.key);
    expect(ready?.errorMessage).toBeNull();

    await store.upsert({
      instrumentId: 'inst-1155',
      status: StockAnalysisStatus.Pending,
      correlationId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
      jobId: 'ta-1155-1D-2026-10-08T19',
    });
    expect(rows.size).toBe(1);

    await Promise.resolve(
      failures[0]({
        correlationId: '',
        jobId: 'ta-1155-1D-2026-10-08T19',
        failureClass: 'transient_exhausted',
        retryable: true,
        userMessage: 'worker blew up',
        at: new Date().toISOString(),
      }),
    );
    await new Promise((r) => setImmediate(r));

    expect(rows.get('inst-1155')?.status).toBe(StockAnalysisStatus.Failed);
    expect(rows.get('inst-1155')?.errorMessage).toBe('worker blew up');
    expect(rows.size).toBe(1);

    expect(
      upsertCalls.every(
        (row) =>
          (row as TechnicalAnalysis).status !== StockAnalysisStatus.FactsOnly,
      ),
    ).toBe(true);
  });

  it('ignores non-technical JobResults and verdict-bearing summaries', async () => {
    const { bus, results } = fakeJobBus();
    const { repo, rows } = fakeRepo<TechnicalAnalysis>();
    const instruments = {
      findOne: jest.fn(),
    } as unknown as Repository<Instrument>;
    const store = new TechnicalAnalysisStore(bus, repo, instruments);
    store.onModuleInit();

    await Promise.resolve(results[0](FUNDAMENTAL_RESULT));
    await Promise.resolve(
      results[0]({
        ...TECHNICAL_RESULT,
        summary: {
          verdict: 'bullish',
          headline: 'x',
          asOf: '2026-10-08T18:00:00Z',
        },
      }),
    );
    await new Promise((r) => setImmediate(r));

    expect(rows.size).toBe(0);
    expect(instruments.findOne).not.toHaveBeenCalled();
  });
});

describe('FundamentalAnalysisStore', () => {
  it('hook with fixture SystemSummary → ready; failure → failed; never facts_only', async () => {
    const { bus, results, failures } = fakeJobBus();
    const { repo, rows, upsertCalls } = fakeRepo<FundamentalAnalysis>();
    const instruments = {
      findOne: async ({ where }: { where: { stockCode: string } }) =>
        where.stockCode === '1155' ? instrument('1155', 'inst-fa') : null,
    } as unknown as Repository<Instrument>;

    const store = new FundamentalAnalysisStore(bus, repo, instruments);
    store.onModuleInit();

    await store.upsert({
      instrumentId: 'inst-fa',
      status: StockAnalysisStatus.Pending,
      correlationId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
      jobId: 'fa-1155-quarterly-2026-10-08T18',
    });

    await Promise.resolve(results[0](FUNDAMENTAL_RESULT));
    await new Promise((r) => setImmediate(r));

    expect(rows.get('inst-fa')?.status).toBe(StockAnalysisStatus.Ready);
    expect(rows.get('inst-fa')?.headline).toBe(
      FUNDAMENTAL_RESULT.summary.headline,
    );

    await Promise.resolve(
      failures[0]({
        correlationId: '',
        jobId: 'fa-1155-quarterly-2026-10-08T18',
        failureClass: 'terminal',
        retryable: false,
        userMessage: 'grounding hard-fail stub',
        at: new Date().toISOString(),
      }),
    );
    await new Promise((r) => setImmediate(r));

    expect(rows.get('inst-fa')?.status).toBe(StockAnalysisStatus.Failed);
    expect(rows.get('inst-fa')?.errorMessage).toBe('grounding hard-fail stub');
    expect(
      upsertCalls.every(
        (row) =>
          (row as FundamentalAnalysis).status !==
          StockAnalysisStatus.FactsOnly,
      ),
    ).toBe(true);
  });
});
