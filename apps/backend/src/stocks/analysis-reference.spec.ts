import { toAnalysisReference } from './analysis-reference';
import type { FundamentalsSnapshot } from '../data/entities/fundamentals-snapshot.entity';
import type { IndicatorSnapshot } from '../data/entities/indicator-snapshot.entity';
import type { Instrument } from '../data/entities/instrument.entity';
import type { QuarterlyFinancials } from '../data/entities/quarterly-financials.entity';

const LATEST_CLOSE_DAY = '2026-09-30';
const AS_OF = '2026-09-30T17:00:00+08:00';

/** Every emitted metric's `(id, unit, scale)`, in emission order. */
const EXPECTED_TRIPLES: [string, string, string][] = [
  ['trailing_pe', 'x', 'absolute'],
  ['dividend_yield', '%', 'fraction'],
  ['roe', '%', 'fraction'],
  ['debt_to_equity', 'x', 'absolute'],
  ['revenue_growth_qoq', '%', 'percentage_point'],
  ['revenue_growth_yoy', '%', 'percentage_point'],
  ['profit_growth_qoq', '%', 'percentage_point'],
  ['profit_growth_yoy', '%', 'percentage_point'],
  ['operating_cash_flow', 'RM bn', 'absolute'],
];

describe('toAnalysisReference', () => {
  const makeInstrument = (): Instrument => ({
    id: 'inst-id',
    stockCode: '1155',
    shortName: 'MAYBANK',
    fullName: 'Malayan Banking Berhad',
    company: null as any,
    companyId: 'company-id',
    ingestionRun: null as any,
    ingestionRunId: 'run-id',
    createdAt: new Date(),
  });

  const makeSnap = (): IndicatorSnapshot => ({
    id: 'snap-id',
    instrumentId: 'inst-id',
    instrument: null as any,
    latestClose: '10.02',
    sma20: '9.7',
    sma50: '9.55',
    sma200: '9.3',
    rsi14: '57.4',
    macd: '0.02123',
    macdSignal: '0.015',
    week52High: '10.45',
    week52Low: '8.32',
    ingestionRunId: 'run-id',
    ingestionRun: null as any,
    createdAt: new Date(),
  });

  const makeFundSnap = (
    overrides: Partial<FundamentalsSnapshot> = {},
  ): FundamentalsSnapshot => ({
    id: 'fund-snap-id',
    company: null as any,
    companyId: 'company-id',
    sharesOutstanding: '1000000000',
    ntaPerShare: '8.4',
    ttmEps: '0.72',
    ttmRevenue: '26000000000',
    ttmNetProfit: '7200000000',
    peRatio: '13.92',
    dividendYield: '0.045',
    pntaRatio: '1.193',
    roe: '0.124',
    debtToEquity: '1.35',
    psr: '4.4',
    consecutiveGrowthQuarters: 6,
    ingestionRunId: 'run-id',
    ingestionRun: null as any,
    createdAt: new Date(),
    ...overrides,
  });

  /** `periodEnd` descending; revenue/netProfit are TypeORM `numeric` strings. */
  const makeQuarter = (
    overrides: Partial<QuarterlyFinancials>,
  ): QuarterlyFinancials => ({
    id: 'quarter-id',
    company: null as any,
    companyId: 'company-id',
    fiscalYear: 2026,
    fiscalQuarter: 2,
    periodEnd: '2026-06-30',
    revenue: '110',
    netProfit: '55',
    eps: '0.055',
    equity: '58000',
    nta: '54000',
    intangibles: '4000',
    totalBorrowings: '78000',
    ingestionRunId: 'run-id',
    ingestionRun: null as any,
    createdAt: new Date(),
    ...overrides,
  });

  const reference = ({
    fundSnap = makeFundSnap(),
    quarters = [],
  }: {
    fundSnap?: FundamentalsSnapshot | null;
    quarters?: QuarterlyFinancials[];
  } = {}) =>
    toAnalysisReference(
      makeInstrument(),
      makeSnap(),
      fundSnap,
      quarters,
      [],
      LATEST_CLOSE_DAY,
      AS_OF,
    );

  const metricById = (ref: ReturnType<typeof reference>, id: string) =>
    ref.fundamental.metrics.find((m) => m.id === id)!;

  it('emits the nine metrics in order, each with its declared (id, unit, scale)', () => {
    const ref = reference({ quarters: [makeQuarter({}), makeQuarter({ id: 'q1', fiscalQuarter: 1, periodEnd: '2026-03-31', revenue: '100', netProfit: '50' })] });

    expect(ref.fundamental.metrics).toHaveLength(9);
    expect(ref.fundamental.metrics.map((m) => [m.id, m.unit, m.scale])).toEqual(
      EXPECTED_TRIPLES,
    );
  });

  it('leaves dividend_yield as a fraction, not a rescaled percentage', () => {
    const ref = reference({ fundSnap: makeFundSnap({ dividendYield: '0.045' }) });

    const metric = metricById(ref, 'dividend_yield');
    expect(metric.value).toBe(0.045);
    expect(metric.scale).toBe('fraction');
    expect(metric.unit).toBe('%');
  });

  it('leaves roe as a fraction too', () => {
    const ref = reference({ fundSnap: makeFundSnap({ roe: '0.124' }) });

    const metric = metricById(ref, 'roe');
    expect(metric.value).toBe(0.124);
    expect(metric.scale).toBe('fraction');
  });

  it('converts decimal-string snapshot fields through toNumber without rescaling', () => {
    const ref = reference({
      fundSnap: makeFundSnap({ peRatio: '13.916000', debtToEquity: '1.350000' }),
    });

    expect(metricById(ref, 'trailing_pe').value).toBe(13.916);
    expect(metricById(ref, 'trailing_pe').scale).toBe('absolute');
    expect(metricById(ref, 'debt_to_equity').value).toBe(1.35);
    expect(metricById(ref, 'debt_to_equity').scale).toBe('absolute');
  });

  it('emits revenue_growth_qoq as percentage points already multiplied by 100', () => {
    const ref = reference({
      quarters: [
        makeQuarter({ revenue: '110' }),
        makeQuarter({ id: 'q1', fiscalQuarter: 1, periodEnd: '2026-03-31', revenue: '100' }),
      ],
    });

    const metric = metricById(ref, 'revenue_growth_qoq');
    expect(metric.value).toBe(10);
    expect(metric.scale).toBe('percentage_point');
  });

  it('emits profit_growth_qoq as percentage points already multiplied by 100', () => {
    const ref = reference({
      quarters: [
        makeQuarter({ netProfit: '55' }),
        makeQuarter({ id: 'q1', fiscalQuarter: 1, periodEnd: '2026-03-31', netProfit: '50' }),
      ],
    });

    const metric = metricById(ref, 'profit_growth_qoq');
    expect(metric.value).toBe(10);
    expect(metric.scale).toBe('percentage_point');
  });

  it('emits a negative revenue_growth_qoq in percentage points', () => {
    const ref = reference({
      quarters: [
        makeQuarter({ revenue: '90' }),
        makeQuarter({ id: 'q1', fiscalQuarter: 1, periodEnd: '2026-03-31', revenue: '100' }),
      ],
    });

    const metric = metricById(ref, 'revenue_growth_qoq');
    expect(metric.value).toBe(-10);
    expect(metric.scale).toBe('percentage_point');
  });

  it('divides a fall by the prior quarter, so 110 -> 100 is -9.09pp, not -10pp', () => {
    const ref = reference({
      quarters: [
        makeQuarter({ revenue: '100' }),
        makeQuarter({ id: 'q1', fiscalQuarter: 1, periodEnd: '2026-03-31', revenue: '110' }),
      ],
    });

    const metric = metricById(ref, 'revenue_growth_qoq');
    expect(metric.value).toBeCloseTo(-9.09090909, 6);
    expect(metric.scale).toBe('percentage_point');
  });

  it('leaves revenue_growth_qoq null when fewer than two quarters exist', () => {
    const ref = reference({ quarters: [makeQuarter({})] });

    const metric = metricById(ref, 'revenue_growth_qoq');
    expect(metric.value).toBeNull();
    expect(metric.scale).toBe('percentage_point');
  });

  it('keeps the declared scale on the three always-null rows', () => {
    const ref = reference({
      quarters: [
        makeQuarter({}),
        makeQuarter({ id: 'q1', fiscalQuarter: 1, periodEnd: '2026-03-31', revenue: '100', netProfit: '50' }),
      ],
    });

    const declared: [string, string, null][] = [
      ['revenue_growth_yoy', 'percentage_point', null],
      ['profit_growth_yoy', 'percentage_point', null],
      ['operating_cash_flow', 'absolute', null],
    ];
    for (const [id, scale, value] of declared) {
      const metric = metricById(ref, id);
      expect([metric.scale, metric.value]).toEqual([scale, value]);
    }
  });

  it('emits all nine metrics with null values when there is no fundamentals snapshot', () => {
    const ref = reference({ fundSnap: null });

    expect(ref.fundamental.metrics).toHaveLength(9);
    expect(ref.fundamental.metrics.every((m) => m.value === null)).toBe(true);
    expect(ref.fundamental.metrics.map((m) => [m.id, m.unit, m.scale])).toEqual(
      EXPECTED_TRIPLES,
    );
  });
});
