import { z } from 'zod';
import { IsoDate, ProvenanceClass, provenanceShape } from './common.js';

/**
 * Market overview (spec 05): `GET /market/movers`, `/market/indices`,
 * `/market/indices/:id/series`, `/market/sectors`. Level and price values are
 * numeric strings (NUMERIC scale preserved); `pctChange` and `volume` are numbers.
 */

export const MoversBoardType = z.enum(['gainers', 'losers', 'actives']);
export type MoversBoardType = z.infer<typeof MoversBoardType>;

export const MarketIndexKind = z.enum(['headline', 'sector']);
export type MarketIndexKind = z.infer<typeof MarketIndexKind>;

export const IndexSeriesRange = z.enum(['1m', '3m', '6m', '1y', '3y', '5y', 'all']);
export type IndexSeriesRange = z.infer<typeof IndexSeriesRange>;

export const MoverRow = z.strictObject({
  ...provenanceShape,
  stockCode: z.string(),
  shortName: z.string(),
  price: z.string(),
  pctChange: z.number().nullable(),
  volume: z.number(),
});
export type MoverRow = z.infer<typeof MoverRow>;

/** `GET /market/movers` — the resolved board type and limit are echoed. */
export const MoversResponse = z.strictObject({
  type: MoversBoardType,
  limit: z.number().int().min(0),
  rows: z.array(MoverRow),
});
export type MoversResponse = z.infer<typeof MoversResponse>;

export const IndexEntry = z.strictObject({
  /** `MarketIndex.id` — the UUID the series endpoint takes. */
  id: z.string(),
  kind: MarketIndexKind,
  name: z.string(),
  /** Null on the headline index. */
  sectorName: z.string().nullable(),
  level: z.string(),
  pctChange: z.number().nullable(),
  provenance: ProvenanceClass,
});
export type IndexEntry = z.infer<typeof IndexEntry>;

export const IndicesResponse = z.strictObject({
  indices: z.array(IndexEntry),
});
export type IndicesResponse = z.infer<typeof IndicesResponse>;

export const IndexSeriesPoint = z.strictObject({
  levelDate: IsoDate,
  level: z.string(),
});
export type IndexSeriesPoint = z.infer<typeof IndexSeriesPoint>;

/** `GET /market/indices/:id/series` — the resolved range is echoed. */
export const IndexSeriesResponse = z.strictObject({
  id: z.string(),
  name: z.string(),
  range: IndexSeriesRange,
  points: z.array(IndexSeriesPoint),
  provenance: ProvenanceClass,
});
export type IndexSeriesResponse = z.infer<typeof IndexSeriesResponse>;

export const SectorEntry = z.strictObject({
  /** The `MarketIndex.id` of the sector's index (links to the series). */
  indexId: z.string(),
  sectorName: z.string(),
  level: z.string(),
  pctChange: z.number().nullable(),
  provenance: ProvenanceClass,
});
export type SectorEntry = z.infer<typeof SectorEntry>;

export const SectorsResponse = z.strictObject({
  sectors: z.array(SectorEntry),
});
export type SectorsResponse = z.infer<typeof SectorsResponse>;
