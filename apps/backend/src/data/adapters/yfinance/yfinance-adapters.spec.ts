import { ProvenanceClass } from '../../entities/enums';
import type {
  YahooDividendRow,
  YahooFinanceClient,
  YahooFinancialsRow,
  YahooHistoricalBar,
  YahooQuoteSummary,
} from './yfinance-client';
import { YFinanceFundamentalsAdapter } from './yfinance-fundamentals.adapter';
import { YFinanceMarketDataAdapter } from './yfinance-market-data.adapter';
import { YFinanceThrottle } from './yfinance-throttle';
import { YFinanceVendorCache } from './yfinance-vendor-cache';

function makeClient(overrides: Partial<YahooFinanceClient> = {}): YahooFinanceClient {
  return {
    historical: jest.fn(),
    quoteSummary: jest.fn(),
    fundamentalsTimeSeries: jest.fn(),
    ...overrides,
  };
}

describe('YFinanceMarketDataAdapter', () => {
  it('maps daily bars to PriceBarDto with Bursa stockCode', async () => {
    const bars: YahooHistoricalBar[] = [
      {
        date: new Date('2024-01-02T00:00:00.000Z'),
        open: 9.1,
        high: 9.3,
        low: 9.0,
        close: 9.2,
        volume: 1000,
      },
    ];
    const historical = jest.fn(async (symbol: string) => {
      if (symbol === '1155.KL') {
        return bars;
      }
      throw new Error(`unexpected ${symbol}`);
    });
    const client = makeClient({ historical });
    const cache = new YFinanceVendorCache(null);
    const adapter = new YFinanceMarketDataAdapter(
      client,
      cache,
      new YFinanceThrottle(0, 0, 0),
    );

    const universeSize = 30;
    historical.mockImplementation(async (symbol: string) => {
      if (symbol === '1155.KL') {
        return bars;
      }
      return [] as YahooHistoricalBar[];
    });

    const result = await adapter.fetchDailyBars();
    const maybank = result.filter((b) => b.stockCode === '1155');
    expect(maybank).toEqual([
      {
        stockCode: '1155',
        tradeDate: '2024-01-02',
        open: 9.1,
        high: 9.3,
        low: 9.0,
        close: 9.2,
        volume: 1000,
      },
    ]);
    expect(historical).toHaveBeenCalledTimes(universeSize);
    expect(adapter.provenanceClass).toBe(ProvenanceClass.Real);
  });

  it('skips a failing symbol and continues the batch', async () => {
    const historical = jest.fn(async (symbol: string) => {
      if (symbol === '1155.KL') {
        throw new Error('boom');
      }
      return [] as YahooHistoricalBar[];
    });
    const adapter = new YFinanceMarketDataAdapter(
      makeClient({ historical }),
      new YFinanceVendorCache(null),
      new YFinanceThrottle(0, 0, 0),
    );

    const result = await adapter.fetchDailyBars();
    expect(result.every((b) => b.stockCode !== '1155')).toBe(true);
    expect(adapter.getFailureSummary().some((s) => s.startsWith('1155:'))).toBe(
      true,
    );
  });

  it('serves a cache hit without a second Yahoo fetch', async () => {
    const historical = jest.fn(async () => [
      {
        date: new Date('2024-01-02T00:00:00.000Z'),
        open: 1,
        high: 2,
        low: 1,
        close: 1.5,
        volume: 10,
      },
    ] satisfies YahooHistoricalBar[]);
    const cache = new YFinanceVendorCache(null);
    const throttle = new YFinanceThrottle(0, 0, 0);
    const adapter = new YFinanceMarketDataAdapter(
      makeClient({ historical }),
      cache,
      throttle,
    );

    await adapter.fetchDailyBars();
    const firstCalls = historical.mock.calls.length;
    await adapter.fetchDailyBars();
    expect(historical.mock.calls.length).toBe(firstCalls);
  });
});

describe('YFinanceFundamentalsAdapter', () => {
  it('maps quoteSummary + quarterly series to FundamentalsDto', async () => {
    const quoteSummary = jest.fn(
      async (): Promise<YahooQuoteSummary> => ({
        defaultKeyStatistics: { sharesOutstanding: 12_000_000_000 },
      }),
    );
    const fundamentalsTimeSeries = jest.fn(
      async (
        _symbol: string,
        options: { module: string },
      ): Promise<YahooFinancialsRow[]> => {
        if (options.module === 'financials') {
          return [
            {
              date: new Date('2024-03-31T00:00:00.000Z'),
              TYPE: 'FINANCIALS',
              totalRevenue: 100,
              netIncome: 20,
              dilutedEPS: 0.5,
            },
          ];
        }
        return [
          {
            date: new Date('2024-03-31T00:00:00.000Z'),
            TYPE: 'BALANCE_SHEET',
            stockholdersEquity: 200,
            tangibleBookValue: 180,
            goodwill: 5,
            otherIntangibleAssets: 5,
            totalDebt: 40,
          },
        ];
      },
    );
    const historical = jest.fn(
      async (): Promise<YahooDividendRow[]> => [
        { date: new Date('2024-02-15T00:00:00.000Z'), dividends: 0.12 },
      ],
    );

    const adapter = new YFinanceFundamentalsAdapter(
      makeClient({ quoteSummary, fundamentalsTimeSeries, historical }),
      new YFinanceVendorCache(null),
      new YFinanceThrottle(0, 0, 0),
    );

    const result = await adapter.fetchFundamentals();
    const maybank = result.find((r) => r.stockCode === '1155');
    expect(maybank).toEqual({
      stockCode: '1155',
      sharesOutstanding: 12_000_000_000,
      quarters: [
        {
          stockCode: '1155',
          fiscalYear: 2024,
          fiscalQuarter: 1,
          periodEnd: '2024-03-31',
          revenue: 100,
          netProfit: 20,
          eps: 0.5,
          equity: 200,
          nta: 180,
          intangibles: 10,
          totalBorrowings: 40,
        },
      ],
    });
    expect(adapter.provenanceClass).toBe(ProvenanceClass.Real);
  });

  it('skips a failing symbol and continues', async () => {
    const quoteSummary = jest.fn(async (symbol: string) => {
      if (symbol === '1155.KL') {
        throw new Error('quota');
      }
      return { defaultKeyStatistics: { sharesOutstanding: 1 } };
    });
    const fundamentalsTimeSeries = jest.fn(async () => [] as YahooFinancialsRow[]);
    const historical = jest.fn(async () => [] as YahooDividendRow[]);

    const adapter = new YFinanceFundamentalsAdapter(
      makeClient({ quoteSummary, fundamentalsTimeSeries, historical }),
      new YFinanceVendorCache(null),
      new YFinanceThrottle(0, 0, 0),
    );

    const result = await adapter.fetchFundamentals();
    expect(result.every((r) => r.stockCode !== '1155')).toBe(true);
    expect(adapter.getFailureSummary().some((s) => s.startsWith('1155:'))).toBe(
      true,
    );
  });
});
