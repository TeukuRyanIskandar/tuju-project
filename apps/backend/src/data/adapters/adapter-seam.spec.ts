import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ProvenanceClass } from '../entities/enums';
import {
  MARKET_DATA_ADAPTER,
  type MarketDataAdapter,
} from './adapter.interfaces';
import type { PriceBarDto } from './dto';

/**
 * Seam contract test (ticket 02 Testing seam).
 *
 * A consumer coded against the {@link MarketDataAdapter} interface (injecting the
 * {@link MARKET_DATA_ADAPTER} token) gets the expected read model from a fake
 * adapter. Swapping the fake for a *second* fake changes only the data the
 * consumer sees — never the consumer's code — which proves a licensed production
 * adapter swaps in behind the token transparently.
 */

/** A minimal consumer of the seam — the shape the ingestion worker (ticket 04) takes. */
@Injectable()
class BarCountingConsumer {
  constructor(private readonly market: MarketDataAdapter) {}

  async closesForDate(): Promise<number[]> {
    const bars = await this.market.fetchDailyBars();
    return bars.map((b) => b.close);
  }
}

const CONSUMER = Symbol('BarCountingConsumer');

/** First fake: two bars. */
class FakeMarketDataAdapterA implements MarketDataAdapter {
  readonly provenanceClass = ProvenanceClass.Synthetic;
  fetchDailyBars(): Promise<PriceBarDto[]> {
    return Promise.resolve([
      { stockCode: '1155', tradeDate: '2024-01-02', open: 1, high: 2, low: 1, close: 1.5, volume: 100 },
      { stockCode: '1155', tradeDate: '2024-01-03', open: 1.5, high: 2.5, low: 1.4, close: 2, volume: 200 },
    ]);
  }
}

/** Second fake: different data, same interface — stands in for the licensed swap. */
class FakeMarketDataAdapterB implements MarketDataAdapter {
  readonly provenanceClass = ProvenanceClass.Real;
  fetchDailyBars(): Promise<PriceBarDto[]> {
    return Promise.resolve([
      { stockCode: '5347', tradeDate: '2024-02-01', open: 8, high: 9, low: 7.9, close: 8.8, volume: 5000 },
    ]);
  }
}

async function buildConsumer(
  adapter: MarketDataAdapter,
): Promise<BarCountingConsumer> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      { provide: MARKET_DATA_ADAPTER, useValue: adapter },
      {
        provide: CONSUMER,
        useFactory: (m: MarketDataAdapter) => new BarCountingConsumer(m),
        inject: [MARKET_DATA_ADAPTER],
      },
    ],
  }).compile();
  return moduleRef.get<BarCountingConsumer>(CONSUMER);
}

describe('source-adapter seam contract', () => {
  it('a consumer given a fake adapter gets the expected read model', async () => {
    const consumer = await buildConsumer(new FakeMarketDataAdapterA());
    await expect(consumer.closesForDate()).resolves.toEqual([1.5, 2]);
  });

  it('swapping the fake for a second fake changes only the data, not the consumer', async () => {
    // Exact same consumer class, exact same injection — only the bound provider differs.
    const consumerA = await buildConsumer(new FakeMarketDataAdapterA());
    const consumerB = await buildConsumer(new FakeMarketDataAdapterB());

    const [closesA, closesB] = await Promise.all([
      consumerA.closesForDate(),
      consumerB.closesForDate(),
    ]);

    expect(closesA).toEqual([1.5, 2]);
    expect(closesB).toEqual([8.8]);
    // Same consumer implementation produced both — the swap is transparent.
    expect(consumerA).toBeInstanceOf(BarCountingConsumer);
    expect(consumerB).toBeInstanceOf(BarCountingConsumer);
  });
});
