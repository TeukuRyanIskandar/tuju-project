/**
 * The event → prefixes table, pinned as data. The Redis-level behaviour
 * ("after change X, read Y misses") is pinned once in
 * `read-model-cache.int-spec.ts`.
 */

import { invalidationPrefixesFor } from './read-model-changes';

const BULK = [
  'cache:search:',
  'cache:stocks:',
  'cache:disclosures:',
  'cache:screener:',
  'cache:market:',
];

describe('invalidationPrefixesFor (the read-model change table)', () => {
  it.each(['eodIngested', 'purged'] as const)(
    '%s clears every EOD/disclosure-derived read, but never the brief or prospectus reads',
    (kind) => {
      const prefixes = invalidationPrefixesFor({ kind });
      expect([...prefixes]).toEqual(BULK);
      expect(prefixes).not.toContain('cache:brief:');
      expect(prefixes).not.toContain('cache:prospectus:');
    },
  );

  it('announcementSummarised clears the reads that carry aiSummary, for its stocks only', () => {
    expect(
      invalidationPrefixesFor({
        kind: 'announcementSummarised',
        announcementId: 'a-1',
        stockCodes: ['1155', '1023'],
      }),
    ).toEqual([
      'cache:disclosures:announcements:',
      'cache:disclosures:dealings:',
      'cache:stocks:1155:announcements:',
      'cache:stocks:1023:announcements:',
    ]);
  });

  it('stockAnalysisChanged clears only that stock’s TA or FA envelope', () => {
    expect(
      invalidationPrefixesFor({
        kind: 'stockAnalysisChanged',
        stockCode: '1155',
        analysis: 'technical',
      }),
    ).toEqual(['cache:stocks:1155:analysis:technical']);
  });

  it('marketBriefLanded clears the brief reads', () => {
    expect(invalidationPrefixesFor({ kind: 'marketBriefLanded' })).toEqual([
      'cache:brief:',
    ]);
  });

  it('prospectusAnalysed clears only that prospectus', () => {
    expect(
      invalidationPrefixesFor({ kind: 'prospectusAnalysed', prospectusId: 'p-1' }),
    ).toEqual(['cache:prospectus:p-1:']);
  });

  it('every prefix stays inside the read cache (never BullMQ, sessions or intraday:)', () => {
    const all = [
      ...invalidationPrefixesFor({ kind: 'eodIngested' }),
      ...invalidationPrefixesFor({ kind: 'purged' }),
      ...invalidationPrefixesFor({
        kind: 'announcementSummarised',
        announcementId: 'a',
        stockCodes: ['1155'],
      }),
      ...invalidationPrefixesFor({ kind: 'stockAnalysisChanged', stockCode: '1155', analysis: 'fundamental' }),
      ...invalidationPrefixesFor({ kind: 'marketBriefLanded' }),
      ...invalidationPrefixesFor({ kind: 'prospectusAnalysed', prospectusId: 'p' }),
    ];
    expect(all.every((p) => p.startsWith('cache:'))).toBe(true);
  });
});
