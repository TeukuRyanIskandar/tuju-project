import { z } from 'zod';

/** `GET /search?q=&limit=` — identity rows only, no prices or fundamentals. */
export const SearchResultRow = z.strictObject({
  stockCode: z.string(),
  shortName: z.string(),
  fullName: z.string(),
  companyName: z.string(),
  /** `MAIN` / `ACE` (LEAP is outside the analysed universe). */
  board: z.string(),
  sectorName: z.string(),
});
export type SearchResultRow = z.infer<typeof SearchResultRow>;

export const SearchResponse = z.strictObject({
  /** Echo of the normalised query. */
  query: z.string(),
  items: z.array(SearchResultRow),
});
export type SearchResponse = z.infer<typeof SearchResponse>;
