import { z } from 'zod';
import { ListingBoard, ProvenanceClass } from './common.js';

/** `GET /screener` and `GET /screener/fields` (spec 03). */

/** Sortable columns — exactly the result row's numeric columns. */
export const ScreenerSortKey = z.enum([
  'close',
  'pctChange',
  'marketCap',
  'pe',
  'dy',
  'pNta',
  'roe',
  'de',
]);
export type ScreenerSortKey = z.infer<typeof ScreenerSortKey>;

export const SortDirection = z.enum(['asc', 'desc']);
export type SortDirection = z.infer<typeof SortDirection>;

/** Per-numeric-class provenance; `null` = that class's source row is absent. */
export const ScreenerProvenance = z.strictObject({
  price: ProvenanceClass.nullable(),
  fundamentals: ProvenanceClass.nullable(),
  technicals: ProvenanceClass.nullable(),
});
export type ScreenerProvenance = z.infer<typeof ScreenerProvenance>;

export const ScreenerRow = z.strictObject({
  stockCode: z.string(),
  shortName: z.string(),
  sector: z.string(),
  close: z.number().nullable(),
  pctChange: z.number().nullable(),
  marketCap: z.number().nullable(),
  pe: z.number().nullable(),
  dy: z.number().nullable(),
  pNta: z.number().nullable(),
  roe: z.number().nullable(),
  de: z.number().nullable(),
  provenance: ScreenerProvenance,
});
export type ScreenerRow = z.infer<typeof ScreenerRow>;

/** `GET /screener` — one result page plus the echoed resolved sort. */
export const ScreenerResponse = z.strictObject({
  items: z.array(ScreenerRow),
  total: z.number().int().min(0),
  offset: z.number().int().min(0),
  limit: z.number().int().min(0),
  sort: ScreenerSortKey,
  dir: SortDirection,
});
export type ScreenerResponse = z.infer<typeof ScreenerResponse>;

/**
 * One advertised screener filter, discriminated on `kind`. `param`/`minParam`/
 * `maxParam` name raw `GET /screener` query params.
 */
export const ScreenerFilterField = z.discriminatedUnion('kind', [
  z.strictObject({
    name: z.string(),
    kind: z.literal('enum'),
    param: z.string(),
    /** Which `/screener/fields` response member carries this filter's values. */
    domain: z.enum(['boards', 'sectors']),
  }),
  z.strictObject({
    name: z.string(),
    kind: z.literal('boolean'),
    param: z.string(),
  }),
  z.strictObject({
    name: z.string(),
    kind: z.literal('numericBand'),
    minParam: z.string(),
    /** `null` when the filter is floor-only (e.g. `volume`). */
    maxParam: z.string().nullable(),
  }),
]);
export type ScreenerFilterField = z.infer<typeof ScreenerFilterField>;

/** One entry of the `sector` filter's value domain; `id` is what `?sector=` takes. */
export const ScreenerSectorOption = z.strictObject({
  id: z.string(),
  name: z.string(),
});
export type ScreenerSectorOption = z.infer<typeof ScreenerSectorOption>;

/** `GET /screener/fields` — the filter vocabulary plus the enum domains. */
export const ScreenerFieldsResponse = z.strictObject({
  filters: z.array(ScreenerFilterField),
  boards: z.array(ListingBoard),
  sectors: z.array(ScreenerSectorOption),
});
export type ScreenerFieldsResponse = z.infer<typeof ScreenerFieldsResponse>;
