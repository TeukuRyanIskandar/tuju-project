import { z } from 'zod';
import { IsoDateTime, Page, provenanceShape } from './common.js';

/**
 * `GET /news` — headline + link only, no body. `matchedAlias` is present on the
 * company feed and omitted on the untagged market feed.
 */
export const NewsItem = z.strictObject({
  ...provenanceShape,
  headline: z.string(),
  url: z.string(),
  source: z.string(),
  publishedAt: IsoDateTime,
  matchedAlias: z.string().optional(),
});
export type NewsItem = z.infer<typeof NewsItem>;

export const NewsPage = Page(NewsItem);
export type NewsPage = z.infer<typeof NewsPage>;
