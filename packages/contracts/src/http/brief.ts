import { z } from 'zod';
import { IsoDate, IsoDateTime } from './common.js';

/** `GET /market-brief/latest` — headline plus the claim-check pointer. */
export const MarketBriefResponse = z.strictObject({
  briefDate: IsoDate,
  headline: z.string(),
  asOf: IsoDateTime,
  artifact: z.strictObject({ bucket: z.string(), key: z.string() }),
});
export type MarketBriefResponse = z.infer<typeof MarketBriefResponse>;
