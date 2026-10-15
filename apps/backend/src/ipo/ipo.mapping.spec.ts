import { ShariahComplianceStatus } from '../data/entities/enums';
import {
  mapShariahStatus,
  toAtAGlance,
  toReference,
} from './ipo.mapping';

const ID = '5f3c1a2e-9b7d-4e1a-8c3f-2d6b7a9e0f41';

describe('mapShariahStatus', () => {
  it('maps the entity enum onto the worker vocabulary', () => {
    expect(mapShariahStatus(ShariahComplianceStatus.Compliant)).toBe('compliant');
    expect(mapShariahStatus(ShariahComplianceStatus.NonCompliant)).toBe(
      'non-compliant',
    );
  });
  it('null/undefined (no row) stays null', () => {
    expect(mapShariahStatus(null)).toBeNull();
    expect(mapShariahStatus(undefined)).toBeNull();
  });
  it('an unrecognised future enum value degrades to "unknown"', () => {
    expect(mapShariahStatus('PENDING' as unknown as ShariahComplianceStatus)).toBe(
      'unknown',
    );
  });
});

describe('toReference', () => {
  it('returns exactly the worker-facing keys', () => {
    const ref = toReference(
      {
        id: ID,
        companyName: 'Fibromat (M) Berhad',
        board: 'ACE' as never,
        listingDate: '2025-05-08',
        prospectusS3Key: 'prospectus/x.pdf',
      },
      ShariahComplianceStatus.Compliant,
    );
    expect(ref).toEqual({
      id: ID,
      companyName: 'Fibromat (M) Berhad',
      board: 'ACE',
      listingDate: '2025-05-08',
      prospectusS3Key: 'prospectus/x.pdf',
      shariahStatus: 'compliant',
    });
    expect(Object.keys(ref).sort()).toEqual(
      ['board', 'companyName', 'id', 'listingDate', 'prospectusS3Key', 'shariahStatus'],
    );
  });
  it('null listing date and no shariah row serialise as null', () => {
    const ref = toReference(
      {
        id: ID,
        companyName: 'X',
        board: 'MAIN' as never,
        listingDate: null,
        prospectusS3Key: 'prospectus/x.pdf',
      },
      null,
    );
    expect(ref.listingDate).toBeNull();
    expect(ref.shariahStatus).toBeNull();
  });
});

describe('toAtAGlance', () => {
  it('joins listing fields with the thin row and marks provenance real', () => {
    const out = toAtAGlance(
      {
        id: ID,
        companyName: 'Insights Analytics Berhad',
        board: 'ACE' as never,
        listingDate: '2025-10-27',
        offerPrice: '0.360000',
      },
      {
        headline: 'Watch customer concentration',
        asOf: new Date('2026-10-07T02:00:00Z'),
        artifactBucket: 'tuju-artifacts',
        artifactKey: `analysis/prospectus/${ID}/at-a-glance.json`,
      },
    );
    expect(out).toEqual({
      prospectusId: ID,
      companyName: 'Insights Analytics Berhad',
      board: 'ACE',
      listingDate: '2025-10-27',
      offerPrice: '0.360000',
      headline: 'Watch customer concentration',
      asOf: '2026-10-07T02:00:00.000Z',
      source: 'real',
      artifact: {
        bucket: 'tuju-artifacts',
        key: `analysis/prospectus/${ID}/at-a-glance.json`,
      },
      artifactPath: `/ipo/${ID}/at-a-glance/artifact`,
    });
  });
});
