import type { DataSource, Repository } from 'typeorm';
import { StockAnalysisStatus } from '../data/entities/enums';
import type { Instrument } from '../data/entities/instrument.entity';
import type { TechnicalAnalysis } from '../data/entities/technical-analysis.entity';
import type { FundamentalAnalysis } from '../data/entities/fundamental-analysis.entity';
import { InMemoryJobBus } from '../jobbus/in-memory-job-bus';
import { JobNames } from '../jobbus/job-names';
import type { StockAnalysis } from '../analysis/stock-analysis';
import {
  buildFundamentalEnvelope,
  buildTechnicalEnvelope,
  KlciEnqueueService,
  shouldSkipSameDayAnalysis,
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
  const TA_ID = 'ta-1155-1D-2026-10-09T15';
  const FA_ID = 'fa-1155-quarterly-2026-10-09T15';

  function setup(opts?: {
    taRow?: TechnicalAnalysis | null;
    faRow?: FundamentalAnalysis | null;
    hasInstrument?: boolean;
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

    const pending: Array<{ jobName: string; instrumentId: string; jobId: string }> = [];
    const analyses = {
      findByInstrumentId: async (jobName: string) =>
        (jobName === JobNames.technical ? opts?.taRow : opts?.faRow) ?? null,
      markPending: async (
        jobName: string,
        instrument: { id: string },
        job: { jobId: string },
      ) => {
        pending.push({ jobName, instrumentId: instrument.id, jobId: job.jobId });
      },
    } as unknown as StockAnalysis;

    const bus = new InMemoryJobBus();
    const service = new KlciEnqueueService(dataSource, bus, analyses);
    return { service, bus, pending };
  }

  const readyToday = {
    status: StockAnalysisStatus.Ready,
    asOf: new Date('2026-10-09T01:00:00.000Z'),
    updatedAt: new Date('2026-10-09T01:00:00.000Z'),
  } as TechnicalAnalysis;

  it('skips same-day ready for both job types', async () => {
    const { service, bus, pending } = setup({
      taRow: readyToday,
      faRow: readyToday as unknown as FundamentalAnalysis,
    });

    const result = await service.enqueue({ stockCode: '1155', now: NOW });
    expect(result.skipped).toEqual([
      '1155:analyze-technical',
      '1155:analyze-fundamental',
    ]);
    expect(result.enqueued).toEqual([]);
    expect(bus.added).toHaveLength(0);
    expect(pending).toHaveLength(0);
  });

  it('--force re-enqueues despite ready today and marks pending with the bull id', async () => {
    const { service, bus, pending } = setup({
      taRow: readyToday,
      faRow: readyToday as unknown as FundamentalAnalysis,
    });

    const result = await service.enqueue({ stockCode: '1155', force: true, now: NOW });
    expect(result.enqueued).toEqual([
      '1155:analyze-technical',
      '1155:analyze-fundamental',
    ]);
    expect(bus.added.map((j) => [j.name, j.id])).toEqual([
      [JobNames.technical, TA_ID],
      [JobNames.fundamental, FA_ID],
    ]);
    expect(pending).toEqual([
      { jobName: JobNames.technical, instrumentId: INST_ID, jobId: TA_ID },
      { jobName: JobNames.fundamental, instrumentId: INST_ID, jobId: FA_ID },
    ]);
  });

  it('single-code fans out exactly two system jobs', async () => {
    const { service, bus } = setup();
    const result = await service.enqueue({ stockCode: '1155', now: NOW });
    expect(result.enqueued).toHaveLength(2);
    expect(bus.added[0]!.data).toMatchObject({
      trigger: 'system',
      payload: { symbol: '1155', timeframe: '1D' },
    });
    expect(bus.added[1]!.data).toMatchObject({
      payload: { symbol: '1155', period: 'quarterly' },
    });
  });

  it('throws for a stockCode outside KLCI 30', async () => {
    const { service } = setup();
    await expect(
      service.enqueue({ stockCode: '9999', now: NOW }),
    ).rejects.toThrow(/not in the KLCI 30/);
  });

  it('reports a missing instrument as failed', async () => {
    const { service, bus } = setup({ hasInstrument: false });
    const result = await service.enqueue({ stockCode: '1155', now: NOW });
    expect(result.failed).toEqual(['1155:missing-instrument']);
    expect(bus.added).toHaveLength(0);
  });

  it('a waiting job is alreadyInFlight (no pending reset); a finished one is replaced', async () => {
    const { service, bus, pending } = setup();
    await service.enqueue({ stockCode: '1155', now: NOW });
    pending.length = 0;

    const again = await service.enqueue({ stockCode: '1155', force: true, now: NOW });
    expect(again.alreadyInFlight).toEqual([
      '1155:analyze-technical',
      '1155:analyze-fundamental',
    ]);
    expect(pending).toHaveLength(0);
    expect(bus.added).toHaveLength(2);

    bus.setState(TA_ID, 'completed');
    bus.setState(FA_ID, 'failed');
    const rerun = await service.enqueue({ stockCode: '1155', force: true, now: NOW });
    expect(rerun.enqueued).toHaveLength(2);
    expect(bus.added).toHaveLength(4);
    expect(bus.job(TA_ID)?.state).toBe('waiting');
  });
});
