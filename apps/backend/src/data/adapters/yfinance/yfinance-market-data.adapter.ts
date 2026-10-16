import { Logger } from '@nestjs/common';
import { KLCI30_UNIVERSE } from '../../../ingestion/klci30-universe';
import { ProvenanceClass } from '../../entities/enums';
import type { MarketDataAdapter, SourceFetch } from '../adapter.interfaces';
import type { PriceBarDto } from '../dto';
import type { YahooFinanceClient, YahooHistoricalBar } from './yfinance-client';
import { YFinanceThrottle } from './yfinance-throttle';
import {
  YFINANCE_BARS_TTL_SECONDS,
  YFinanceVendorCache,
} from './yfinance-vendor-cache';

interface CachedBar {
  readonly tradeDate: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

function toIsoDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().slice(0, 10);
}

export class YFinanceMarketDataAdapter implements MarketDataAdapter {
  readonly adapterName = 'YFinanceMarketDataAdapter';
  readonly provenanceClass = ProvenanceClass.Real;
  readonly universe = 'klci30';
  private readonly logger = new Logger(YFinanceMarketDataAdapter.name);

  constructor(
    private readonly client: YahooFinanceClient,
    private readonly cache: YFinanceVendorCache,
    private readonly throttle: YFinanceThrottle,
  ) {}

  async fetchDailyBars(): Promise<SourceFetch<PriceBarDto>> {
    const failures: string[] = [];
    const bars: PriceBarDto[] = [];
    // yahoo-finance2 4.0.3 forwards an omitted period2 as undefined to chart
    // validation, rather than applying its documented default of "now".
    const period2 = new Date();
    const period1Date = new Date();
    period1Date.setUTCFullYear(period1Date.getUTCFullYear() - 3);
    const period1 = toIsoDate(period1Date);

    for (const company of KLCI30_UNIVERSE) {
      try {
        const cached = await this.cache.getJson<CachedBar[]>(
          this.cache.barsKey(company.yahooSymbol, period1),
        );
        if (cached) {
          for (const row of cached) {
            bars.push({ stockCode: company.stockCode, ...row });
          }
          continue;
        }

        const history = (await this.throttle.run(() =>
          this.client.historical(company.yahooSymbol, {
            period1,
            period2,
            interval: '1d',
            events: 'history',
          }),
        )) as YahooHistoricalBar[];

        const normalized: CachedBar[] = history
          .filter(
            (row) =>
              Number.isFinite(row.open) &&
              Number.isFinite(row.high) &&
              Number.isFinite(row.low) &&
              Number.isFinite(row.close) &&
              Number.isFinite(row.volume),
          )
          .map((row) => ({
            tradeDate: toIsoDate(row.date),
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            volume: row.volume,
          }));

        await this.cache.setJson(
          this.cache.barsKey(company.yahooSymbol, period1),
          normalized,
          YFINANCE_BARS_TTL_SECONDS,
        );

        for (const row of normalized) {
          bars.push({ stockCode: company.stockCode, ...row });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        failures.push(`${company.stockCode}: ${message}`);
        this.logger.warn(
          `yfinance bars skip ${company.stockCode} (${company.yahooSymbol}): ${message}`,
        );
      }
    }

    if (failures.length > 0) {
      this.logger.warn(
        `yfinance bars failure summary (${failures.length}): ${failures.join('; ')}`,
      );
    }

    return { rows: bars, failures };
  }
}
