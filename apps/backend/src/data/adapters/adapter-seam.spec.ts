import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MarketIndexKind, ProvenanceClass } from '../entities/enums';
import {
  fetched,
  INDEX_ADAPTER,
  MARKET_DATA_ADAPTER,
  type IndexAdapter,
  type MarketDataAdapter,
  type SourceFetch,
} from './adapter.interfaces';
import type { IndexLevelsDto, PriceBarDto } from './dto';

/**
 * Seam contract test (ticket 02 Testing seam).
 *
 * A consumer coded against the {@link MarketDataAdapter} interface (injecting the
 * {@link MARKET_DATA_ADAPTER} token) gets the expected read model from a fake
 * adapter. Swapping the fake for a *second* fake changes only the data the
 * consumer sees — never the consumer's code — which proves a licensed production
 * adapter swaps in behind the token transparently.
 *
 * The second describe block (spec 05, ticket 02) pins the same contract for the
 * {@link IndexAdapter}: a fake `LicensedIndexAdapter` producing `real` levels
 * feeds the exact same consumer as the synthetic one — the demo/production
 * boundary the market-overview machinery rides on.
 */

/** A minimal consumer of the seam — the shape the ingestion worker (ticket 04) takes. */
@Injectable()
class BarCountingConsumer {
  constructor(private readonly market: MarketDataAdapter) {}

  async closesForDate(): Promise<number[]> {
    const bars = await this.market.fetchDailyBars();
    return bars.rows.map((b) => b.close);
  }
}

const CONSUMER = Symbol('BarCountingConsumer');

/** First fake: two bars. */
class FakeMarketDataAdapterA implements MarketDataAdapter {
  readonly adapterName = 'FakeMarketDataAdapterA';
  readonly provenanceClass = ProvenanceClass.Synthetic;
  readonly universe = 'reference';
  fetchDailyBars(): Promise<SourceFetch<PriceBarDto>> {
    return Promise.resolve(fetched([
      { stockCode: '1155', tradeDate: '2024-01-02', open: 1, high: 2, low: 1, close: 1.5, volume: 100 },
      { stockCode: '1155', tradeDate: '2024-01-03', open: 1.5, high: 2.5, low: 1.4, close: 2, volume: 200 },
    ]));
  }
}

/** Second fake: different data, same interface — stands in for the licensed swap. */
class FakeMarketDataAdapterB implements MarketDataAdapter {
  readonly adapterName = 'FakeMarketDataAdapterB';
  readonly provenanceClass = ProvenanceClass.Real;
  readonly universe = 'klci30';
  fetchDailyBars(): Promise<SourceFetch<PriceBarDto>> {
    return Promise.resolve(fetched([
      { stockCode: '5347', tradeDate: '2024-02-01', open: 8, high: 9, low: 7.9, close: 8.8, volume: 5000 },
    ]));
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

/** A minimal consumer of the index seam — the shape the ingestion worker takes. */
@Injectable()
class LevelReadingConsumer {
  constructor(private readonly index: IndexAdapter) {}

  async headlineSeriesLevels(): Promise<number[]> {
    const series = await this.index.fetchIndexLevels();
    const headline = series.rows.find((s) => s.kind === MarketIndexKind.Headline);
    return (headline?.levels ?? []).map((l) => l.level);
  }
}

const INDEX_CONSUMER = Symbol('LevelReadingConsumer');

/** First fake: the demo synthetic adapter — computed cap-weighted levels. */
class FakeSyntheticIndexAdapter implements IndexAdapter {
  readonly adapterName = 'FakeSyntheticIndexAdapter';
  readonly provenanceClass = ProvenanceClass.Synthetic;
  fetchIndexLevels(): Promise<SourceFetch<IndexLevelsDto>> {
    return Promise.resolve(fetched([
      {
        kind: MarketIndexKind.Headline,
        sectorName: null,
        name: 'Tuju Composite Index',
        levels: [
          { levelDate: '2026-01-05', level: 100 },
          { levelDate: '2026-01-06', level: 101.5 },
        ],
      },
    ]));
  }
}

/**
 * Second fake: the licensed-feed production adapter — a published `real`
 * level series. Stands in for the licensed swap: different provenance, different
 * numbers, IDENTICAL interface and consumers.
 */
class FakeLicensedIndexAdapter implements IndexAdapter {
  readonly adapterName = 'FakeLicensedIndexAdapter';
  readonly provenanceClass = ProvenanceClass.Real;
  fetchIndexLevels(): Promise<SourceFetch<IndexLevelsDto>> {
    return Promise.resolve(fetched([
      {
        kind: MarketIndexKind.Headline,
        sectorName: null,
        name: 'FBM KLCI (licensed)',
        levels: [
          { levelDate: '2026-01-05', level: 1590.42 },
          { levelDate: '2026-01-06', level: 1595.1 },
        ],
      },
    ]));
  }
}

async function buildIndexConsumer(
  adapter: IndexAdapter,
): Promise<LevelReadingConsumer> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      { provide: INDEX_ADAPTER, useValue: adapter },
      {
        provide: INDEX_CONSUMER,
        useFactory: (i: IndexAdapter) => new LevelReadingConsumer(i),
        inject: [INDEX_ADAPTER],
      },
    ],
  }).compile();
  return moduleRef.get<LevelReadingConsumer>(INDEX_CONSUMER);
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

describe('index-adapter seam contract (spec 05, ticket 02)', () => {
  it('a consumer given the fake synthetic adapter gets the expected levels', async () => {
    const consumer = await buildIndexConsumer(new FakeSyntheticIndexAdapter());
    await expect(consumer.headlineSeriesLevels()).resolves.toEqual([100, 101.5]);
  });

  it('a fake LicensedIndexAdapter producing real levels feeds the identical consumer', async () => {
    // Exact same consumer class, exact same injection — only the bound provider
    // differs: the demo/production swap the market-overview machinery rides on.
    const syntheticConsumer = await buildIndexConsumer(
      new FakeSyntheticIndexAdapter(),
    );
    const licensedConsumer = await buildIndexConsumer(
      new FakeLicensedIndexAdapter(),
    );

    await expect(syntheticConsumer.headlineSeriesLevels()).resolves.toEqual([
      100, 101.5,
    ]);
    await expect(licensedConsumer.headlineSeriesLevels()).resolves.toEqual([
      1590.42, 1595.1,
    ]);
    expect(syntheticConsumer).toBeInstanceOf(LevelReadingConsumer);
    expect(licensedConsumer).toBeInstanceOf(LevelReadingConsumer);
  });
});
