import { Test, type TestingModule } from '@nestjs/testing';
import { ProvenanceClass } from '../entities/enums';
import { AdaptersModule } from './adapters.module';
import {
  DISCLOSURE_ADAPTER,
  FUNDAMENTALS_ADAPTER,
  IPO_ADAPTER,
  MARKET_DATA_ADAPTER,
  NEWS_ADAPTER,
  SHARIAH_LIST_ADAPTER,
  type SourceAdapter,
} from './adapter.interfaces';

/**
 * Provenance declaration test (ticket 02 Testing seam).
 *
 * Each demo adapter, resolved from the real {@link AdaptersModule} via its DI token,
 * reports the {@link ProvenanceClass} the worker relies on to open the correct
 * {@link IngestionRun}: synthetic price/fundamentals → `synthetic`; disclosure/news
 * (unlicensed aggregator) → `aggregator`; manual reference (Shariah/IPO) → `real`.
 */
describe('demo adapter provenance declarations', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AdaptersModule],
    }).compile();
  });

  it.each([
    ['MarketDataAdapter', MARKET_DATA_ADAPTER, ProvenanceClass.Synthetic],
    ['FundamentalsAdapter', FUNDAMENTALS_ADAPTER, ProvenanceClass.Synthetic],
    ['DisclosureAdapter', DISCLOSURE_ADAPTER, ProvenanceClass.Aggregator],
    ['NewsAdapter', NEWS_ADAPTER, ProvenanceClass.Aggregator],
    ['ShariahListAdapter', SHARIAH_LIST_ADAPTER, ProvenanceClass.Real],
    ['IpoAdapter', IPO_ADAPTER, ProvenanceClass.Real],
  ])('%s declares provenance %s', (_name, token, expected) => {
    const adapter = moduleRef.get<SourceAdapter>(token);
    expect(adapter.provenanceClass).toBe(expected);
  });
});
