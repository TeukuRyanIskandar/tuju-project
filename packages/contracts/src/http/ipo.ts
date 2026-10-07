import { z } from 'zod';
import { IsoDate, IsoDateTime } from './common.js';

/**
 * `GET /ipo/:prospectusId/at-a-glance` — the thin summary (anonymous public
 * read). The rich artifact at `artifactPath` is `ProspectusArtifact`
 * (ADR-0014 §3), not part of this file. The worker-facing `/reference`
 * endpoint is not a browser response and is not modelled here.
 */
export const ProspectusAtAGlanceResponse = z.strictObject({
  prospectusId: z.string(),
  companyName: z.string(),
  board: z.string().nullable(),
  listingDate: IsoDate.nullable(),
  /** NUMERIC string, e.g. `"0.360000"`. */
  offerPrice: z.string().nullable(),
  headline: z.string(),
  asOf: IsoDateTime,
  /** Always `real`: stored regulatory PDFs, no synthetic/aggregator data. */
  source: z.literal('real'),
  /** Claim-check pointer (ADR-0004 §4). */
  artifact: z.strictObject({ bucket: z.string(), key: z.string() }),
  /** NestJS-proxied read of the rich artifact. */
  artifactPath: z.string(),
});
export type ProspectusAtAGlanceResponse = z.infer<typeof ProspectusAtAGlanceResponse>;
