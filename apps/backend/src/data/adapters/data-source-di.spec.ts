import { Test } from '@nestjs/testing';
import { ProvenanceClass } from '../entities/enums';
import { AdaptersModule } from './adapters.module';
import {
  FUNDAMENTALS_ADAPTER,
  MARKET_DATA_ADAPTER,
  NEWS_ADAPTER,
  type FundamentalsAdapter,
  type MarketDataAdapter,
  type NewsAdapter,
  type SourceAdapter,
} from './adapter.interfaces';
import { YFinanceFundamentalsAdapter } from './yfinance/yfinance-fundamentals.adapter';
import { YFinanceMarketDataAdapter } from './yfinance/yfinance-market-data.adapter';

describe('AdaptersModule DATA_SOURCE DI', () => {
  const previous = process.env.DATA_SOURCE;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.DATA_SOURCE;
    } else {
      process.env.DATA_SOURCE = previous;
    }
  });

  it('defaults to synthetic market + fundamentals adapters', async () => {
    delete process.env.DATA_SOURCE;
    const moduleRef = await Test.createTestingModule({
      imports: [AdaptersModule],
    }).compile();

    const market = moduleRef.get<MarketDataAdapter>(MARKET_DATA_ADAPTER);
    const fundamentals =
      moduleRef.get<FundamentalsAdapter>(FUNDAMENTALS_ADAPTER);
    const news = moduleRef.get<NewsAdapter>(NEWS_ADAPTER);

    expect(market.provenanceClass).toBe(ProvenanceClass.Synthetic);
    expect(fundamentals.provenanceClass).toBe(ProvenanceClass.Synthetic);
    expect(news.provenanceClass).toBe(ProvenanceClass.Aggregator);
    expect(market).not.toBeInstanceOf(YFinanceMarketDataAdapter);
    expect(fundamentals).not.toBeInstanceOf(YFinanceFundamentalsAdapter);
  });

  it('binds yfinance adapters when DATA_SOURCE=yfinance', async () => {
    process.env.DATA_SOURCE = 'yfinance';
    const moduleRef = await Test.createTestingModule({
      imports: [AdaptersModule],
    }).compile();

    const market = moduleRef.get<SourceAdapter>(MARKET_DATA_ADAPTER);
    const fundamentals = moduleRef.get<SourceAdapter>(FUNDAMENTALS_ADAPTER);
    const news = moduleRef.get<SourceAdapter>(NEWS_ADAPTER);

    expect(market).toBeInstanceOf(YFinanceMarketDataAdapter);
    expect(fundamentals).toBeInstanceOf(YFinanceFundamentalsAdapter);
    expect(market.provenanceClass).toBe(ProvenanceClass.Real);
    expect(fundamentals.provenanceClass).toBe(ProvenanceClass.Real);
    expect(news.provenanceClass).toBe(ProvenanceClass.Aggregator);
  });
});
