/**
 * Postgres implementation of the {@link ScreenerQuery} seam (spec 03; ticket 01).
 *
 * One plain, parameterised SQL statement over the already-ingested spec-01
 * model — the spec's "single read model" decision, no window functions:
 *
 *   Instrument ⋈ Company ⋈ Sector ⋈ FundamentalsSnapshot (one current row
 *   per company) ⋈ IndicatorSnapshot (one current row per instrument) ⋈
 *   latest ShariahStatus (max-effectiveDate lateral) ⋈ latest two PriceBars
 *   (lateral; close/volume + previous close for the read-time %change — the
 *   spec-02 stock-page precedent).
 *
 * Ratios are READ from the materialised `FundamentalsSnapshot` columns, never
 * computed here. The two spec-03 filter fields the spec-01 materialiser does
 * not write — `yoyProfitGrowth` and `profitableYears` — are query-time
 * aggregations over `QuarterlyFinancials` (effort-map decision, resolving the
 * spec-03 gap): a YoY self-join on (company, fiscal year − 1, fiscal quarter)
 * for the latest quarter, and an array trick (leading run of positive yearly
 * sums, ordered desc) for the consecutive-trailing-years count — ~12k rows at
 * demo scale, trivially cheap.
 *
 * NULL semantics do the spec's work for free (spec 03 "Null-ratio handling"):
 * a loss-maker's NULL P/E (and any NULL ratio) never satisfies a `>=`/`<=`
 * band; NULLs sort LAST regardless of direction; the discrete booleans use
 * `(close > sma) IS TRUE/FALSE` so a NULL close/SMA matches neither value.
 * `stockCode` — the unique natural key — is the deterministic sort tiebreaker.
 *
 * Universe: the analysed universe (ordinary shares of MAIN/ACE companies),
 * the spec-02 search precedent — LEAP rows never reach a screen.
 */

import { Injectable } from '@nestjs/common';
// Value import (not `import type`): the constructor's DI metadata needs the
// DataSource class at runtime — ticket 02 wires this class into the module.
import { DataSource } from 'typeorm';
import {
  ListingBoard,
  ShariahComplianceStatus,
} from '../data/entities/enums';
import type { ProvenanceClass } from '../data/entities/enums';
import type {
  ScreenerFilters,
  ScreenerPage,
  ScreenerQuery,
  ScreenerQueryParams,
  ScreenerRow,
  ScreenerSectorOption,
  ScreenerSortKey,
} from './screener-query.interface';

/** Market cap expression — a WHERE clause cannot reference the select alias. */
const MARKET_CAP_SQL = '(latest_bar.close * fs.shares_outstanding)';

/** The %change expression (one bar → NULL; previous close 0 → NULL). */
const PCT_CHANGE_SQL =
  '((latest_bar.close - prev_bar.close) / NULLIF(prev_bar.close, 0) * 100)';

/** Sort key → the ORDER BY expression (output aliases are valid there). */
const SORT_SQL: Record<ScreenerSortKey, string> = {
  close: 'close',
  pctChange: 'pct_change',
  marketCap: 'market_cap',
  pe: 'pe',
  dy: 'dy',
  pNta: 'pnta',
  roe: 'roe',
  de: 'de',
};

/** Raw row shape returned by the page query (Postgres numerics as strings). */
interface RawScreenerRow {
  stock_code: string;
  short_name: string;
  sector_name: string;
  close: string | null;
  pct_change: string | null;
  market_cap: string | null;
  pe: string | null;
  dy: string | null;
  pnta: string | null;
  roe: string | null;
  de: string | null;
  price_provenance: ProvenanceClass | null;
  fundamentals_provenance: ProvenanceClass | null;
  technicals_provenance: ProvenanceClass | null;
}

/**
 * The select list for the page query (the count query shares only the FROM
 * model below). The three provenance columns are read-time `IngestionRun`
 * lineage joins — one per numeric class (bar / fundamentals / indicators).
 */
const PAGE_SELECT_SQL = `
  SELECT i.stock_code AS stock_code,
         i.short_name AS short_name,
         sec.name AS sector_name,
         latest_bar.close AS close,
         ${PCT_CHANGE_SQL} AS pct_change,
         ${MARKET_CAP_SQL} AS market_cap,
         fs.pe_ratio AS pe,
         fs.dividend_yield AS dy,
         fs.pnta_ratio AS pnta,
         fs.roe AS roe,
         fs.debt_to_equity AS de,
         r_bar.provenance_class AS price_provenance,
         r_fs.provenance_class AS fundamentals_provenance,
         r_ind.provenance_class AS technicals_provenance`;

/**
 * The single read model (FROM + universe restriction) shared by the page and
 * count queries. Latest derived rows arrive as one-current-row tables
 * (`fs`, `ind`) or max-effectiveDate / latest-date laterals (`shariah`,
 * `latest_bar`, `prev_bar`, `yoy`, `py`).
 */
const READ_MODEL_SQL = `
  FROM instruments i
  JOIN companies c ON c.id = i.company_id
  JOIN sectors sec ON sec.id = c.sector_id
  LEFT JOIN fundamentals_snapshots fs ON fs.company_id = c.id
  LEFT JOIN indicator_snapshots ind ON ind.instrument_id = i.id
  LEFT JOIN ingestion_runs r_fs ON r_fs.id = fs.ingestion_run_id
  LEFT JOIN ingestion_runs r_ind ON r_ind.id = ind.ingestion_run_id
  LEFT JOIN LATERAL (
    SELECT pb.close, pb.volume, pb.ingestion_run_id
    FROM price_bars pb
    WHERE pb.instrument_id = i.id
    ORDER BY pb.trade_date DESC
    LIMIT 1
  ) latest_bar ON true
  LEFT JOIN ingestion_runs r_bar ON r_bar.id = latest_bar.ingestion_run_id
  LEFT JOIN LATERAL (
    SELECT pb.close
    FROM price_bars pb
    WHERE pb.instrument_id = i.id
    ORDER BY pb.trade_date DESC
    OFFSET 1 LIMIT 1
  ) prev_bar ON true
  LEFT JOIN LATERAL (
    SELECT ss.status
    FROM shariah_statuses ss
    WHERE ss.company_id = c.id
    ORDER BY ss.effective_date DESC
    LIMIT 1
  ) shariah ON true
  LEFT JOIN LATERAL (
    SELECT (cur.net_profit - prior.net_profit)
             / NULLIF(ABS(prior.net_profit), 0) AS growth
    FROM quarterly_financials cur
    LEFT JOIN quarterly_financials prior
      ON prior.company_id = cur.company_id
     AND prior.fiscal_year = cur.fiscal_year - 1
     AND prior.fiscal_quarter = cur.fiscal_quarter
    WHERE cur.company_id = c.id
    ORDER BY cur.period_end DESC
    LIMIT 1
  ) yoy ON true
  LEFT JOIN LATERAL (
    SELECT CASE
             WHEN flags IS NULL THEN 0
             WHEN TRUE = ALL(flags) THEN cardinality(flags)
             ELSE array_position(flags, FALSE) - 1
           END AS profitable_years
    FROM (
      SELECT array_agg(profitable_year ORDER BY fiscal_year DESC) AS flags
      FROM (
        SELECT qf.fiscal_year, SUM(qf.net_profit) > 0 AS profitable_year
        FROM quarterly_financials qf
        WHERE qf.company_id = c.id
        GROUP BY qf.fiscal_year
      ) yearly
    ) flagged
  ) py ON true
  WHERE c.board IN ('MAIN', 'ACE')`;

@Injectable()
export class PgScreenerQuery implements ScreenerQuery {
  constructor(private readonly dataSource: DataSource) {}

  async screen(params: ScreenerQueryParams): Promise<ScreenerPage> {
    const { whereSql, values } = buildWhere(params.filters);
    const direction = params.dir === 'asc' ? 'ASC' : 'DESC';
    const rows = (await this.dataSource.query(
      `${PAGE_SELECT_SQL}
       ${READ_MODEL_SQL}
       ${whereSql}
       ORDER BY ${SORT_SQL[params.sort]} ${direction} NULLS LAST, i.stock_code ASC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, params.limit, params.offset],
    )) as RawScreenerRow[];

    const totals = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS total ${READ_MODEL_SQL} ${whereSql}`,
      values,
    )) as { total: number }[];

    return {
      items: rows.map(toRow),
      total: totals[0]?.total ?? 0,
      offset: params.offset,
      limit: params.limit,
    };
  }

  /**
   * The sector enum domain (ticket 03): a plain ordered read over the
   * `Sector` reference table — every sector, whether or not any analysed
   * company currently FKs to it (the domain is the classification, not the
   * populated universe).
   */
  async sectors(): Promise<ScreenerSectorOption[]> {
    return (await this.dataSource.query(
      'SELECT id, name FROM sectors ORDER BY name ASC',
    )) as ScreenerSectorOption[];
  }
}

/**
 * Build the AND-combined filter WHERE fragment with positional parameters.
 * Every absent filter imposes no constraint; the universe board restriction
 * already lives in the read model, so a board filter only narrows further.
 */
function buildWhere(filters: ScreenerFilters): {
  whereSql: string;
  values: unknown[];
} {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const param = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const band = (sql: string, min: number | null, max: number | null) => {
    if (min !== null) clauses.push(`${sql} >= ${param(min)}`);
    if (max !== null) clauses.push(`${sql} <= ${param(max)}`);
  };

  if (filters.boards.length > 0) {
    clauses.push(`c.board::text = ANY(${param([...filters.boards])}::text[])`);
  }
  if (filters.sectorIds.length > 0) {
    clauses.push(`sec.id = ANY(${param([...filters.sectorIds])}::uuid[])`);
  }
  if (filters.shariah !== null) {
    clauses.push(
      `shariah.status = ${param(
        filters.shariah
          ? ShariahComplianceStatus.Compliant
          : ShariahComplianceStatus.NonCompliant,
      )}`,
    );
  }
  band('latest_bar.close', filters.priceMin, filters.priceMax);
  if (filters.volumeMin !== null) {
    clauses.push(`latest_bar.volume >= ${param(filters.volumeMin)}`);
  }
  band(MARKET_CAP_SQL, filters.marketCapMin, filters.marketCapMax);
  band('fs.pe_ratio', filters.peMin, filters.peMax);
  band('fs.dividend_yield', filters.dyMin, filters.dyMax);
  band('fs.pnta_ratio', filters.pNtaMin, filters.pNtaMax);
  band('fs.roe', filters.roeMin, filters.roeMax);
  band('fs.debt_to_equity', filters.deMin, filters.deMax);
  if (filters.profitableYearsMin !== null) {
    clauses.push(`py.profitable_years >= ${param(filters.profitableYearsMin)}`);
  }
  if (filters.yoyProfitGrowthMin !== null) {
    clauses.push(`yoy.growth >= ${param(filters.yoyProfitGrowthMin)}`);
  }
  if (filters.consecutiveGrowthQuartersMin !== null) {
    clauses.push(
      `fs.consecutive_growth_quarters >= ${param(filters.consecutiveGrowthQuartersMin)}`,
    );
  }
  band('ind.rsi_14', filters.rsi14Min, filters.rsi14Max);
  if (filters.aboveSma50 !== null) {
    clauses.push(
      `(latest_bar.close > ind.sma_50) IS ${filters.aboveSma50 ? 'TRUE' : 'FALSE'}`,
    );
  }
  if (filters.aboveSma200 !== null) {
    clauses.push(
      `(latest_bar.close > ind.sma_200) IS ${filters.aboveSma200 ? 'TRUE' : 'FALSE'}`,
    );
  }

  return {
    whereSql: clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '',
    values,
  };
}

/** Map a raw row onto the endpoint's ScreenerRow (numerics → number | null). */
function toRow(raw: RawScreenerRow): ScreenerRow {
  return {
    stockCode: raw.stock_code,
    shortName: raw.short_name,
    sector: raw.sector_name,
    close: toNumber(raw.close),
    pctChange: toNumber(raw.pct_change),
    marketCap: toNumber(raw.market_cap),
    pe: toNumber(raw.pe),
    dy: toNumber(raw.dy),
    pNta: toNumber(raw.pnta),
    roe: toNumber(raw.roe),
    de: toNumber(raw.de),
    provenance: {
      price: raw.price_provenance,
      fundamentals: raw.fundamentals_provenance,
      technicals: raw.technicals_provenance,
    },
  };
}

/** A Postgres numeric string → number; NULL/undefined → null (never NaN). */
function toNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
