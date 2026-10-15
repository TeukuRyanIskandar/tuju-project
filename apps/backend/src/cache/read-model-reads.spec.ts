/**
 * Read-model read catalogue unit tests (absorbs the old per-service
 * `screener-cache-key.spec.ts` + the fields-key pin).
 *
 * 1. Key compatibility: every named read produces the SAME Redis key the
 *    services hand-built before `ReadModelCache`, so a deploy neither orphans
 *    nor mis-hits entries already in Redis.
 * 2. Normalisation: equivalent requests share one entry; different requests
 *    never collide (the screener canonical-key contract, spec 03 ticket 02).
 *
 * Pure functions; no containers. Which change clears which read is pinned in
 * `read-model-changes.spec.ts` and, against real Redis, in
 * `read-model-cache.int-spec.ts`.
 */

import { parseScreenerQuery, type RawScreenerParams } from '../screener/params';
import { ReadModelReads } from './read-model-reads';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('ReadModelReads — keys are byte-compatible with the pre-module keys', () => {
  it.each([
    [ReadModelReads.search('CIMB', 20), 'cache:search:cimb:20'],
    [ReadModelReads.stockCore('1155'), 'cache:stocks:1155:core'],
    [
      ReadModelReads.stockAnnouncements('1155', ['MEETING', 'ENTITLEMENT'], { offset: 0, limit: 20 }),
      'cache:stocks:1155:announcements:ENTITLEMENT,MEETING:0:20',
    ],
    [
      ReadModelReads.stockCorporateActions('1155', [], { offset: 20, limit: 10 }),
      'cache:stocks:1155:corporate-actions::20:10',
    ],
    [
      ReadModelReads.marketAnnouncements(['GENERAL'], {
        companyCode: '1155',
        from: day('2026-10-01'),
        to: null,
        offset: 0,
        limit: 25,
      }),
      'cache:disclosures:announcements:GENERAL:1155:2026-10-01::0:25',
    ],
    [
      ReadModelReads.dealings(['SHAREHOLDING_CHANGE'], { from: null, to: null, offset: 0, limit: 25 }),
      'cache:disclosures:dealings:SHAREHOLDING_CHANGE::::0:25',
    ],
    [
      ReadModelReads.corporateActionCalendar(
        { from: '2026-09-24', to: '2026-10-31' },
        ['SPLIT', 'DIVIDEND'],
        undefined,
      ),
      'cache:disclosures:calendar:corporate-actions:2026-09-24:2026-10-31:DIVIDEND,SPLIT:',
    ],
    [
      ReadModelReads.resultsCalendar({ from: day('2026-01-01'), to: day('2026-03-31'), companyCode: '1155' }),
      'cache:disclosures:calendar:results:2026-01-01:2026-03-31:1155',
    ],
    [ReadModelReads.news({ offset: 0, limit: 20 }), 'cache:disclosures:news:market:0:20'],
    [ReadModelReads.news({ companyCode: '1155', offset: 0, limit: 20 }), 'cache:disclosures:news:1155:0:20'],
    [ReadModelReads.screenerFields(), 'cache:screener:fields'],
    [ReadModelReads.moversEod('gainers'), 'cache:market:movers:eod:gainers'],
    [ReadModelReads.indices(), 'cache:market:indices'],
    [ReadModelReads.indexSeries('idx-1', '1y'), 'cache:market:indices:idx-1:series:1y'],
    [ReadModelReads.latestMarketBrief(), 'cache:brief:latest'],
    [ReadModelReads.prospectusAtAGlance('p-1'), 'cache:prospectus:p-1:at-a-glance'],
    [ReadModelReads.prospectusArtifact('p-1'), 'cache:prospectus:p-1:artifact'],
  ])('%j → %s', (read, key) => {
    expect(read.key).toBe(key);
  });
});

describe('ReadModelReads.stockAnnouncements / corporate actions', () => {
  it('enum filters are order-insensitive', () => {
    const page = { offset: 0, limit: 20 };
    expect(ReadModelReads.stockAnnouncements('1155', ['A', 'B'], page).key).toBe(
      ReadModelReads.stockAnnouncements('1155', ['B', 'A'], page).key,
    );
    expect(ReadModelReads.stockCorporateActions('1155', ['A', 'B'], page).key).toBe(
      ReadModelReads.stockCorporateActions('1155', ['B', 'A'], page).key,
    );
  });
});

describe('ReadModelReads.screen (canonical screener key)', () => {
  /** Raw params → the canonical key (resolve first, exactly like the service). */
  const keyOf = (raw: RawScreenerParams): string =>
    ReadModelReads.screen(parseScreenerQuery(raw)).key;

  it('lands under the screener prefix', () => {
    expect(keyOf({}).startsWith('cache:screener:screen:')).toBe(true);
  });

  it('explicit defaults ≡ omitted params (dropped defaults share one entry)', () => {
    expect(keyOf({})).toBe(
      keyOf({ sort: 'pctChange', dir: 'desc', offset: '0', limit: '50' }),
    );
  });

  it('garbage params drop to no-constraint and share the default key', () => {
    expect(
      keyOf({ peMin: 'cheap', shariah: 'yes', board: 'LEAP', limit: 'abc' }),
    ).toBe(keyOf({}));
  });

  it('clamped pagination equivalents share one entry (resolved values keyed)', () => {
    expect(keyOf({ limit: '500' })).toBe(keyOf({ limit: '100' }));
    expect(keyOf({ offset: '-3' })).toBe(keyOf({ offset: '0' }));
    // But a clamped value is NOT the omitted default: 100 ≠ 50 → distinct.
    expect(keyOf({ limit: '500' })).not.toBe(keyOf({}));
  });

  it('rotated/deduped board + sector lists share one entry (order-insensitive)', () => {
    expect(keyOf({ board: 'MAIN,ACE' })).toBe(keyOf({ board: 'ACE,MAIN' }));
    expect(keyOf({ board: 'MAIN,ACE,MAIN' })).toBe(keyOf({ board: 'ACE,MAIN' }));
    const a = '00000000-0000-0000-0000-0000000000aa';
    const b = '00000000-0000-0000-0000-0000000000bb';
    expect(keyOf({ sector: `${a},${b}` })).toBe(keyOf({ sector: `${b},${a}` }));
  });

  it('different filters/sorts/pages normalise to different keys', () => {
    expect(keyOf({ shariah: 'true' })).not.toBe(keyOf({ shariah: 'false' }));
    expect(keyOf({ shariah: 'true' })).not.toBe(keyOf({}));
    expect(keyOf({ peMin: '0' })).not.toBe(keyOf({ peMin: '10' }));
    // Field order is fixed: a min on one field ≠ a max on another.
    expect(keyOf({ peMin: '10' })).not.toBe(keyOf({ peMax: '10' }));
    expect(keyOf({ aboveSma50: 'true' })).not.toBe(
      keyOf({ aboveSma200: 'true' }),
    );
    expect(keyOf({ sort: 'pe', dir: 'asc' })).not.toBe(
      keyOf({ sort: 'pe', dir: 'desc' }),
    );
    expect(keyOf({ offset: '0' })).not.toBe(keyOf({ offset: '25' }));
  });

  it('pins the fixed field order with a fully-populated screen', () => {
    const a = '00000000-0000-0000-0000-0000000000aa';
    const b = '00000000-0000-0000-0000-0000000000bb';
    const key = keyOf({
      board: 'MAIN,ACE', // key fragment is sorted → ACE,MAIN
      sector: `${b},${a}`, // key fragment is sorted → a,b
      shariah: 'true',
      priceMin: '1',
      priceMax: '2',
      volumeMin: '3',
      marketCapMin: '4',
      marketCapMax: '5',
      peMin: '6',
      peMax: '7',
      dyMin: '0.01',
      dyMax: '0.02',
      pNtaMin: '8',
      pNtaMax: '9',
      roeMin: '0.1',
      roeMax: '0.2',
      deMin: '10',
      deMax: '11',
      profitableYearsMin: '3',
      yoyProfitGrowthMin: '0.05',
      consecutiveGrowthQuartersMin: '4',
      rsi14Min: '30',
      rsi14Max: '70',
      aboveSma50: 'true',
      aboveSma200: 'false',
      sort: 'pe',
      dir: 'asc',
      offset: '25',
      limit: '10',
    });
    expect(key).toBe(
      'cache:screener:screen:' +
        'ACE,MAIN:' +
        `${a},${b}:` +
        'true:' +
        '1:2:3:' +
        '4:5:' +
        '6:7:' +
        '0.01:0.02:' +
        '8:9:' +
        '0.1:0.2:' +
        '10:11:' +
        '3:0.05:4:' +
        '30:70:' +
        'true:false:' +
        'pe:asc:25:10',
    );
  });
});
