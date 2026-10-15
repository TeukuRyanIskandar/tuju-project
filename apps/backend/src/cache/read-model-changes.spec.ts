/**
 * The event → invalidation table, pinned as data. The Redis-level behaviour
 * ("after change X, read Y misses") is pinned once in
 * `read-model-cache.int-spec.ts`.
 */

import { invalidationsFor } from './read-model-changes';

const BULK = [
  'cache:search:',
  'cache:stocks:',
  'cache:disclosures:',
  'cache:screener:',
  'cache:market:',
];

describe('invalidationsFor (the read-model change table)', () => {
  it.each(['eodIngested', 'purged'] as const)(
    '%s clears every EOD/disclosure-derived read, but never the brief or prospectus reads',
    (kind) => {
      const { keys, prefixes } = invalidationsFor({ kind });
      expect(keys).toEqual([]);
      expect([...prefixes]).toEqual(BULK);
      expect(prefixes).not.toContain('cache:brief:');
      expect(prefixes).not.toContain('cache:prospectus:');
    },
  );

  it('announcementSummarised clears the reads that carry aiSummary, for its stocks only', () => {
    expect(
      invalidationsFor({
        kind: 'announcementSummarised',
        announcementId: 'a-1',
        stockCodes: ['1155', '1023'],
      }),
    ).toEqual({
      keys: [],
      prefixes: [
        'cache:disclosures:announcements:',
        'cache:disclosures:dealings:',
        'cache:stocks:1155:announcements:',
        'cache:stocks:1023:announcements:',
      ],
    });
  });

  it('stockAnalysisChanged deletes exactly that stock’s TA or FA envelope key (no sweep)', () => {
    expect(
      invalidationsFor({
        kind: 'stockAnalysisChanged',
        stockCode: '1155',
        analysis: 'technical',
      }),
    ).toEqual({ keys: ['cache:stocks:1155:analysis:technical'], prefixes: [] });
  });

  it('marketBriefLanded clears the brief reads', () => {
    expect(invalidationsFor({ kind: 'marketBriefLanded' })).toEqual({
      keys: [],
      prefixes: ['cache:brief:'],
    });
  });

  it('prospectusAnalysed clears only that prospectus', () => {
    expect(
      invalidationsFor({ kind: 'prospectusAnalysed', prospectusId: 'p-1' }),
    ).toEqual({ keys: [], prefixes: ['cache:prospectus:p-1:'] });
  });

  it('every key and prefix stays inside the read cache (never BullMQ, sessions or intraday:)', () => {
    const all = [
      invalidationsFor({ kind: 'eodIngested' }),
      invalidationsFor({ kind: 'purged' }),
      invalidationsFor({
        kind: 'announcementSummarised',
        announcementId: 'a',
        stockCodes: ['1155'],
      }),
      invalidationsFor({ kind: 'stockAnalysisChanged', stockCode: '1155', analysis: 'fundamental' }),
      invalidationsFor({ kind: 'marketBriefLanded' }),
      invalidationsFor({ kind: 'prospectusAnalysed', prospectusId: 'p' }),
    ].flatMap(({ keys, prefixes }) => [...keys, ...prefixes]);
    expect(all.every((p) => p.startsWith('cache:'))).toBe(true);
  });
});
