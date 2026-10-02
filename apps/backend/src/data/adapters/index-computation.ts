/**
 * Cap-weighted index computation (spec 05, ticket 02) — the pure maths behind
 * the demo `SyntheticIndexAdapter`.
 *
 * Real FBM KLCI methodology, simplified to the data the analysed universe
 * actually has: the level is the total constituent **market cap
 * (close × shares outstanding)** normalised to a {@link INDEX_BASE_LEVEL}-point
 * base at the series' earliest date — the divisor form every capitalisation
 * index uses (divisor = base cap / 100). Free-float adjustment is the one
 * piece of the real methodology the demo cannot reproduce (no float data), and
 * it is irrelevant to the seam: production either ingests the official
 * published level (`LicensedIndexAdapter`) or recomputes with real float data —
 * same entities, same consumers.
 *
 * Shares outstanding are held constant across the synthetic timeline (A1),
 * so the daily level movement is pure price movement, exactly like a
 * fixed-divisor cap-weighted index between share-count changes.
 */

import { MarketIndexKind } from '../entities/enums';
import type { IndexLevelPointDto, IndexLevelsDto } from './dto';

/** One constituent bar the computation reads (only the close matters). */
export interface ConstituentBar {
  /** Trading day, ISO `YYYY-MM-DD`. */
  readonly tradeDate: string;
  readonly close: number;
}

/** One constituent of the analysed universe the index computation reads. */
export interface ConstituentInput {
  readonly stockCode: string;
  /** The constituent's Bursa sector name (scopes the per-Sector indices). */
  readonly sectorName: string;
  /** Shares outstanding, held constant across the timeline (A1). */
  readonly sharesOutstanding: number;
  readonly bars: readonly ConstituentBar[];
}

/** The level every series opens at on its base (earliest) date. */
export const INDEX_BASE_LEVEL = 100;

/**
 * Display names (the demo's house naming; production `LicensedIndexAdapter`
 * brings the licensed names). No provenance wording — the "illustrative"
 * label is a read-time lineage join, never a stored string.
 */
export const HEADLINE_INDEX_NAME = 'Tuju Composite Index';
const SECTOR_INDEX_SUFFIX = ' Index';

/**
 * Compute the headline + per-Sector cap-weighted index series over the
 * constituents, emitting the seam's {@link IndexLevelsDto} read model: the
 * headline reads the whole set, each per-Sector series reads ONLY that
 * Sector's constituents. A sector with no eligible constituent (bars +
 * shares) gets no series — there is nothing to weight.
 */
export function computeCapWeightedIndices(
  constituents: readonly ConstituentInput[],
): IndexLevelsDto[] {
  const eligible = constituents.filter(
    (c) => c.sharesOutstanding > 0 && c.bars.length > 0,
  );
  if (eligible.length === 0) return [];

  const series: IndexLevelsDto[] = [
    computeSeries(MarketIndexKind.Headline, null, HEADLINE_INDEX_NAME, eligible),
  ];

  const bySector = new Map<string, ConstituentInput[]>();
  for (const c of eligible) {
    const arr = bySector.get(c.sectorName);
    if (arr) arr.push(c);
    else bySector.set(c.sectorName, [c]);
  }
  // Deterministic order: sectors appear in their first constituent's order,
  // stable across re-ingests (same reference universe, same order).
  for (const [sectorName, members] of bySector) {
    series.push(
      computeSeries(
        MarketIndexKind.Sector,
        sectorName,
        `${sectorName}${SECTOR_INDEX_SUFFIX}`,
        members,
      ),
    );
  }
  return series;
}

/** One cap-weighted series over a constituent set: Σ(close × shares) / base. */
function computeSeries(
  kind: MarketIndexKind,
  sectorName: string | null,
  name: string,
  members: readonly ConstituentInput[],
): IndexLevelsDto {
  // Market cap per date; a constituent missing a given date simply does not
  // contribute that date (the demo timelines are aligned, so this is a guard,
  // not a branch the demo exercises).
  const capByDate = new Map<string, number>();
  for (const member of members) {
    for (const bar of member.bars) {
      capByDate.set(
        bar.tradeDate,
        (capByDate.get(bar.tradeDate) ?? 0) + bar.close * member.sharesOutstanding,
      );
    }
  }
  const dates = [...capByDate.keys()].sort();
  if (dates.length === 0) return { kind, sectorName, name, levels: [] };

  const baseCap = capByDate.get(dates[0])!;
  const levels: IndexLevelPointDto[] = dates.map((levelDate) => ({
    levelDate,
    level: (INDEX_BASE_LEVEL * (capByDate.get(levelDate) ?? 0)) / baseCap,
  }));
  return { kind, sectorName, name, levels };
}

/**
 * One index's live (intraday) cap-weighted level against the same series'
 * latest EOD level (spec 05, ticket 03) — the Redis class-3 payload the 5-min
 * replay writes and the market-overview endpoints read.
 */
export interface LiveIndexLevel {
  /** Headline vs per-Sector index (joins the `MarketIndex` row). */
  readonly kind: MarketIndexKind;
  /** The Bursa Sector name the index scopes to; null on the headline. */
  readonly sectorName: string | null;
  /** Display name (same naming as the stored series). */
  readonly name: string;
  /** Live cap-weighted level from the substituted live prices. */
  readonly level: number;
  /** Latest EOD level of the same series — the %change basis. */
  readonly prevLevel: number;
}

/**
 * Compute the LIVE cap-weighted level for every index (headline + per-Sector)
 * from the current intraday prices — the exact same divisor methodology as the
 * stored nightly series, run over constituent bars whose LAST close is
 * substituted with the live price (a constituent with no live price contributes
 * its EOD close). Production recomputes the live level over real licensed
 * intraday prices with the same function; a `LicensedIndexAdapter` that serves
 * official levels replaces this whole path at the seam.
 */
export function computeLiveIndexLevels(
  constituents: readonly ConstituentInput[],
  livePrices: ReadonlyMap<string, number>,
): LiveIndexLevel[] {
  const eodSeries = computeCapWeightedIndices(constituents);
  const substituted = constituents.map((c) => {
    const live = livePrices.get(c.stockCode);
    if (live === undefined || c.bars.length === 0) return c;
    const bars = c.bars.slice();
    const last = bars[bars.length - 1]!;
    bars[bars.length - 1] = { tradeDate: last.tradeDate, close: live };
    return { ...c, bars };
  });
  const liveSeries = computeCapWeightedIndices(substituted);
  const eodByKey = new Map(
    eodSeries.map((s) => [seriesKey(s.kind, s.sectorName), s]),
  );

  const out: LiveIndexLevel[] = [];
  for (const s of liveSeries) {
    const eod = eodByKey.get(seriesKey(s.kind, s.sectorName));
    const eodLast = eod?.levels[eod.levels.length - 1];
    const liveLast = s.levels[s.levels.length - 1];
    if (!eodLast || !liveLast) continue;
    out.push({
      kind: s.kind,
      sectorName: s.sectorName,
      name: s.name,
      level: liveLast.level,
      prevLevel: eodLast.level,
    });
  }
  return out;
}

/** Stable identity key of one index series (kind ⋈ sector). */
function seriesKey(kind: MarketIndexKind, sectorName: string | null): string {
  return `${kind}|${sectorName ?? ''}`;
}
