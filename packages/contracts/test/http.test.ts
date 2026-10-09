import { describe, expect, it } from 'vitest';
import {
  AnnouncementDetail,
  AnnouncementsPage,
  ContractParseError,
  CorporateActionCalendarWindow,
  CorporateActionsPage,
  IndexSeriesResponse,
  IndicesResponse,
  MarketAnnouncementsPage,
  MarketBriefResponse,
  MoversResponse,
  NewsPage,
  ProspectusAtAGlanceResponse,
  ResultsCalendarWindow,
  ScreenerFieldsResponse,
  ScreenerResponse,
  SearchResponse,
  SectorsResponse,
  SessionUser,
  StockCorePayload,
  StockFundamentalAnalysisResponse,
  StockSeriesResponse,
  StockTechnicalAnalysisResponse,
  buildJsonSchema,
  modelOrder,
  parseOrThrow,
} from '../src/index.js';

/**
 * One sample per backend read endpoint (ADR-0014), lifted from the backend
 * integration-test expectations (`apps/backend/src/*\/*.int.spec.ts`) so a
 * backend response shape change that is not mirrored here fails one side first.
 * Values the specs only assert indirectly (stored-row numerics, index levels)
 * are taken from the specs' own seed constants.
 */

const SECTOR_ID = '0b4f9f0e-5b0b-4d55-9a6b-3f3a8a1f6c11';
const INDEX_ID = '7c1d2a44-2d1c-4f3e-8c79-0f3f6b7a9e21';

const samples = {
  // stocks.int.spec.ts (MAYBANK seed; TypeORM numerics converted to numbers)
  'GET /stocks/:code': [
    StockCorePayload,
    {
      identity: {
        provenance: 'real',
        stockCode: '1155',
        shortName: 'MAYBANK',
        fullName: 'Malayan Banking Berhad',
        companyName: 'Malayan Banking Berhad',
        board: 'MAIN',
        sector: 'Financial Services',
      },
      fundamentals: {
        provenance: 'synthetic',
        peRatio: 18.3,
        dividendYield: 0.0567,
        pntaRatio: 3.24,
        roe: 0.1134,
        debtToEquity: 0.97,
        psr: 3.38,
        ttmEps: 0.55123,
        ttmRevenue: 51234000000,
        ttmNetProfit: 4800000000,
        ntaPerShare: 3.1,
        sharesOutstanding: 8700000000,
        consecutiveGrowthQuarters: 4,
        lossMaking: false,
      },
      technicals: {
        provenance: 'synthetic',
        sma20: 9.7,
        sma50: 9.55,
        sma200: 9.3,
        rsi14: 57.4,
        macd: 0.02123,
        macdSignal: 0.015,
        week52High: 10.45,
        week52Low: 8.32,
        latestClose: 10.02,
        pctChange: 1.519756838905777,
      },
      shariah: { provenance: 'real', status: 'COMPLIANT', effectiveDate: '2025-11-28' },
    },
  ],
  'GET /stocks/:code/announcements': [
    AnnouncementsPage,
    {
      items: [
        {
          provenance: 'aggregator',
          category: 'FINANCIAL_RESULTS',
          title: 'Quarterly report on consolidated results',
          filedAt: '2026-09-28T10:00:00.000Z',
          sourceUrl: 'https://example-bursa-feed/1155/results-q2',
          aiSummary: 'Net profit rose on higher net interest income.',
          aiSummaryAsOf: null,
        },
      ],
      total: 3,
      offset: 0,
      limit: 50,
    },
  ],
  'GET /stocks/:code/corporate-actions': [
    CorporateActionsPage,
    {
      items: [
        { provenance: 'aggregator', type: 'DIVIDEND', exDate: '2025-12-05', amount: 0.3 },
        { provenance: 'aggregator', type: 'BONUS', exDate: '2026-03-02', amount: null },
      ],
      total: 3,
      offset: 0,
      limit: 50,
    },
  ],
  'GET /stocks/:code/series': [
    StockSeriesResponse,
    {
      code: '1155',
      interval: '1d',
      range: '2y',
      points: [
        {
          date: '2026-10-07',
          open: '9.950000',
          high: '10.100000',
          low: '9.900000',
          close: '10.020000',
          volume: '12500000',
        },
      ],
      provenance: 'real',
      demoLabel: 'private-demo',
    },
  ],
  'GET /stocks/:code/analysis/technical': [
    StockTechnicalAnalysisResponse,
    {
      code: '1155',
      jobName: 'analyze-technical',
      status: 'ready',
      headline: 'RSI-14 at 57.4; SMA-50 cross fired on the latest close.',
      asOf: '2026-10-08T18:00:00.000Z',
      artifact: {
        bucket: 'tuju-artifacts',
        key: 'analysis/technical/1155/2026-10-08T18.json',
      },
      artifactPath: '/stocks/1155/analysis/technical/artifact',
      errorMessage: null,
    },
  ],
  'GET /stocks/:code/analysis/fundamental': [
    StockFundamentalAnalysisResponse,
    {
      code: '1155',
      jobName: 'analyze-fundamental',
      status: 'pending',
      headline: null,
      asOf: null,
      artifact: null,
      artifactPath: null,
      errorMessage: null,
    },
  ],
  // search.int.spec.ts
  'GET /search': [
    SearchResponse,
    {
      query: '1155',
      items: [
        {
          stockCode: '1155',
          shortName: 'MAYBANK',
          fullName: 'Malayan Banking Berhad',
          companyName: 'Malayan Banking Berhad',
          board: 'MAIN',
          sectorName: 'Financial Services',
        },
      ],
    },
  ],
  // screener-endpoint.int.spec.ts
  'GET /screener': [
    ScreenerResponse,
    {
      items: [
        {
          stockCode: '0101',
          shortName: 'PROFIT',
          sector: 'Financial Services',
          close: 10.2,
          pctChange: 2,
          marketCap: 10200,
          pe: 8.5,
          dy: 0.04,
          pNta: 1.1,
          roe: 0.12,
          de: 0.5,
          provenance: {
            price: 'synthetic',
            fundamentals: 'synthetic',
            technicals: 'synthetic',
          },
        },
        {
          // One-bar company: null %change, absent technicals (spec: NULLs allowed).
          stockCode: '0202',
          shortName: 'LOSS',
          sector: 'Technology',
          close: 3.1,
          pctChange: null,
          marketCap: null,
          pe: null,
          dy: null,
          pNta: null,
          roe: null,
          de: null,
          provenance: { price: 'synthetic', fundamentals: null, technicals: null },
        },
      ],
      total: 5,
      offset: 1,
      limit: 2,
      sort: 'pe',
      dir: 'asc',
    },
  ],
  // screener-fields.int.spec.ts (SCREENER_FILTER_FIELDS, one of each kind)
  'GET /screener/fields': [
    ScreenerFieldsResponse,
    {
      filters: [
        { name: 'board', kind: 'enum', param: 'board', domain: 'boards' },
        { name: 'sector', kind: 'enum', param: 'sector', domain: 'sectors' },
        { name: 'shariah', kind: 'boolean', param: 'shariah' },
        { name: 'price', kind: 'numericBand', minParam: 'priceMin', maxParam: 'priceMax' },
        { name: 'volume', kind: 'numericBand', minParam: 'volumeMin', maxParam: null },
      ],
      boards: ['MAIN', 'ACE'],
      sectors: [{ id: SECTOR_ID, name: 'Financial Services' }],
    },
  ],
  // disclosures.int.spec.ts
  'GET /announcements': [
    MarketAnnouncementsPage,
    {
      items: [
        {
          provenance: 'aggregator',
          companyCode: '1155',
          companyName: 'Malayan Banking Berhad',
          category: 'SHAREHOLDING_CHANGE',
          title: 'Dealing in listed shares by director',
          filedAt: '2026-10-05T08:00:00.000Z',
          sourceUrl: 'https://example.test/1155/dealing',
          aiSummary: null,
          aiSummaryAsOf: null,
        },
      ],
      total: 5,
      offset: 0,
      limit: 50,
    },
  ],
  'GET /disclosures/dealings': [
    MarketAnnouncementsPage,
    { items: [], total: 0, offset: 0, limit: 50 },
  ],
  'GET /announcements/:id': [
    AnnouncementDetail,
    {
      id: '3f1c5c7e-9a3c-4e2a-b0a4-2b7f1d6e8a90',
      provenance: 'aggregator',
      companyCode: '1155',
      companyName: 'Malayan Banking Berhad',
      category: 'SHAREHOLDING_CHANGE',
      title: 'Dealing in listed shares by director',
      filedAt: '2026-10-05T08:00:00.000Z',
      sourceUrl: 'https://example.test/1155/dealing',
      aiSummary: null,
      aiSummaryAsOf: null,
    },
  ],
  'GET /calendar/corporate-actions': [
    CorporateActionCalendarWindow,
    {
      from: '2026-09-07',
      to: '2026-12-06',
      items: [
        {
          provenance: 'aggregator',
          companyCode: '1155',
          companyName: 'Malayan Banking Berhad',
          type: 'BONUS',
          exDate: '2026-10-04',
          amount: null,
        },
        {
          provenance: 'aggregator',
          companyCode: '1155',
          companyName: 'Malayan Banking Berhad',
          type: 'DIVIDEND',
          exDate: '2026-10-17',
          amount: 0.3,
        },
      ],
    },
  ],
  'GET /calendar/results': [
    ResultsCalendarWindow,
    {
      from: null,
      to: null,
      items: [
        {
          provenance: 'aggregator',
          companyCode: '1155',
          companyName: 'Malayan Banking Berhad',
          fiscalYear: 2026,
          fiscalQuarter: 2,
          periodEnd: '2026-07-24',
          reportedAt: '2026-09-07T00:00:00.000Z',
          announcement: {
            title: 'Quarterly report Q2 FY2026',
            filedAt: '2026-09-07T00:00:00.000Z',
            sourceUrl: null,
          },
        },
      ],
    },
  ],
  'GET /news (company feed, with matchedAlias)': [
    NewsPage,
    {
      items: [
        {
          provenance: 'aggregator',
          headline: 'MBB wins mandate',
          url: 'https://example.test/news/maybank-mandate',
          source: 'Demo Wire',
          publishedAt: '2026-10-07T03:00:00.000Z',
          matchedAlias: 'MBB',
        },
      ],
      total: 3,
      offset: 0,
      limit: 50,
    },
  ],
  'GET /news (market feed, no matchedAlias)': [
    NewsPage,
    {
      items: [
        {
          provenance: 'aggregator',
          headline: 'Bursa Malaysia closes higher',
          url: 'https://example.test/news/bursa-closes',
          source: 'Demo Wire',
          publishedAt: '2026-10-07T04:00:00.000Z',
        },
      ],
      total: 2,
      offset: 0,
      limit: 50,
    },
  ],
  // movers.int.spec.ts (GAMMA seed: close 8.2, prev 8.0, volume 5000)
  'GET /market/movers': [
    MoversResponse,
    {
      type: 'gainers',
      limit: 10,
      rows: [
        {
          provenance: 'synthetic',
          stockCode: 'M003',
          shortName: 'GAMMA',
          price: '8.200000',
          pctChange: 2.5,
          volume: 5000,
        },
      ],
    },
  ],
  // indices.int.spec.ts (licensed-adapter swap: headline + Financial Services)
  'GET /market/indices': [
    IndicesResponse,
    {
      indices: [
        {
          id: INDEX_ID,
          kind: 'headline',
          name: 'FBM KLCI (licensed)',
          sectorName: null,
          level: '1595.100000',
          pctChange: 0.2943,
          provenance: 'real',
        },
        {
          id: SECTOR_ID,
          kind: 'sector',
          name: 'FBM Financial Services Index (licensed)',
          sectorName: 'Financial Services',
          level: '221.500000',
          pctChange: 0.6818,
          provenance: 'real',
        },
      ],
    },
  ],
  'GET /market/indices/:id/series': [
    IndexSeriesResponse,
    {
      id: INDEX_ID,
      name: 'FBM KLCI (licensed)',
      range: '1y',
      points: [
        { levelDate: '2026-01-05', level: '1590.420000' },
        { levelDate: '2026-01-06', level: '1595.100000' },
      ],
      provenance: 'real',
    },
  ],
  'GET /market/sectors': [
    SectorsResponse,
    {
      sectors: [
        {
          indexId: SECTOR_ID,
          sectorName: 'Financial Services',
          level: '221.500000',
          pctChange: 0.6818,
          provenance: 'real',
        },
      ],
    },
  ],
  // market-brief.int.spec.ts
  'GET /market-brief/latest': [
    MarketBriefResponse,
    {
      briefDate: '2026-09-29',
      headline: 'FBM KLCI (demo) closed higher (+1.23%) on illustrative data.',
      asOf: '2026-09-29T20:00:00.000Z',
      artifact: { bucket: 'tuju-artifacts', key: 'analysis/brief/2026-09-29.json' },
    },
  ],
  // prospectus-analysis.int-spec.ts
  'GET /ipo/:prospectusId/at-a-glance': [
    ProspectusAtAGlanceResponse,
    {
      prospectusId: '5d2a7a52-6a1e-4d83-a4f5-0c8a9f2b7e10',
      companyName: 'Insights Analytics Berhad',
      board: 'ACE',
      listingDate: '2025-10-27',
      offerPrice: '0.360000',
      headline: 'Insights Analytics is an ACE Market IPO.',
      asOf: '2026-10-01T02:00:00.000Z',
      source: 'real',
      artifact: { bucket: 'tuju-artifacts', key: 'analysis/prospectus/iab.json' },
      artifactPath: '/ipo/5d2a7a52-6a1e-4d83-a4f5-0c8a9f2b7e10/at-a-glance/artifact',
    },
  ],
  // auth.controller.ts (login / me return the session user)
  'GET /auth/me': [SessionUser, { userId: 'stub-user', tier: 'free' }],
} as const;

describe('HTTP response schemas parse one sample per endpoint (ADR-0014)', () => {
  for (const [endpoint, [schema, sample]] of Object.entries(samples)) {
    it(endpoint, () => {
      expect(() => parseOrThrow(schema, sample, endpoint)).not.toThrow();
    });
  }
});

describe('the HTTP schemas are strict', () => {
  it('rejects an unknown key (a backend field added without a contract change)', () => {
    const [schema, sample] = samples['GET /market-brief/latest'];
    expect(() => parseOrThrow(schema, { ...sample, extra: 1 })).toThrow(ContractParseError);
  });

  it('rejects an out-of-enum value', () => {
    const [schema, sample] = samples['GET /market/movers'];
    expect(() => parseOrThrow(schema, { ...sample, type: 'sideways' })).toThrow();
  });

  it('rejects a numeric string where the wire carries a number', () => {
    const [schema, sample] = samples['GET /stocks/:code'];
    const bad = structuredClone(sample) as { technicals: { rsi14: unknown } };
    bad.technicals.rsi14 = '57.4';
    expect(() => parseOrThrow(schema, bad)).toThrow();
  });
});

describe('parseOrThrow', () => {
  it('returns the parsed value', () => {
    const [schema, sample] = samples['GET /auth/me'];
    expect(parseOrThrow(schema, sample)).toEqual(sample);
  });

  it('throws a ContractParseError naming the label and the failing path', () => {
    const [schema, sample] = samples['GET /auth/me'];
    try {
      parseOrThrow(schema, { ...sample, tier: 'gold' }, 'GET /auth/me');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ContractParseError);
      const e = err as ContractParseError;
      expect(e.message).toContain('GET /auth/me');
      expect(e.message).toContain('tier');
      expect(e.issues.length).toBeGreaterThan(0);
    }
  });
});

describe('HTTP schemas stay out of the Python codegen (ADR-0014 §2)', () => {
  it('registers none of them in the emitted JSON Schema', () => {
    const emitted = JSON.stringify(buildJsonSchema());
    for (const name of [
      'StockCorePayload',
      'StockSeriesResponse',
      'StockTechnicalAnalysisResponse',
      'StockFundamentalAnalysisResponse',
      'ScreenerResponse',
      'MoversResponse',
      'SessionUser',
      'ProspectusAtAGlanceResponse',
    ]) {
      expect(emitted).not.toContain(`"${name}"`);
    }
  });

  it('leaves modelOrder free of HTTP names', () => {
    expect(modelOrder).not.toContain('SessionUser');
    expect(modelOrder).not.toContain('StockCorePayload');
    expect(modelOrder).not.toContain('StockSeriesResponse');
  });
});
