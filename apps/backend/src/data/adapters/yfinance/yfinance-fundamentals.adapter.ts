import { Logger } from '@nestjs/common';
import { KLCI30_UNIVERSE } from '../../../ingestion/klci30-universe';
import { ProvenanceClass } from '../../entities/enums';
import type { FundamentalsAdapter } from '../adapter.interfaces';
import type { FundamentalsDto, QuarterlyFinancialsDto } from '../dto';
import type {
  YahooDividendRow,
  YahooFinanceClient,
  YahooFinancialsRow,
} from './yfinance-client';
import { YFinanceThrottle } from './yfinance-throttle';
import {
  YFINANCE_DIVIDENDS_TTL_SECONDS,
  YFINANCE_FUNDAMENTALS_TTL_SECONDS,
  YFinanceVendorCache,
} from './yfinance-vendor-cache';

interface CachedDividend {
  readonly exDate: string;
  readonly amount: number;
}

interface CachedFundamentals {
  readonly sharesOutstanding: number;
  readonly quarters: readonly Omit<QuarterlyFinancialsDto, 'stockCode'>[];
}

function toIsoDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().slice(0, 10);
}

function fiscalFromPeriodEnd(periodEnd: string): {
  fiscalYear: number;
  fiscalQuarter: number;
} {
  const d = new Date(`${periodEnd}T00:00:00.000Z`);
  const month = d.getUTCMonth();
  return {
    fiscalYear: d.getUTCFullYear(),
    fiscalQuarter: Math.floor(month / 3) + 1,
  };
}

function num(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function mergeQuarterRows(
  financials: YahooFinancialsRow[],
  balances: YahooFinancialsRow[],
): Omit<QuarterlyFinancialsDto, 'stockCode'>[] {
  const byDate = new Map<string, Omit<QuarterlyFinancialsDto, 'stockCode'>>();

  for (const row of financials) {
    const periodEnd = toIsoDate(row.date);
    const { fiscalYear, fiscalQuarter } = fiscalFromPeriodEnd(periodEnd);
    byDate.set(periodEnd, {
      fiscalYear,
      fiscalQuarter,
      periodEnd,
      revenue: num(row.totalRevenue),
      netProfit: num(row.netIncome),
      eps: num(row.dilutedEPS ?? row.basicEPS),
      equity: 0,
      nta: 0,
      intangibles: 0,
      totalBorrowings: 0,
    });
  }

  for (const row of balances) {
    const periodEnd = toIsoDate(row.date);
    const existing = byDate.get(periodEnd);
    const { fiscalYear, fiscalQuarter } = fiscalFromPeriodEnd(periodEnd);
    const intangibles =
      num(row.goodwillAndOtherIntangibleAssets) ||
      num(row.otherIntangibleAssets) + num(row.goodwill);
    const patch = {
      equity: num(row.stockholdersEquity ?? row.commonStockEquity),
      nta: num(row.tangibleBookValue ?? row.netTangibleAssets),
      intangibles,
      totalBorrowings: num(row.totalDebt),
    };
    if (existing) {
      byDate.set(periodEnd, { ...existing, ...patch });
    } else {
      byDate.set(periodEnd, {
        fiscalYear,
        fiscalQuarter,
        periodEnd,
        revenue: 0,
        netProfit: 0,
        eps: 0,
        ...patch,
      });
    }
  }

  return [...byDate.values()].sort((a, b) =>
    a.periodEnd.localeCompare(b.periodEnd),
  );
}

export class YFinanceFundamentalsAdapter implements FundamentalsAdapter {
  readonly provenanceClass = ProvenanceClass.Real;
  private readonly logger = new Logger(YFinanceFundamentalsAdapter.name);
  private failures: string[] = [];
  private dividendsByStockCode = new Map<
    string,
    readonly { readonly exDate: string; readonly amount: number }[]
  >();

  constructor(
    private readonly client: YahooFinanceClient,
    private readonly cache: YFinanceVendorCache,
    private readonly throttle: YFinanceThrottle,
  ) {}

  getFailureSummary(): readonly string[] {
    return this.failures;
  }

  getDividendsByStockCode(): ReadonlyMap<
    string,
    readonly { readonly exDate: string; readonly amount: number }[]
  > {
    return this.dividendsByStockCode;
  }

  async fetchFundamentals(): Promise<FundamentalsDto[]> {
    this.failures = [];
    this.dividendsByStockCode = new Map();
    const out: FundamentalsDto[] = [];
    const period1Date = new Date();
    period1Date.setUTCFullYear(period1Date.getUTCFullYear() - 3);
    const period1 = toIsoDate(period1Date);

    for (const company of KLCI30_UNIVERSE) {
      try {
        const cached = await this.cache.getJson<CachedFundamentals>(
          this.cache.fundamentalsKey(company.yahooSymbol),
        );
        if (cached) {
          const cachedDivs =
            (await this.cache.getJson<CachedDividend[]>(
              this.cache.dividendsKey(company.yahooSymbol),
            )) ?? [];
          this.dividendsByStockCode.set(company.stockCode, cachedDivs);
          out.push({
            stockCode: company.stockCode,
            sharesOutstanding: cached.sharesOutstanding,
            quarters: cached.quarters.map((q) => ({
              stockCode: company.stockCode,
              ...q,
            })),
          });
          continue;
        }

        const [summary, financials, balances, dividends] = await Promise.all([
          this.throttle.run(() =>
            this.client.quoteSummary(company.yahooSymbol, {
              modules: ['defaultKeyStatistics'],
            }),
          ),
          this.throttle.run(() =>
            this.client.fundamentalsTimeSeries(company.yahooSymbol, {
              period1,
              type: 'quarterly',
              module: 'financials',
            }),
          ),
          this.throttle.run(() =>
            this.client.fundamentalsTimeSeries(company.yahooSymbol, {
              period1,
              type: 'quarterly',
              module: 'balance-sheet',
            }),
          ),
          this.throttle.run(() =>
            this.client.historical(company.yahooSymbol, {
              period1,
              events: 'dividends',
            }),
          ) as Promise<YahooDividendRow[]>,
        ]);

        const quarters = mergeQuarterRows(
          financials as YahooFinancialsRow[],
          balances as YahooFinancialsRow[],
        );
        const sharesOutstanding =
          num(summary.defaultKeyStatistics?.sharesOutstanding) ||
          num(
            [...balances]
              .reverse()
              .find((row) => num(row.ordinarySharesNumber) > 0)
              ?.ordinarySharesNumber,
          );

        const payload: CachedFundamentals = {
          sharesOutstanding,
          quarters,
        };
        await this.cache.setJson(
          this.cache.fundamentalsKey(company.yahooSymbol),
          payload,
          YFINANCE_FUNDAMENTALS_TTL_SECONDS,
        );

        const dividendRows: CachedDividend[] = (dividends as YahooDividendRow[])
          .filter((row) => Number.isFinite(row.dividends))
          .map((row) => ({
            exDate: toIsoDate(row.date),
            amount: row.dividends,
          }));
        await this.cache.setJson(
          this.cache.dividendsKey(company.yahooSymbol),
          dividendRows,
          YFINANCE_DIVIDENDS_TTL_SECONDS,
        );
        this.dividendsByStockCode.set(company.stockCode, dividendRows);

        out.push({
          stockCode: company.stockCode,
          sharesOutstanding,
          quarters: quarters.map((q) => ({
            stockCode: company.stockCode,
            ...q,
          })),
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        this.failures.push(`${company.stockCode}: ${message}`);
        this.logger.warn(
          `yfinance fundamentals skip ${company.stockCode} (${company.yahooSymbol}): ${message}`,
        );
      }
    }

    if (this.failures.length > 0) {
      this.logger.warn(
        `yfinance fundamentals failure summary (${this.failures.length}): ${this.failures.join('; ')}`,
      );
    }

    return out;
  }
}
