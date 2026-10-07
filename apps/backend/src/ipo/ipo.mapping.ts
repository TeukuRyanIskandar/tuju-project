import type { ProspectusAtAGlanceResponse } from '@tuju/contracts';
import { ShariahComplianceStatus } from '../data/entities/enums';
import type { IpoListing } from '../data/entities/ipo-listing.entity';
import type { ProspectusAnalysis } from '../data/entities/prospectus-analysis.entity';

// `ProspectusAtAGlanceResponse` (the browser wire shape) lives in
// `@tuju/contracts` (ADR-0014). `IpoReferenceResponse` below is worker-facing and
// deliberately stays local.
export type { ProspectusAtAGlanceResponse };

/**
 * The Python worker's own `JobResult.jobId` prefix (colon-joined) — mirrors
 * `PROSPECTUS_JOB_ID_PREFIX` in `services/ai/src/tuju_ai/config.py` by hand
 * (no shared cross-language constant; keep both in lock-step). The BullMQ dedup
 * id is the separate hyphen form `prospectus-{id}` (`prospectusBullJobId`).
 */
export const PROSPECTUS_RESULT_JOB_ID_PREFIX = 'prospectus:';

/** `prospectus:{id}` → `{id}`; `null` when the jobId is not a prospectus result. */
export function prospectusIdFromJobId(jobId: string): string | null {
  if (!jobId.startsWith(PROSPECTUS_RESULT_JOB_ID_PREFIX)) return null;
  const id = jobId.slice(PROSPECTUS_RESULT_JOB_ID_PREFIX.length);
  return id.length > 0 ? id : null;
}

/** The three-plus-null vocabulary the Python worker's `IpoReference` accepts. */
export type ReferenceShariahStatus = 'compliant' | 'non-compliant' | 'unknown';

/**
 * Entity enum → worker vocabulary. `null` (no `ShariahStatus` row at all)
 * stays `null` — the worker reads that as "source unavailable", which is
 * truer than claiming an `unknown` verdict came from the SC list.
 */
export function mapShariahStatus(
  status: ShariahComplianceStatus | null | undefined,
): ReferenceShariahStatus | null {
  switch (status) {
    case ShariahComplianceStatus.Compliant:
      return 'compliant';
    case ShariahComplianceStatus.NonCompliant:
      return 'non-compliant';
    case undefined:
    case null:
      return null;
    default:
      return 'unknown'; // a future enum value the worker does not yet know
  }
}

/**
 * `GET /ipo/:prospectusId/reference` — EXACTLY what the Python worker's
 * `IpoReference` (`services/ai/.../analysis_models.py`) expects.
 */
export interface IpoReferenceResponse {
  id: string;
  companyName: string;
  board: string | null;
  /** ISO calendar date (`YYYY-MM-DD`) or null. */
  listingDate: string | null;
  prospectusS3Key: string;
  shariahStatus: ReferenceShariahStatus | null;
}

/** Listing row ⋈ current Shariah status → the worker-facing reference shape. */
export function toReference(
  listing: Pick<
    IpoListing,
    'id' | 'companyName' | 'board' | 'listingDate' | 'prospectusS3Key'
  >,
  shariah: ShariahComplianceStatus | null | undefined,
): IpoReferenceResponse {
  return {
    id: listing.id,
    companyName: listing.companyName,
    board: listing.board ?? null,
    listingDate: listing.listingDate ?? null,
    prospectusS3Key: listing.prospectusS3Key!,
    shariahStatus: mapShariahStatus(shariah),
  };
}

/** Listing row ⋈ thin analysis row → the public at-a-glance shape. */
export function toAtAGlance(
  listing: Pick<
    IpoListing,
    'id' | 'companyName' | 'board' | 'listingDate' | 'offerPrice'
  >,
  analysis: Pick<
    ProspectusAnalysis,
    'headline' | 'asOf' | 'artifactBucket' | 'artifactKey'
  >,
): ProspectusAtAGlanceResponse {
  return {
    prospectusId: listing.id,
    companyName: listing.companyName,
    board: listing.board ?? null,
    listingDate: listing.listingDate ?? null,
    offerPrice: listing.offerPrice ?? null,
    headline: analysis.headline,
    asOf: analysis.asOf.toISOString(),
    source: 'real',
    artifact: { bucket: analysis.artifactBucket, key: analysis.artifactKey },
    artifactPath: `/ipo/${listing.id}/at-a-glance/artifact`,
  };
}
