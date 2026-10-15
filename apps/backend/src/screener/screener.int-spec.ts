/**
 * Screener read-model integration test (ticket 01 Testing seam; ADR-0011).
 *
 * Exercises the ticket's highest-value behaviours against REAL infra via
 * testcontainers (throwaway Postgres) — not mocks, because what is decided
 * here is exactly what a mock silently gets wrong: the single read model join
 * (lateral latest-row resolution for bars/shariah/YoY/profitable-years),
 * NULL-ratio exclusion semantics, NULLs-last sorting, per-numeric-class
 * provenance lineage, and total-count pagination.
 *
 * Good test = external behaviour (which stocks a filter returns, ordering,
 * counts), never SQL internals (spec 03 Testing decisions). Seeds a
 * hand-controlled universe (not the synthetic generator) so every filter
 * class has deterministic winners and losers:
 *
 *   0101 PROFIT  MAIN/FS     compliant   pe 8.5  dy .04  close 10.2 (+2%)   above both SMAs, RSI 55
 *   0202 LOSSCO  MAIN/Tech   NON-COMPL   pe null dy null close 5.0  (1 bar, pct null) below SMAs, RSI 25
 *   0303 ACECO   ACE/Tech    no row      pe 15   dy null close 7.9  (-1.25%) sma50 null, RSI 75
 *   0404 STALECO MAIN/Cons   compliant   pe 20   dy null close 3.3  (+10%)  above both, RSI 50, loss FY25
 *   0505 GROWCO  MAIN/Ind    compliant   pe 12   dy .06  close 4.1  (+2.5%) below sma50, RSI 40
 *   0606 LEAPCO  LEAP/Tech   —           never reaches a screen (universe)
 *
 * This is a `.spec.ts` (runs in the default `test` lane per the house
 * pattern) but requires Docker for testcontainers.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

import {
  AnalysisResult,
  Announcement,
  Company,
  CorporateAction,
  FundamentalsSnapshot,
  IndicatorSnapshot,
  IngestionRun,
  Instrument,
  IpoListing,
  NewsArticle,
  NewsArticleTag,
  PriceBar,
  QuarterlyFinancials,
  Sector,
  ShariahStatus,
  SyntheticRun,
  Watchlist,
  WatchlistItem,
} from '../data/entities';
import {
  ListingBoard,
  ProvenanceClass,
  ShariahComplianceStatus,
} from '../data/entities/enums';
import { InitialSchema1727600000000 } from '../data/migrations/1727600000000-InitialSchema';
import { FreeTierDomainModel1727700000000 } from '../data/migrations/1727700000000-FreeTierDomainModel';
import { ReIngestNaturalKeys1727800000000 } from '../data/migrations/1727800000000-ReIngestNaturalKeys';
import { DisclosureReadModel1727900000000 } from '../data/migrations/1727900000000-DisclosureReadModel';
import { IngestionRunService } from '../ingestion/ingestion-run.service';

import type { ScreenerFilters, ScreenerQueryParams } from './screener-query.interface';
import { PgScreenerQuery } from './screener-query.pg';

jest.setTimeout(180_000);

const ALL_ENTITIES = [
  AnalysisResult,
  IngestionRun,
  SyntheticRun,
  Sector,
  Company,
  Instrument,
  PriceBar,
  QuarterlyFinancials,
  FundamentalsSnapshot,
  IndicatorSnapshot,
  CorporateAction,
  ShariahStatus,
  Announcement,
  NewsArticle,
  NewsArticleTag,
  IpoListing,
  Watchlist,
  WatchlistItem,
];

/** Fixed quarter period-ends FY2023Q1 → FY2025Q4 (12 quarters, 3 years). */
const PERIOD_ENDS = [
  '2023-03-31', '2023-06-30', '2023-09-30', '2023-12-31',
  '2024-03-31', '2024-06-30', '2024-09-30', '2024-12-31',
  '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31',
] as const;

/** Net profit per quarter (FY23Q1 → FY25Q4) for every seeded company. */
const QUARTERLY_PROFITS: Record<string, number[]> = {
  // Growing every quarter from FY24 (YoY defined): consecutive 8, all years profitable.
  '0101': [120, 140, 160, 180, 200, 220, 240, 260, 280, 300, 320, 340],
  // Loss-making every quarter, deepening in FY25Q4 (-150 vs -100).
  '0202': [-80, -80, -80, -80, -90, -90, -90, -90, -100, -100, -100, -150],
  // Flat FY23/24, FY25 growing: YoY latest +20%, all years profitable.
  '0303': [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 120],
  // Profitable FY23/24, FY25 sum negative (latest quarter a loss): YoY latest < 0.
  '0404': [50, 50, 50, 50, 60, 60, 60, 60, 70, 70, -100, -100],
  // Growing every year: YoY latest +25%, consecutive 8.
  '0505': [100, 100, 100, 100, 110, 110, 110, 110, 120, 130, 140, 150],
};

/** Fundamentals-snapshot columns per company (stored, never recomputed). */
const SNAPSHOT_VALUES: Record<
  string,
  Omit<Partial<FundamentalsSnapshot>, 'company' | 'ingestionRun'>
> = {
  '0101': { peRatio: '8.5', dividendYield: '0.04', pntaRatio: '1.1', roe: '0.12', debtToEquity: '0.5', consecutiveGrowthQuarters: 8 },
  '0202': { peRatio: null, dividendYield: null, pntaRatio: '0.9', roe: '-0.05', debtToEquity: '2.0', consecutiveGrowthQuarters: 0 },
  '0303': { peRatio: '15', dividendYield: null, pntaRatio: '2.0', roe: '0.08', debtToEquity: '0.9', consecutiveGrowthQuarters: 3 },
  '0404': { peRatio: '20', dividendYield: null, pntaRatio: '1.5', roe: '0.05', debtToEquity: '0.1', consecutiveGrowthQuarters: 1 },
  '0505': { peRatio: '12', dividendYield: '0.06', pntaRatio: '0.8', roe: '0.15', debtToEquity: '0.2', consecutiveGrowthQuarters: 8 },
};

/** Indicator-snapshot columns per company (latest close matches the latest bar). */
const INDICATOR_VALUES: Record<string, Partial<Pick<IndicatorSnapshot, 'sma20' | 'sma50' | 'sma200' | 'rsi14'>>> = {
  '0101': { sma20: '9.8', sma50: '9.5', sma200: '9.0', rsi14: '55' },
  '0202': { sma20: '5.8', sma50: '6.0', sma200: '6.5', rsi14: '25' },
  // sma50 null: aboveSma50 true AND false must both exclude it.
  '0303': { sma20: '8.0', sma50: null, sma200: '8.5', rsi14: '75' },
  '0404': { sma20: '3.1', sma50: '3.0', sma200: '3.0', rsi14: '50' },
  '0505': { sma20: '4.4', sma50: '4.5', sma200: '4.0', rsi14: '40' },
};

/** Price bars per company: [prevClose, close] — one bar = pctChange null. */
const PRICE_BARS: Record<string, { prev: string | null; close: string; volume: string }> = {
  '0101': { prev: '10.0', close: '10.2', volume: '1000000' },
  '0202': { prev: null, close: '5.0', volume: '500000' },
  '0303': { prev: '8.0', close: '7.9', volume: '2000000' },
  '0404': { prev: '3.0', close: '3.3', volume: '1200000' },
  '0505': { prev: '4.0', close: '4.1', volume: '900000' },
};

interface SeedCompany {
  stockCode: string;
  shortName: string;
  fullName: string;
  board: ListingBoard;
  sectorName: string;
  /** null = no shariah row; else [status, effectiveDate]. */
  shariah?: [ShariahComplianceStatus, string] | null;
}

const SEED_COMPANIES: readonly SeedCompany[] = [
  { stockCode: '0101', shortName: 'PROFIT', fullName: 'Profit Berhad', board: ListingBoard.Main, sectorName: 'Financial Services', shariah: [ShariahComplianceStatus.Compliant, '2024-06-01'] },
  { stockCode: '0202', shortName: 'LOSSCO', fullName: 'Loss Company Berhad', board: ListingBoard.Main, sectorName: 'Technology', shariah: [ShariahComplianceStatus.NonCompliant, '2024-06-01'] },
  { stockCode: '0303', shortName: 'ACECO', fullName: 'Ace Company Berhad', board: ListingBoard.Ace, sectorName: 'Technology', shariah: null },
  { stockCode: '0404', shortName: 'STALECO', fullName: 'Stale Company Berhad', board: ListingBoard.Main, sectorName: 'Consumer Products & Services', shariah: [ShariahComplianceStatus.Compliant, '2024-06-01'] },
  { stockCode: '0505', shortName: 'GROWCO', fullName: 'Grow Company Berhad', board: ListingBoard.Main, sectorName: 'Industrial Products & Services', shariah: [ShariahComplianceStatus.Compliant, '2024-06-01'] },
  // LEAP row: exists in the reference tables, never reaches a screen.
  { stockCode: '0606', shortName: 'LEAPCO', fullName: 'Leap Company Berhad', board: ListingBoard.Leap, sectorName: 'Technology', shariah: null },
];

// Module-scope harness state (the helpers below run inside beforeAll).
let pgContainer: StartedPostgreSqlContainer;
let dataSource: DataSource;

describe('Screener read model (integration — testcontainers)', () => {
  let screener: PgScreenerQuery;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      type: 'postgres',
      url: pgContainer.getConnectionUri(),
      synchronize: false,
      entities: ALL_ENTITIES,
      migrations: [
        InitialSchema1727600000000,
        FreeTierDomainModel1727700000000,
        ReIngestNaturalKeys1727800000000,
        DisclosureReadModel1727900000000,
      ],
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    await seedUniverse();
    screener = new PgScreenerQuery(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    await pgContainer?.stop();
  });

  /** Screen with optional filter overrides + sort/page, returning stockCodes. */
  const codes = async (
    filters: Partial<ScreenerFilters> = {},
    opts: Partial<Pick<ScreenerQueryParams, 'sort' | 'dir' | 'offset' | 'limit'>> = {},
  ): Promise<string[]> => {
    const page = await screener.screen(makeParams(filters, opts));
    return page.items.map((r) => r.stockCode);
  };

  // --- universe + default sort ------------------------------------------------

  it('unfiltered screen returns the analysed universe (LEAP excluded), default %change desc, NULLs last', async () => {
    const page = await screener.screen(makeParams());
    expect(page.total).toBe(5);
    expect(page.offset).toBe(0);
    expect(page.limit).toBe(50);
    expect(page.items.map((r) => r.stockCode)).toEqual([
      '0404', // +10%
      '0505', // +2.5%
      '0101', // +2%
      '0303', // -1.25%
      '0202', // null (one bar) — NULLs sort last
    ]);
  });

  it('result row carries the spec-03 shape with per-numeric-class provenance', async () => {
    const page = await screener.screen(makeParams());
    const profit = page.items.find((r) => r.stockCode === '0101');
    if (!profit) throw new Error('0101 missing from unfiltered screen');
    expect(profit).toEqual({
      stockCode: '0101',
      shortName: 'PROFIT',
      sector: 'Financial Services',
      close: 10.2,
      pctChange: 2, // (10.2 − 10) ÷ 10 × 100
      marketCap: 10200, // 10.2 × 1000 shares
      pe: 8.5,
      dy: 0.04,
      pNta: 1.1,
      roe: 0.12,
      de: 0.5,
      // Read-time IngestionRun lineage: bars/fundamentals/indicators all
      // synthetic in the seed; reference fields (code/name/sector) are real
      // by contract, not per-row.
      provenance: {
        price: ProvenanceClass.Synthetic,
        fundamentals: ProvenanceClass.Synthetic,
        technicals: ProvenanceClass.Synthetic,
      },
    });
  });

  it('a loss-maker stays in the universe with null numerics (NULL never matches a band)', async () => {
    const losco = (await screener.screen(makeParams())).items.find(
      (r) => r.stockCode === '0202',
    );
    if (!losco) throw new Error('0202 missing');
    expect(losco.pe).toBeNull(); // loss-maker: NULL P/E, absent from any band
    expect(losco.dy).toBeNull(); // no trailing dividends
    expect(losco.pctChange).toBeNull(); // one bar only
    expect(losco.close).toBe(5);
    expect(losco.marketCap).toBe(5000); // 5 × 1000 shares, snapshot present
  });

  // --- filter classes (external behaviour: which stocks return) ---------------

  it.each([
    ['board=ACE', { boards: [ListingBoard.Ace] }, ['0303']],
    ['shariah=true (latest status COMPLIANT)', { shariah: true }, ['0404', '0505', '0101']],
    ['shariah=false (NON_COMPLIANT; no row matches neither)', { shariah: false }, ['0202']],
    ['priceMin=9', { priceMin: 9 }, ['0101']],
    ['priceMax=5 (inclusive; null close excluded)', { priceMax: 5 }, ['0404', '0505', '0202']],
    ['volumeMin=1500000', { volumeMin: 1_500_000 }, ['0303']],
    ['marketCapMin=8000', { marketCapMin: 8000 }, ['0101']],
    ['marketCapMax=5000', { marketCapMax: 5000 }, ['0404', '0505', '0202']],
    ['peMax=15 (loss-maker NULL excluded)', { peMax: 15 }, ['0505', '0101', '0303']],
    ['peMin=15 (NULL excluded, inclusive)', { peMin: 15 }, ['0404', '0303']],
    ['dyMin=0.01 (NULL DY excluded)', { dyMin: 0.01 }, ['0505', '0101']],
    ['pNtaMax=1.0', { pNtaMax: 1.0 }, ['0505', '0202']],
    ['roeMin=0.1', { roeMin: 0.1 }, ['0505', '0101']],
    ['deMax=0.5 (inclusive)', { deMax: 0.5 }, ['0404', '0505', '0101']],
    ['profitableYearsMin=3 (3 positive years)', { profitableYearsMin: 3 }, ['0505', '0101', '0303']],
    ['profitableYearsMin=1 (FY25-negative companies excluded)', { profitableYearsMin: 1 }, ['0505', '0101', '0303']],
    ['yoyProfitGrowthMin=0 (negative YoY excluded)', { yoyProfitGrowthMin: 0 }, ['0505', '0101', '0303']],
    ['consecutiveGrowthQuartersMin=4', { consecutiveGrowthQuartersMin: 4 }, ['0505', '0101']],
    ['rsi14 50–60 band', { rsi14Min: 50, rsi14Max: 60 }, ['0404', '0101']],
    ['aboveSma50=true (NULL sma matches neither)', { aboveSma50: true }, ['0404', '0101']],
    ['aboveSma50=false (NULL sma matches neither)', { aboveSma50: false }, ['0505', '0202']],
    ['aboveSma200=true', { aboveSma200: true }, ['0404', '0505', '0101']],
    ['aboveSma200=false', { aboveSma200: false }, ['0303', '0202']],
    ['combined: board=ACE + peMin=10', { boards: [ListingBoard.Ace], peMin: 10 }, ['0303']],
  ])('%s → %j', async (_name, filters, expected) => {
    expect(await codes(filters)).toEqual(expected);
  });

  it('sector filter is by FK id list (no string match)', async () => {
    const tech = await dataSource.getRepository(Sector).findOneByOrFail({
      name: 'Technology',
    });
    expect(await codes({ sectorIds: [tech.id] })).toEqual(['0303', '0202']);
    // Unknown-but-valid UUID → empty result, not an error.
    expect(
      await codes({ sectorIds: ['00000000-0000-0000-0000-0000000000ff'] }),
    ).toEqual([]);
  });

  it('shariah is over the LATEST status (max effectiveDate), not any row', async () => {
    // Plant a newer COMPLIANT row for LOSSCO (was NON_COMPLIANT at 2024-06-01):
    // the latest row flips it into shariah=true.
    const losco = await dataSource.getRepository(Company).findOneByOrFail({
      fullName: 'Loss Company Berhad',
    });
    const realRun = await dataSource
      .getRepository(IngestionRun)
      .findOneByOrFail({ provenanceClass: ProvenanceClass.Real });
    await dataSource.getRepository(ShariahStatus).save(
      dataSource.getRepository(ShariahStatus).create({
        companyId: losco.id,
        status: ShariahComplianceStatus.Compliant,
        effectiveDate: '2025-06-01',
        ingestionRunId: realRun.id,
      }),
    );
    expect(await codes({ shariah: true })).toEqual(['0404', '0505', '0101', '0202']);
    expect(await codes({ shariah: false })).toEqual([]);
  });

  // --- sorting ----------------------------------------------------------------

  it.each([
    ['pe asc NULLs last', { sort: 'pe' as const, dir: 'asc' as const }, ['0101', '0505', '0303', '0404', '0202']],
    ['pe desc NULLs still last', { sort: 'pe' as const, dir: 'desc' as const }, ['0404', '0303', '0505', '0101', '0202']],
    ['marketCap asc', { sort: 'marketCap' as const, dir: 'asc' as const }, ['0404', '0505', '0202', '0303', '0101']],
    ['close asc', { sort: 'close' as const, dir: 'asc' as const }, ['0404', '0505', '0202', '0303', '0101']],
    ['pctChange asc NULLs last', { sort: 'pctChange' as const, dir: 'asc' as const }, ['0303', '0101', '0505', '0404', '0202']],
  ])('%s', async (_name, opts, expected) => {
    expect(await codes({}, opts)).toEqual(expected);
  });

  // --- pagination ---------------------------------------------------------------

  it('offset/limit window the ordered result; total counts the whole match', async () => {
    const page = await screener.screen(makeParams({}, { offset: 1, limit: 2 }));
    expect(page.total).toBe(5);
    expect(page.offset).toBe(1);
    expect(page.limit).toBe(2);
    expect(page.items.map((r) => r.stockCode)).toEqual(['0505', '0101']);

    const tail = await screener.screen(makeParams({}, { offset: 4, limit: 50 }));
    expect(tail.items.map((r) => r.stockCode)).toEqual(['0202']);

    const past = await screener.screen(makeParams({}, { offset: 50, limit: 50 }));
    expect(past.items).toEqual([]);
    expect(past.total).toBe(5);
  });

  it('total reflects the filtered match, not the page', async () => {
    const page = await screener.screen(
      makeParams({ dyMin: 0.01 }, { limit: 1 }),
    );
    expect(page.total).toBe(2);
    expect(page.items.map((r) => r.stockCode)).toEqual(['0505']);
  });
});

// --- helpers -------------------------------------------------------------------

/** Base "no constraint" filters; overrides applied on top. */
function makeParams(
  filters: Partial<ScreenerFilters> = {},
  opts: Partial<Pick<ScreenerQueryParams, 'sort' | 'dir' | 'offset' | 'limit'>> = {},
): ScreenerQueryParams {
  const base: ScreenerFilters = {
    boards: [],
    sectorIds: [],
    shariah: null,
    priceMin: null,
    priceMax: null,
    volumeMin: null,
    marketCapMin: null,
    marketCapMax: null,
    peMin: null,
    peMax: null,
    dyMin: null,
    dyMax: null,
    pNtaMin: null,
    pNtaMax: null,
    roeMin: null,
    roeMax: null,
    deMin: null,
    deMax: null,
    profitableYearsMin: null,
    yoyProfitGrowthMin: null,
    consecutiveGrowthQuartersMin: null,
    rsi14Min: null,
    rsi14Max: null,
    aboveSma50: null,
    aboveSma200: null,
  };
  return {
    filters: { ...base, ...filters },
    sort: opts.sort ?? 'pctChange',
    dir: opts.dir ?? 'desc',
    offset: opts.offset ?? 0,
    limit: opts.limit ?? 50,
  };
}

/** Seed the hand-controlled universe (real reference run + synthetic data run). */
async function seedUniverse(): Promise<void> {
  const runs = new IngestionRunService();
  const realRun = await runs.openRun(
    dataSource.manager,
    'ScreenerSeedReferenceAdapter',
    ProvenanceClass.Real,
  );
  const syntheticRun = await runs.openRun(
    dataSource.manager,
    'ScreenerSeedSyntheticAdapter',
    ProvenanceClass.Synthetic,
  );

  const sectorRepo = dataSource.getRepository(Sector);
  const sectorByName = new Map<string, string>();
  const ensureSector = async (name: string): Promise<string> => {
    const cached = sectorByName.get(name);
    if (cached) return cached;
    const sector = await sectorRepo.save(
      sectorRepo.create({ name, subsector: null, ingestionRunId: realRun.id }),
    );
    sectorByName.set(name, sector.id);
    return sector.id;
  };

  const companyRepo = dataSource.getRepository(Company);
  const instrumentRepo = dataSource.getRepository(Instrument);
  const instrumentIds = new Map<string, string>();

  for (const entry of SEED_COMPANIES) {
    const sectorId = await ensureSector(entry.sectorName);
    const company = await companyRepo.save(
      companyRepo.create({
        fullName: entry.fullName,
        board: entry.board,
        aliases: [],
        sectorId,
        ingestionRunId: realRun.id,
      }),
    );
    const instrument = await instrumentRepo.save(
      instrumentRepo.create({
        stockCode: entry.stockCode,
        shortName: entry.shortName,
        fullName: entry.fullName,
        companyId: company.id,
        ingestionRunId: realRun.id,
      }),
    );
    instrumentIds.set(entry.stockCode, instrument.id);

    if (entry.shariah) {
      const [status, effectiveDate] = entry.shariah;
      await dataSource.getRepository(ShariahStatus).save(
        dataSource.getRepository(ShariahStatus).create({
          companyId: company.id,
          status,
          effectiveDate,
          ingestionRunId: realRun.id,
        }),
      );
    }

    // LEAP row stops here — no synthetic data, and the universe filter
    // excludes it anyway.
    if (entry.board === ListingBoard.Leap) continue;

    const instrumentId = instrument.id;
    const profits = QUARTERLY_PROFITS[entry.stockCode];
    await dataSource.getRepository(QuarterlyFinancials).save(
      profits.map((netProfit, i) =>
        dataSource.getRepository(QuarterlyFinancials).create({
          companyId: company.id,
          fiscalYear: 2023 + Math.floor(i / 4),
          fiscalQuarter: (i % 4) + 1,
          periodEnd: PERIOD_ENDS[i],
          revenue: '1000',
          netProfit: netProfit.toFixed(2),
          eps: '0.1',
          equity: '10000',
          nta: '9000',
          intangibles: '1000',
          totalBorrowings: '5000',
          ingestionRunId: syntheticRun.id,
        }),
      ),
    );

    const bars = PRICE_BARS[entry.stockCode];
    const barDates = ['2025-12-30', '2025-12-31'];
    const closes =
      bars.prev === null ? [bars.close] : [bars.prev, bars.close];
    await dataSource.getRepository(PriceBar).save(
      closes.map((close, i) =>
        dataSource.getRepository(PriceBar).create({
          instrumentId,
          tradeDate: barDates[i],
          open: close,
          high: close,
          low: close,
          close,
          volume: bars.volume,
          ingestionRunId: syntheticRun.id,
        }),
      ),
    );

    await dataSource.getRepository(FundamentalsSnapshot).save(
      dataSource.getRepository(FundamentalsSnapshot).create({
        companyId: company.id,
        sharesOutstanding: '1000',
        ntaPerShare: '9.0',
        ttmEps: '0.4',
        ttmRevenue: '4000',
        ttmNetProfit: '400',
        psr: '1.0',
        ...SNAPSHOT_VALUES[entry.stockCode],
        ingestionRunId: syntheticRun.id,
      }),
    );

    const indicator = INDICATOR_VALUES[entry.stockCode];
    await dataSource.getRepository(IndicatorSnapshot).save(
      dataSource.getRepository(IndicatorSnapshot).create({
        instrumentId,
        latestClose: bars.close,
        sma20: indicator.sma20 ?? null,
        sma50: indicator.sma50 ?? null,
        sma200: indicator.sma200 ?? null,
        rsi14: indicator.rsi14 ?? null,
        macd: null,
        macdSignal: null,
        week52High: null,
        week52Low: null,
        ingestionRunId: syntheticRun.id,
      }),
    );
  }
}
