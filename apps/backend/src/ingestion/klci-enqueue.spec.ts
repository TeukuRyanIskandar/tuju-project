import type { DataSource, Repository } from 'typeorm';
import type { Queue } from 'bullmq';
import { StockAnalysisStatus } from '../data/entities/enums';
import type { Instrument } from '../data/entities/instrument.entity';
import type { TechnicalAnalysis } from '../data/entities/technical-analysis.entity';
import type { FundamentalAnalysis } from '../data/entities/fundamental-analysis.entity';
import type { JobBus } from '../jobbus/job-bus.service';
import { JobNames } from '../jobbus/job-names';
import type { TechnicalAnalysisStore } from '../analysis/technical-analysis.store';
import type { FundamentalAnalysisStore } from '../analysis/fundamental-analysis.store';
import {
  buildFundamentalEnvelope,
  buildTechnicalEnvelope,
  KlciEnqueueService,
  shouldSkipSameDayAnalysis,
  taFaBullJobId,
} from './klci-enqueue.service';

const NOW = new Date('2026-10-09T15:00:00.000Z');
const INST_ID = 'inst-1155';

describe('klci enqueue helpers', () => {
  it('builds system TA/FA envelopes',
    () => {
      const ta = buildTechnicalEnvelope('1155', NOW);
      expect(ta).toMatchObject({
        requestedBy: 'system',
        trigger: 'system',
        asOf: NOW.toISOString(),
        payload: { symbol: '1155', timeframe: '1D' },
      });
      expect(ta.correlationId).toMatch(/^[0-9a-f-]{36}$/);

      const fa = buildFundamentalEnvelope('1155', NOW);
      expect(fa).toMatchObject({
        requestedBy: 'system',
        trigger: 'system',
        payload: { symbol: '1155', period: 'quarterly' },
      });
    },
  );

  it('derives ta/fa BullMQ ids matching hour-bucket form', () => {
    expect(taFaBullJobId('ta', '1155', '1D', '2026-10-09T15:00:00.000Z')).toBe(
      'ta-1155-1D-2026-10-09T15',
    );
    expect(
      taFaBullJobId('fa', '1155', 'quarterly', '2026-10-09T15:00:00.000Z'),
    ).toBe('fa-1155-quarterly-2026-10-09T15');
  });

  it('skips ready/facts_only same UTC day unless force', () => {
    const readyToday = {
      status: StockAnalysisStatus.Ready,
      asOf: new Date('2026-10-09T08:00:00.000Z'),
      updatedAt: new Date('2026-10-09T08:00:00.000Z'),
    };
    expect(shouldSkipSameDayAnalysis(readyToday, NOW, false)).toBe(true);
    expect(shouldSkipSameDayAnalysis(readyToday, NOW, true)).toBe(false);

    const factsOnly = {
      ...readyToday,
      status: StockAnalysisStatus.FactsOnly,
      asOf: null,
    };
    expect(shouldSkipSameDayAnalysis(factsOnly, NOW, false)).toBe(true);

    const readyYesterday = {
      status: StockAnalysisStatus.Ready,
      asOf: new Date('2026-10-08T23:00:00.000Z'),
      updatedAt: new Date('2026-10-08T23:00:00.000Z'),
    };
    expect(shouldSkipSameDayAnalysis(readyYesterday, NOW, false)).toBe(false);

    expect(
      shouldSkipSameDayAnalysis(
        {
          status: StockAnalysisStatus.Failed,
          asOf: NOW,
          updatedAt: NOW,
        },
        NOW,
        false,
      ),
    ).toBe(false);
    expect(shouldSkipSameDayAnalysis(null, NOW, false)).toBe(false);
  });
});

describe('KlciEnqueueService', () => {
  function setup(opts?: {
    taRow?: TechnicalAnalysis | null;
    faRow?: FundamentalAnalysis | null;
    hasInstrument?: boolean;
    jobState?: string | null;
  }) {
    const hasInstrument = opts?.hasInstrument !== false;
    const instruments = {
      findOne: async ({ where }: { where: { stockCode: string } }) =>
        hasInstrument && where.stockCode === '1155'
          ? ({ id: INST_ID, stockCode: '1155' } as Instrument)
          : null,
    } as unknown as Repository<Instrument>;

    const dataSource = {
      getRepository: () => instruments,
    } as unknown as DataSource;

    const taUpserts: unknown[] = [];
    const faUpserts: unknown[] = [];
    const technical = {
      findByInstrumentId: async () => opts?.taRow ?? null,
      upsert: async (input: unknown) => {
        taUpserts.push(input);
      },
    } as unknown as TechnicalAnalysisStore;
    const fundamental = {
      findByInstrumentId: async () => opts?.faRow ?? null,
      upsert: async (input: unknown) => {
        faUpserts.push(input);
      },
    } as unknown as FundamentalAnalysisStore;

    const enqueued: Array<{ jobName: string; env: unknown }> = [];
    let existingJob: {
      getState: () => Promise<string>;
      remove: () => Promise<void>;
    } | null = null;
    if (opts?.jobState) {
      existingJob = {
        getState: async () => opts.jobState!,
        remove: async () => {
          existingJob = null;
        },
      };
    }

    const queue = {
      getJob: async () => existingJob,
    } as unknown as Queue;

    const jobBus = {
      getQueue: () => queue,
      enqueue: async (jobName: string, env: unknown) => {
        enqueued.push({ jobName, env });
        const payload = (env as { payload: { symbol: string }; asOf: string });
        const prefix = jobName === JobNames.technical ? 'ta' : 'fa';
        const disc =
          jobName === JobNames.technical ? '1D' : 'quarterly';
        return {
          jobId: taFaBullJobId(prefix, payload.payload.symbol, disc, payload.asOf),
        };
      },
    } as unknown as JobBus;

    const service = new KlciEnqueueService(
      dataSource,
      jobBus,
      technical,
      fundamental,
    );

    return { service, enqueued, taUpserts, faUpserts };
  }

  it('skips same-day ready for both job types', async () => {
    const ready = {
      status: StockAnalysisStatus.Ready,
      asOf: new Date('2026-10-09T01:00:00.000Z'),
      updatedAt: new Date('2026-10-09T01:00:00.000Z'),
    } as TechnicalAnalysis;
    const { service, enqueued, taUpserts, faUpserts } = setup({
      taRow: ready,
      faRow: ready as unknown as FundamentalAnalysis,
    });

    const result = await service.enqueue({ stockCode: '1155', now: NOW });
    expect(result.skipped).toEqual([
      '1155:analyze-technical',
      '1155:analyze-fundamental',
    ]);
    expect(result.enqueued).toEqual([]);
    expect(enqueued).toHaveLength(0);
    expect(taUpserts).toHaveLength(0);
    expect(faUpserts).toHaveLength(0);
  });

  it('--force re-enqueues despite ready today and upserts pending', async () => {
    const ready = {
      status: StockAnalysisStatus.Ready,
      asOf: new Date('2026-10-09T01:00:00.000Z'),
      updatedAt: new Date('2026-10-09T01:00:00.000Z'),
    } as TechnicalAnalysis;
    const { service, enqueued, taUpserts, faUpserts } = setup({
      taRow: ready,
      faRow: ready as unknown as FundamentalAnalysis,
    });

    const result = await service.enqueue({
      stockCode: '1155',
      force: true,
      now: NOW,
    });
    expect(result.enqueued).toEqual([
      '1155:analyze-technical',
      '1155:analyze-fundamental',
    ]);
    expect(enqueued.map((e) => e.jobName)).toEqual([
      JobNames.technical,
      JobNames.fundamental,
    ]);
    expect(taUpserts).toEqual([
      expect.objectContaining({
        instrumentId: INST_ID,
        status: StockAnalysisStatus.Pending,
        headline: null,
        errorMessage: null,
      }),
    ]);
    expect(faUpserts).toEqual([
      expect.objectContaining({
        instrumentId: INST_ID,
        status: StockAnalysisStatus.Pending,
      }),
    ]);
  });

  it('single-code fans out exactly two jobs and upserts pending', async () => {
    const { service, enqueued, taUpserts, faUpserts } = setup();
    const result = await service.enqueue({ stockCode: '1155', now: NOW });
    expect(result.enqueued).toHaveLength(2);
    expect(enqueued).toHaveLength(2);
    expect(taUpserts).toHaveLength(1);
    expect(faUpserts).toHaveLength(1);
    expect(enqueued[0]!.env).toMatchObject({
      trigger: 'system',
      payload: { symbol: '1155', timeframe: '1D' },
    });
    expect(enqueued[1]!.env).toMatchObject({
      payload: { symbol: '1155', period: 'quarterly' },
    });
  });

  it('throws for a stockCode outside KLCI 30', async () => {
    const { service } = setup();
    await expect(
      service.enqueue({ stockCode: '9999', now: NOW }),
    ).rejects.toThrow(/not in the KLCI 30/);
  });

  it('treats waiting BullMQ job as alreadyInFlight', async () => {
    const { service, enqueued } = setup({ jobState: 'waiting' });
    const result = await service.enqueue({ stockCode: '1155', now: NOW });
    expect(result.alreadyInFlight).toEqual([
      '1155:analyze-technical',
      '1155:analyze-fundamental',
    ]);
    expect(enqueued).toHaveLength(0);
  });
});
