/**
 * Demo implementations of the source-adapter seam (spec 01; ticket 02).
 *
 * These are the swappable-behind fakes: they satisfy the interfaces in
 * `adapter.interfaces.ts` and are wired for DI in `adapters.module.ts`, so a
 * consumer coded against the interface swaps a demo impl for a licensed production
 * adapter by rebinding one provider — with no consumer change (proved by the seam
 * contract test).
 *
 * Scope (ticket 02): the SEAM is what is under test. The synthetic price /
 * fundamentals *generation logic* is ticket 03 — {@link SyntheticMarketDataAdapter}
 * and {@link SyntheticFundamentalsAdapter} are thin placeholders here that will
 * later delegate to that generator. The aggregator / manual demo adapters return a
 * small static snapshot sufficient to exercise the seam. Every adapter declares the
 * {@link ProvenanceClass} it produces.
 */
import { Injectable } from '@nestjs/common';
import {
  AnnouncementCategory,
  CorporateActionType,
  ListingBoard,
  ProvenanceClass,
  ShariahComplianceStatus,
} from '../entities/enums';
import { generate } from '../synthetic';
import {
  REFERENCE_UNIVERSE,
  SYNTHETIC_BASE_SEED,
  instrumentSeed,
} from '../../ingestion/reference-universe';
import type {
  DisclosureAdapter,
  FundamentalsAdapter,
  IpoAdapter,
  MarketDataAdapter,
  NewsAdapter,
  ShariahListAdapter,
} from './adapter.interfaces';
import type {
  AnnouncementDto,
  CorporateActionDto,
  FundamentalsDto,
  IpoListingDto,
  NewsArticleDto,
  PriceBarDto,
  QuarterlyFinancialsDto,
  ShariahStatusDto,
} from './dto';

/**
 * Demo market-data adapter (ticket 04 wires ticket 03's generator behind it).
 *
 * Declares `synthetic` provenance. For every company in the curated reference
 * universe it runs the pure seeded generator (deterministic per `stockCode`) and
 * maps the emitted price-bar DTO strings onto the seam's plain `number` DTOs. The
 * seam is unchanged: a licensed `EodhdMarketDataAdapter` swaps in by rebinding the
 * DI token.
 */
@Injectable()
export class SyntheticMarketDataAdapter implements MarketDataAdapter {
  readonly provenanceClass = ProvenanceClass.Synthetic;

  fetchDailyBars(): Promise<PriceBarDto[]> {
    const bars: PriceBarDto[] = [];
    for (const company of REFERENCE_UNIVERSE) {
      const seed = instrumentSeed(SYNTHETIC_BASE_SEED, company.stockCode);
      const dataset = generate(seed);
      for (const bar of dataset.priceBars) {
        bars.push({
          stockCode: company.stockCode,
          tradeDate: bar.tradeDate,
          open: Number(bar.open),
          high: Number(bar.high),
          low: Number(bar.low),
          close: Number(bar.close),
          volume: Number(bar.volume),
        });
      }
    }
    return Promise.resolve(bars);
  }
}

/**
 * Demo fundamentals adapter (ticket 04 wires ticket 03's generator behind it).
 *
 * Declares `synthetic` provenance, co-generated with prices from the SAME
 * per-instrument seed (A1) so every derived ratio reconciles. Maps the emitted
 * quarterly DTO strings onto the seam's plain `number` DTOs, one batch per company.
 */
@Injectable()
export class SyntheticFundamentalsAdapter implements FundamentalsAdapter {
  readonly provenanceClass = ProvenanceClass.Synthetic;

  fetchFundamentals(): Promise<FundamentalsDto[]> {
    const out: FundamentalsDto[] = [];
    for (const company of REFERENCE_UNIVERSE) {
      const seed = instrumentSeed(SYNTHETIC_BASE_SEED, company.stockCode);
      const dataset = generate(seed);
      const quarters: QuarterlyFinancialsDto[] = dataset.quarterlyFinancials.map(
        (q) => ({
          stockCode: company.stockCode,
          fiscalYear: q.fiscalYear,
          fiscalQuarter: q.fiscalQuarter,
          periodEnd: q.periodEnd,
          revenue: Number(q.revenue),
          netProfit: Number(q.netProfit),
          eps: Number(q.eps),
          equity: Number(q.equity),
          nta: Number(q.nta),
          intangibles: Number(q.intangibles),
          totalBorrowings: Number(q.totalBorrowings),
        }),
      );
      out.push({
        stockCode: company.stockCode,
        sharesOutstanding: Number(dataset.snapshot.sharesOutstanding),
        quarters,
      });
    }
    return Promise.resolve(out);
  }
}

/**
 * Demo disclosure adapter — a static aggregator snapshot (no live re-scrape).
 * Declares `aggregator` provenance (purged at the licence boundary). Maps its own
 * labels onto the stable {@link AnnouncementCategory}/{@link CorporateActionType} enums.
 */
@Injectable()
export class AggregatorDisclosureAdapter implements DisclosureAdapter {
  readonly provenanceClass = ProvenanceClass.Aggregator;

  fetchAnnouncements(): Promise<AnnouncementDto[]> {
    // One results announcement per reference company (static snapshot).
    const out: AnnouncementDto[] = REFERENCE_UNIVERSE.map((c) => ({
      stockCode: c.stockCode,
      category: AnnouncementCategory.FinancialResults,
      title: `${c.shortName}: Quarterly Report`,
      filedAt: new Date('2025-11-28T09:00:00.000Z'),
      sourceUrl: null,
    }));
    return Promise.resolve(out);
  }

  fetchCorporateActions(): Promise<CorporateActionDto[]> {
    // A single dividend action per reference company (feeds DY / the calendar).
    const out: CorporateActionDto[] = REFERENCE_UNIVERSE.map((c) => ({
      stockCode: c.stockCode,
      type: CorporateActionType.Dividend,
      exDate: '2025-09-15',
      amount: 0.05,
    }));
    return Promise.resolve(out);
  }
}

/**
 * Demo news adapter — RSS headlines + links (no bodies). Declares `aggregator`
 * provenance. Tagging to companies is done in-house by the worker (spec 04).
 */
@Injectable()
export class RssNewsAdapter implements NewsAdapter {
  readonly provenanceClass = ProvenanceClass.Aggregator;

  fetchHeadlines(): Promise<NewsArticleDto[]> {
    const out: NewsArticleDto[] = REFERENCE_UNIVERSE.map((c, i) => ({
      headline: `${c.shortName} in focus as market digests results`,
      url: `https://example.test/news/${c.stockCode}-${i}`,
      source: 'Demo Wire',
      publishedAt: new Date('2025-11-29T02:00:00.000Z'),
    }));
    return Promise.resolve(out);
  }
}

/**
 * Demo Shariah-list adapter — SC-PDF manual entry. Declares `real` provenance:
 * the SC list is public reference data (same posture as the production impl), so
 * it survives the decision-B purge.
 */
@Injectable()
export class ManualShariahListAdapter implements ShariahListAdapter {
  readonly provenanceClass = ProvenanceClass.Real;

  fetchShariahStatuses(): Promise<ShariahStatusDto[]> {
    const out: ShariahStatusDto[] = REFERENCE_UNIVERSE.map((c) => ({
      stockCode: c.stockCode,
      // INARI (technology) compliant; banks non-compliant — plausible demo values.
      status:
        c.sectorName === 'Financial Services'
          ? ShariahComplianceStatus.NonCompliant
          : ShariahComplianceStatus.Compliant,
      effectiveDate: '2025-05-30',
    }));
    return Promise.resolve(out);
  }
}

/**
 * Demo IPO adapter — manual entry. Declares `real` provenance (manual reference
 * data, survives the purge).
 */
@Injectable()
export class ManualIpoAdapter implements IpoAdapter {
  readonly provenanceClass = ProvenanceClass.Real;

  fetchIpoListings(): Promise<IpoListingDto[]> {
    return Promise.resolve([
      {
        companyName: 'Demo Newco Berhad',
        board: ListingBoard.Ace,
        listingDate: '2026-01-15',
        offerPrice: 0.5,
        prospectusS3Key: null,
      },
    ]);
  }
}
