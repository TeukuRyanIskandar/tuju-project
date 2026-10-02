/**
 * Cap-weighted index computation test (spec 05, ticket 02 Testing decisions).
 *
 * A "good test = external behaviour" case: with KNOWN constituent bars the
 * computed level must match the expected cap-weighted sum (Σ close × shares
 * normalised to the 100 base, the real FBM KLCI divisor methodology), and a
 * per-Sector index must scope to that Sector's constituents only — not the
 * whole universe the headline index reads.
 */

import { MarketIndexKind } from '../entities/enums';
import {
  computeCapWeightedIndices,
  computeLiveIndexLevels,
  INDEX_BASE_LEVEL,
  type ConstituentInput,
  type LiveIndexLevel,
} from './index-computation';

/** Fixture dates (ISO, date-only — the level series axis). */
const D1 = '2026-01-05';
const D2 = '2026-01-06';
const D3 = '2026-01-07';

/**
 * Known-bar fixtures (hand-computable caps):
 *
 * | constituent | sector            | shares | closes D1 / D2 / D3 |
 * |-------------:|-------------------|-------:|---------------------|
 * | C1           | Financial Services|    100 | 10 / 11 / 12       |
 * | C2           | Financial Services|    200 | 5 / 5.5 / 4        |
 * | C3           | Technology        |     50 | 20 / 22 / 21       |
 *
 * Headline caps:  D1 3000, D2 3300, D3 3050 → levels 100, 110, 101.666667
 * Financial caps: D1 2000, D2 2200, D3 2000 → levels 100, 110, 100
 * Technology caps:D1 1000, D2 1100, D3 1050 → levels 100, 110, 105
 */
const KNOWN_CONSTITUENTS: readonly ConstituentInput[] = [
  {
    stockCode: 'C1',
    sectorName: 'Financial Services',
    sharesOutstanding: 100,
    bars: [
      { tradeDate: D1, close: 10 },
      { tradeDate: D2, close: 11 },
      { tradeDate: D3, close: 12 },
    ],
  },
  {
    stockCode: 'C2',
    sectorName: 'Financial Services',
    sharesOutstanding: 200,
    bars: [
      { tradeDate: D1, close: 5 },
      { tradeDate: D2, close: 5.5 },
      { tradeDate: D3, close: 4 },
    ],
  },
  {
    stockCode: 'C3',
    sectorName: 'Technology',
    sharesOutstanding: 50,
    bars: [
      { tradeDate: D1, close: 20 },
      { tradeDate: D2, close: 22 },
      { tradeDate: D3, close: 21 },
    ],
  },
];

/** A sector whose only constituent has no bars — no series for it at all. */
const BARLESS_CONSTITUENT: ConstituentInput = {
  stockCode: 'C4',
  sectorName: 'Consumer Products & Services',
  sharesOutstanding: 1_000,
  bars: [],
};

describe('computeCapWeightedIndices', () => {
  it('headline level matches the expected cap-weighted sum (base 100)', async () => {
    const series = await computeCapWeightedIndices(KNOWN_CONSTITUENTS);
    const headline = series.find((s) => s.kind === MarketIndexKind.Headline);
    expect(headline).toBeDefined();
    expect(headline!.sectorName).toBeNull();

    // Σ close × shares normalised to the 100 base at the earliest date.
    expect(headline!.levels).toHaveLength(3);
    const [l1, l2, l3] = headline!.levels;
    expect(l1.levelDate).toBe(D1);
    expect(l1.level).toBeCloseTo(INDEX_BASE_LEVEL, 6);
    expect(l2.level).toBeCloseTo(INDEX_BASE_LEVEL * (3300 / 3000), 6); // 110
    expect(l3.level).toBeCloseTo(INDEX_BASE_LEVEL * (3050 / 3000), 6); // 101.666…
  });

  it('a per-Sector index scopes to that Sector’s constituents only', async () => {
    const series = await computeCapWeightedIndices(KNOWN_CONSTITUENTS);
    const financial = series.find(
      (s) => s.kind === MarketIndexKind.Sector && s.sectorName === 'Financial Services',
    );
    const technology = series.find(
      (s) => s.kind === MarketIndexKind.Sector && s.sectorName === 'Technology',
    );
    expect(financial).toBeDefined();
    expect(technology).toBeDefined();

    // Financial: caps 2000 / 2200 / 2000 — D3 falls BACK to 100 (C2's drop),
    // while the headline (C3 included) ends at ~101.67: the scope differs.
    expect(financial!.levels.map((l) => l.level)).toEqual([
      expect.closeTo(100, 6),
      expect.closeTo(110, 6),
      expect.closeTo(100, 6),
    ]);
    expect(technology!.levels.map((l) => l.level)).toEqual([
      expect.closeTo(100, 6),
      expect.closeTo(110, 6),
      expect.closeTo(105, 6),
    ]);
  });

  it('emits one headline + one series per Sector WITH constituents; barless sectors get none', async () => {
    const series = await computeCapWeightedIndices([
      ...KNOWN_CONSTITUENTS,
      BARLESS_CONSTITUENT,
    ]);
    // 1 headline + Financial Services + Technology; the barless sector is absent.
    expect(series).toHaveLength(3);
    expect(
      series.some((s) => s.sectorName === 'Consumer Products & Services'),
    ).toBe(false);
  });

  it('labels the series with the display names the entities persist', async () => {
    const series = await computeCapWeightedIndices(KNOWN_CONSTITUENTS);
    // No provenance wording in the name — the "illustrative" label is a
    // read-time lineage join, never a stored string.
    expect(series.find((s) => s.kind === MarketIndexKind.Headline)!.name).toBe(
      'Tuju Composite Index',
    );
    expect(
      series.find((s) => s.sectorName === 'Technology')!.name,
    ).toBe('Technology Index');
  });

  it('orders every series ascending by level date', async () => {
    for (const s of await computeCapWeightedIndices(KNOWN_CONSTITUENTS)) {
      const dates = s.levels.map((l) => l.levelDate);
      expect([...dates].sort()).toEqual(dates);
    }
  });
});

describe('computeLiveIndexLevels', () => {
  /**
   * Live prices on D3 (closes 12 / 4 / 21):
   *
   * | constituent | live | live cap contribution |
   * |------------:|-----:|----------------------:|
   * | C1 (100 sh) |   13 | 1300 |
   * | C2 (200 sh) |    5 | 1000 |
   * | C3 ( 50 sh) |   19 |  950 |
   *
   * Headline live cap 3250 → live level 100 × 3250 / 3000 = 108.333333
   * (prevLevel = the D3 EOD level 101.666667).
   * Financial live cap 2300 → 115 (prevLevel 100). Technology 950 → 95 (105).
   */
  const LIVE: ReadonlyMap<string, number> = new Map([
    ['C1', 13],
    ['C2', 5],
    ['C3', 19],
  ]);

  const live = (levels: readonly LiveIndexLevel[]) =>
    (kind: MarketIndexKind, sectorName: string | null) =>
      levels.find(
        (l) => l.kind === kind && l.sectorName === sectorName,
      )!;

  it('computes the live level as the same cap-weighted maths over live prices', async () => {
    const levels = await computeLiveIndexLevels(KNOWN_CONSTITUENTS, LIVE);
    const at = live(levels);

    const headline = at(MarketIndexKind.Headline, null);
    expect(headline.level).toBeCloseTo(INDEX_BASE_LEVEL * (3250 / 3000), 6);
    // prevLevel = the same series' latest EOD level (the %change basis).
    expect(headline.prevLevel).toBeCloseTo(INDEX_BASE_LEVEL * (3050 / 3000), 6);

    const financial = at(MarketIndexKind.Sector, 'Financial Services');
    expect(financial.level).toBeCloseTo(INDEX_BASE_LEVEL * (2300 / 2000), 6); // 115
    expect(financial.prevLevel).toBeCloseTo(100, 6);

    const technology = at(MarketIndexKind.Sector, 'Technology');
    expect(technology.level).toBeCloseTo(INDEX_BASE_LEVEL * (950 / 1000), 6); // 95
    expect(technology.prevLevel).toBeCloseTo(105, 6);
  });

  it('scopes each per-Sector live level to that Sector’s live constituents', async () => {
    const levels = await computeLiveIndexLevels(KNOWN_CONSTITUENTS, LIVE);
    // C3 (Technology) falls to 19 while the Financial index rises to 115 —
    // the live scope mirrors the stored-series scope, per Sector.
    expect(live(levels)(MarketIndexKind.Sector, 'Technology')!.level)
      .toBeCloseTo(95, 6);
    expect(live(levels)(MarketIndexKind.Sector, 'Financial Services')!.level)
      .toBeCloseTo(115, 6);
  });

  it('emits one live level per stored index (headline + sectors with constituents)', async () => {
    const levels = await computeLiveIndexLevels(
      [...KNOWN_CONSTITUENTS, BARLESS_CONSTITUENT],
      LIVE,
    );
    expect(levels).toHaveLength(3);
    expect(
      levels.some((l) => l.sectorName === 'Consumer Products & Services'),
    ).toBe(false);
  });

  it('carries the index identity the read surface joins the MarketIndex row on', async () => {
    const levels = await computeLiveIndexLevels(KNOWN_CONSTITUENTS, LIVE);
    const headline = live(levels)(MarketIndexKind.Headline, null);
    expect(headline.name).toBe('Tuju Composite Index');
    expect(headline.kind).toBe(MarketIndexKind.Headline);
    expect(headline.sectorName).toBeNull();
  });

  it('falls back to a constituent’s EOD close when it has no live price', async () => {
    // C3 missing from the live map: it contributes its D3 EOD close (21).
    const partial = await computeLiveIndexLevels(
      KNOWN_CONSTITUENTS,
      new Map([
        ['C1', 13],
        ['C2', 5],
      ]),
    );
    const headline = live(partial)(MarketIndexKind.Headline, null);
    // Live cap 1300 + 1000 + 1050 = 3350 → 111.666667.
    expect(headline.level).toBeCloseTo(INDEX_BASE_LEVEL * (3350 / 3000), 6);
    // Technology falls back entirely (no live member) → live = prev.
    expect(live(partial)(MarketIndexKind.Sector, 'Technology')!.level)
      .toBeCloseTo(105, 6);
  });

  it('with no live prices the live level equals the latest EOD level', async () => {
    const levels = await computeLiveIndexLevels(KNOWN_CONSTITUENTS, new Map());
    for (const l of levels) {
      expect(l.level).toBeCloseTo(l.prevLevel, 9);
    }
  });
});
