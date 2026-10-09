import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import {
  APP_CONFIG,
  parseDataSource,
  type AppConfig,
  type DataSourceMode,
} from '../../config/config';
import { REDIS_CLIENT } from '../../redis/redis.module';
import {
  DISCLOSURE_ADAPTER,
  FUNDAMENTALS_ADAPTER,
  INDEX_ADAPTER,
  IPO_ADAPTER,
  MARKET_DATA_ADAPTER,
  NEWS_ADAPTER,
  SHARIAH_LIST_ADAPTER,
} from './adapter.interfaces';
import {
  AggregatorDisclosureAdapter,
  ManualIpoAdapter,
  ManualShariahListAdapter,
  RssNewsAdapter,
  SyntheticFundamentalsAdapter,
  SyntheticIndexAdapter,
  SyntheticMarketDataAdapter,
} from './demo-adapters';
import {
  createYahooFinanceClient,
  YFinanceFundamentalsAdapter,
  YFinanceMarketDataAdapter,
  YFinanceThrottle,
  YFinanceVendorCache,
} from './yfinance';

function resolveDataSource(config?: AppConfig): DataSourceMode {
  return config?.dataSource ?? parseDataSource(process.env.DATA_SOURCE);
}

function buildYFinanceDeps(redis?: Redis) {
  const client = createYahooFinanceClient();
  const cache = new YFinanceVendorCache(redis ?? null);
  const throttle = new YFinanceThrottle();
  return { client, cache, throttle };
}

@Module({
  providers: [
    {
      provide: MARKET_DATA_ADAPTER,
      inject: [
        { token: APP_CONFIG, optional: true },
        { token: REDIS_CLIENT, optional: true },
      ],
      useFactory: (config?: AppConfig, redis?: Redis) => {
        if (resolveDataSource(config) === 'yfinance') {
          const deps = buildYFinanceDeps(redis);
          return new YFinanceMarketDataAdapter(
            deps.client,
            deps.cache,
            deps.throttle,
          );
        }
        return new SyntheticMarketDataAdapter();
      },
    },
    {
      provide: FUNDAMENTALS_ADAPTER,
      inject: [
        { token: APP_CONFIG, optional: true },
        { token: REDIS_CLIENT, optional: true },
      ],
      useFactory: (config?: AppConfig, redis?: Redis) => {
        if (resolveDataSource(config) === 'yfinance') {
          const deps = buildYFinanceDeps(redis);
          return new YFinanceFundamentalsAdapter(
            deps.client,
            deps.cache,
            deps.throttle,
          );
        }
        return new SyntheticFundamentalsAdapter();
      },
    },
    { provide: DISCLOSURE_ADAPTER, useClass: AggregatorDisclosureAdapter },
    { provide: NEWS_ADAPTER, useClass: RssNewsAdapter },
    { provide: SHARIAH_LIST_ADAPTER, useClass: ManualShariahListAdapter },
    { provide: IPO_ADAPTER, useClass: ManualIpoAdapter },
    { provide: INDEX_ADAPTER, useClass: SyntheticIndexAdapter },
  ],
  exports: [
    MARKET_DATA_ADAPTER,
    FUNDAMENTALS_ADAPTER,
    DISCLOSURE_ADAPTER,
    NEWS_ADAPTER,
    SHARIAH_LIST_ADAPTER,
    IPO_ADAPTER,
    INDEX_ADAPTER,
  ],
})
export class AdaptersModule {}
