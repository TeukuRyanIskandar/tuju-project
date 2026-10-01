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
import { mapAnnouncementLabel } from './announcement-labels';
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
 * Declares `aggregator` provenance (purged at the licence boundary).
 *
 * The snapshot carries the aggregator's OWN raw `label`s; the stable internal
 * {@link AnnouncementCategory}/{@link CorporateActionType} enums are what the
 * seam emits (via {@link mapAnnouncementLabel}; unknown → `OTHER`, never a
 * dropped row), so the demo snapshot and a later licensed Bursa feed land on
 * the same categories with no consumer change.
 *
 * Row set per company (spec 04's read surface needs content to read):
 * one `FINANCIAL_RESULTS` filing per latest-4 quarter (feeds the results
 * calendar; filed ~45 days after period end), an entitlement, two
 * `SHAREHOLDING_CHANGE` dealings, a general/meeting/circular filing, and one
 * label the map does not know (exercising the `OTHER` fallback). Feed rows use
 * now-relative `filedAt`s (so date windows always have content; the natural key
 * is per-day stable so the nightly re-ingest stays an idempotent upsert).
 * Corporate actions add one action per type with now-relative ex-dates (a
 * dividend inside and a bonus on the edge of the default calendar window,
 * split/rights outside it). The original fixed-date dividend row stays — it is
 * the trailing-window row DY reads (single source) and its ex-date is past
 * the generator's last bar, as are the new dividend's, so DY is unchanged.
 */
@Injectable()
export class AggregatorDisclosureAdapter implements DisclosureAdapter {
  readonly provenanceClass = ProvenanceClass.Aggregator;

  fetchAnnouncements(): Promise<AnnouncementDto[]> {
    const now = snapshotNow();
    const raw: RawDisclosureRow[] = [];
    for (const company of REFERENCE_UNIVERSE) {
      const seed = instrumentSeed(SYNTHETIC_BASE_SEED, company.stockCode);
      const dataset = generate(seed);
      // One results filing per latest-4 quarter, filed after the period ends
      // (the results-calendar join: earliest FINANCIAL_RESULTS filing at/after
      // the quarter's period end reports that quarter).
      const quarters = [...dataset.quarterlyFinancials]
        .sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1))
        .slice(-RESULTS_CALENDAR_QUARTERS);
      for (const q of quarters) {
        raw.push({
          stockCode: company.stockCode,
          label: 'Quarterly Report',
          title: `${company.shortName}: Quarterly report on consolidated results for Q${q.fiscalQuarter} FY${q.fiscalYear}`,
          filedAt: plusDays(new Date(`${q.periodEnd}T00:00:00.000Z`), RESULTS_FILING_LAG_DAYS),
          sourceUrl: null,
        });
      }
      for (const row of AGGREGATOR_DISCLOSURE_TEMPLATE) {
        raw.push({
          stockCode: company.stockCode,
          label: row.label,
          title: row.title(company.shortName),
          filedAt: plusDays(now, row.filedDaysFromNow),
          sourceUrl: null,
        });
      }
    }
    return Promise.resolve(raw.map(mapDisclosureRow));
  }

  fetchCorporateActions(): Promise<CorporateActionDto[]> {
    const now = snapshotNow();
    const out: CorporateActionDto[] = [];
    for (const company of REFERENCE_UNIVERSE) {
      // The trailing-window dividend row DY reads (fixed ex-date, past the
      // generator's last bar so it alone feeds DY).
      out.push({
        stockCode: company.stockCode,
        type: CorporateActionType.Dividend,
        exDate: DY_DIVIDEND_EX_DATE,
        amount: 0.05,
      });
      for (const row of AGGREGATOR_ACTION_TEMPLATE) {
        out.push({
          stockCode: company.stockCode,
          type: row.type,
          exDate: isoDate(plusDays(now, row.exDaysFromNow)),
          amount: row.amount,
        });
      }
    }
    return Promise.resolve(out);
  }
}

/** Latest quarters the demo snapshot files results for (results calendar depth). */
const RESULTS_CALENDAR_QUARTERS = 4;

/** Results are filed this many days after the quarter's period end. */
const RESULTS_FILING_LAG_DAYS = 45;

/** Fixed ex-date of the trailing-window dividend row (feeds DY; past last bar). */
const DY_DIVIDEND_EX_DATE = '2025-09-15';

/** One non-results disclosure row per company, now-relative filing times. */
interface DisclosureTemplateRow {
  /** The aggregator's own raw label (mapped onto the enum at the seam). */
  readonly label: string;
  readonly title: (shortName: string) => string;
  readonly filedDaysFromNow: number;
}

const AGGREGATOR_DISCLOSURE_TEMPLATE: readonly DisclosureTemplateRow[] = [
  {
    label: 'Entitlement Notice',
    title: (s) => `${s}: Notice of single tier interim dividend`,
    filedDaysFromNow: -5,
  },
  {
    label: 'Dealing in Listed Shares by Director',
    title: (s) => `${s}: Dealing in listed shares by director`,
    filedDaysFromNow: -2,
  },
  {
    label: 'Dealing in Listed Shares by Substantial Shareholder',
    title: (s) => `${s}: Dealing in listed shares by substantial shareholder`,
    filedDaysFromNow: -9,
  },
  {
    label: 'General Announcement',
    title: (s) => `${s}: General announcement`,
    filedDaysFromNow: -12,
  },
  {
    label: 'General Meeting',
    title: (s) => `${s}: Notice of annual general meeting`,
    filedDaysFromNow: -20,
  },
  {
    label: 'Circular to Shareholders',
    title: (s) => `${s}: Circular to shareholders`,
    filedDaysFromNow: -25,
  },
  {
    // A label the map does not know — exercises the OTHER fallback.
    label: 'Market Update',
    title: (s) => `${s}: Supplementary market update`,
    filedDaysFromNow: -30,
  },
];

/** One corporate action per type, now-relative ex-dates around the window. */
interface ActionTemplateRow {
  readonly type: CorporateActionType;
  readonly exDaysFromNow: number;
  readonly amount: number | null;
}

const AGGREGATOR_ACTION_TEMPLATE: readonly ActionTemplateRow[] = [
  // Inside the default calendar window (7 back … +30 ahead).
  { type: CorporateActionType.Dividend, exDaysFromNow: 10, amount: 0.06 },
  { type: CorporateActionType.Bonus, exDaysFromNow: -3, amount: null },
  // Outside it (forward / backward of the window).
  { type: CorporateActionType.Split, exDaysFromNow: 40, amount: null },
  { type: CorporateActionType.Rights, exDaysFromNow: -15, amount: 0.15 },
];

/** One raw snapshot row before its label is mapped onto the stable enum. */
interface RawDisclosureRow {
  readonly stockCode: string;
  readonly label: string;
  readonly title: string;
  readonly filedAt: Date;
  readonly sourceUrl: string | null;
}

/** Map a raw labelled row onto the seam DTO (label → stable enum, unknown → OTHER). */
function mapDisclosureRow(row: RawDisclosureRow): AnnouncementDto {
  return {
    stockCode: row.stockCode,
    category: mapAnnouncementLabel(row.label),
    title: row.title,
    filedAt: row.filedAt,
    sourceUrl: row.sourceUrl,
  };
}

/** `n` days after a date (negative = before). */
function plusDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** ISO `YYYY-MM-DD` of a date (UTC — calendar rows are date-only). */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The snapshot's "now": 09:00 UTC of the CURRENT UTC day, so two fetches on
 * the same day emit identical timestamps (same-day nightly re-ingest stays an
 * idempotent natural-key upsert) while successive days drift the snapshot
 * forward like a real feed.
 */
function snapshotNow(): Date {
  const today = new Date().toISOString().slice(0, 10);
  return new Date(`${today}T09:00:00.000Z`);
}

/**
 * Demo news adapter — RSS headlines + links (no bodies). Declares `aggregator`
 * provenance. Tagging to companies is done in-house by the worker (spec 04 §2,
 * `news-tagging.ts`) — the snapshot just carries the headline cases:
 * shortName hits (one per company), a curated-alias hit, a multi-company
 * headline, substring non-matches, and untagged market-level rows.
 */
@Injectable()
export class RssNewsAdapter implements NewsAdapter {
  readonly provenanceClass = ProvenanceClass.Aggregator;

  fetchHeadlines(): Promise<NewsArticleDto[]> {
    const now = snapshotNow();
    const out: NewsArticleDto[] = [];
    let hoursAgo = 1;
    const push = (headline: string, source: string): void => {
      out.push({
        headline,
        url: `https://example.test/news/${out.length}`,
        source,
        publishedAt: new Date(now.getTime() - hoursAgo * 60 * 60 * 1000),
      });
      hoursAgo += 2;
    };
    // ShortName hits — one per reference company (tagged by the worker).
    for (const c of REFERENCE_UNIVERSE) {
      push(`${c.shortName} posts record quarterly profit`, 'Demo Wire');
    }
    // Curated-alias hit (TNB → Tenaga Nasional Berhad).
    push('TNB wins transmission contract tender', 'KL Market Beat');
    // Multi-company headline — tags every confident hit.
    push('Maybank and CIMB lead banks higher', 'Demo Wire');
    // Substring non-matches — conservative whole-word rule leaves untagged.
    push('New fintech platform TenagaX launches', 'KL Market Beat');
    // Market-level coverage — no company match by design.
    push('Bursa Malaysia closes higher on regional rally', 'Demo Wire');
    push('Ringgit strengthens against the US dollar', 'KL Market Beat');
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
