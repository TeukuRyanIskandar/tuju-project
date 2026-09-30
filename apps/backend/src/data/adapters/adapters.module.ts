import { Module } from '@nestjs/common';
import {
  DISCLOSURE_ADAPTER,
  FUNDAMENTALS_ADAPTER,
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
  SyntheticMarketDataAdapter,
} from './demo-adapters';

/**
 * Source-adapter seam DI wiring (spec 01; ticket 02).
 *
 * Binds each demo implementation behind its interface's injection token. This is
 * the single place a production adapter swaps in: rebind one `provide` entry
 * (e.g. `useClass: EodhdMarketDataAdapter`) and every consumer injecting the token
 * is unchanged. Tokens (not classes) are exported so consumers depend on the seam,
 * never on a concrete adapter.
 */
@Module({
  providers: [
    { provide: MARKET_DATA_ADAPTER, useClass: SyntheticMarketDataAdapter },
    { provide: FUNDAMENTALS_ADAPTER, useClass: SyntheticFundamentalsAdapter },
    { provide: DISCLOSURE_ADAPTER, useClass: AggregatorDisclosureAdapter },
    { provide: NEWS_ADAPTER, useClass: RssNewsAdapter },
    { provide: SHARIAH_LIST_ADAPTER, useClass: ManualShariahListAdapter },
    { provide: IPO_ADAPTER, useClass: ManualIpoAdapter },
  ],
  exports: [
    MARKET_DATA_ADAPTER,
    FUNDAMENTALS_ADAPTER,
    DISCLOSURE_ADAPTER,
    NEWS_ADAPTER,
    SHARIAH_LIST_ADAPTER,
    IPO_ADAPTER,
  ],
})
export class AdaptersModule {}
