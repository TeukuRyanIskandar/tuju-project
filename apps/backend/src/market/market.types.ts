/**
 * Market-overview wire shapes (spec 05, tickets 04 + 05).
 *
 * Covers:
 *  - `GET /market/movers` — the movers panel (gainers, losers, actives)
 *  - `GET /market/indices` — the headline + sector index panel
 *  - `GET /market/indices/:id/series` — the chartable `IndexLevel` history
 *  - `GET /market/sectors` — the sector-performance board
 *
 * Every data-bearing shape carries `provenance` read from its source-row
 * lineage join (`row.ingestionRunId → IngestionRun.provenanceClass`) so the
 * frontend can render the "illustrative data" label wherever a block is
 * `synthetic` (spec 05 illustrative-labelling posture).
 */

import type { MarketIndexKind, ProvenanceClass } from '../data/entities/enums';
import type { MoversBoardType } from '../ingestion/intraday-model';
import type { IndexSeriesRange } from './index-params';

// ─── Movers ──────────────────────────────────────────────────────────────────

/** One row on a movers board. */
export interface MoverRow {
  provenance: ProvenanceClass;
  stockCode: string;
  shortName: string;
  /** Live tick price (or latest EOD close), numeric(18,6) scale string. */
  price: string;
  /** (price − prevClose) / prevClose × 100; null when prevClose = 0. */
  pctChange: number | null;
  /** Cumulative intraday volume (during hours) or last daily volume (outside). */
  volume: number;
}

/** `GET /market/movers` response. */
export interface MoversResponse {
  /** The resolved board type (echoed — unknown input → default). */
  type: MoversBoardType;
  /** The resolved row limit (echoed — clamped). */
  limit: number;
  rows: MoverRow[];
}

// ─── Indices ─────────────────────────────────────────────────────────────────

/** One index entry in the panel (`/market/indices`). */
export interface IndexEntry {
  /** `MarketIndex.id` — the UUID the series endpoint uses. */
  id: string;
  kind: MarketIndexKind;
  name: string;
  /** `Sector.name`; null on the headline index. */
  sectorName: string | null;
  /** Current level (live during hours; latest stored otherwise). */
  level: string;
  pctChange: number | null;
  provenance: ProvenanceClass;
}

/** `GET /market/indices` response. */
export interface IndicesResponse {
  indices: IndexEntry[];
}

// ─── Index series ─────────────────────────────────────────────────────────────

/** One data point in the stored `IndexLevel` history. */
export interface IndexSeriesPoint {
  /** Trading day `YYYY-MM-DD`. */
  levelDate: string;
  /** The index level (numeric string, same scale as the entity). */
  level: string;
}

/** `GET /market/indices/:id/series` response. */
export interface IndexSeriesResponse {
  /** The `MarketIndex.id` this series belongs to. */
  id: string;
  name: string;
  /** The resolved range (echoed — unknown → default `'1y'`). */
  range: IndexSeriesRange;
  points: IndexSeriesPoint[];
  provenance: ProvenanceClass;
}

// ─── Sectors ─────────────────────────────────────────────────────────────────

/** One sector entry on the sector-performance board. */
export interface SectorEntry {
  /** The `MarketIndex.id` of the sector's index (for linking to the series). */
  indexId: string;
  sectorName: string;
  /** Current level (live during hours; latest stored otherwise). */
  level: string;
  pctChange: number | null;
  provenance: ProvenanceClass;
}

/** `GET /market/sectors` response. */
export interface SectorsResponse {
  sectors: SectorEntry[];
}
