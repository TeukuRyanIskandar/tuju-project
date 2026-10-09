import { StockAnalysisStatus } from '../data/entities/enums';
import type { FundamentalAnalysis } from '../data/entities/fundamental-analysis.entity';
import type { TechnicalAnalysis } from '../data/entities/technical-analysis.entity';
import type {
  StockFundamentalAnalysisResponse,
  StockTechnicalAnalysisResponse,
} from './stocks.types';

const SERIES_INTERVAL = '1d' as const;
const SERIES_RANGE = '2y' as const;
/** Calendar-day lookback for the PoC-fixed `range=2y` series window. */
export const STOCK_SERIES_RANGE_DAYS = 730;

export function isStockSeriesQuery(
  interval: string | undefined,
  range: string | undefined,
): boolean {
  const resolvedInterval = interval ?? SERIES_INTERVAL;
  const resolvedRange = range ?? SERIES_RANGE;
  return resolvedInterval === SERIES_INTERVAL && resolvedRange === SERIES_RANGE;
}

/** Calendar date (YYYY-MM-DD) of an analysis `as_of` timestamptz. */
export function asOfCalendarDate(asOf: Date): string {
  return asOf.toISOString().slice(0, 10);
}

/**
 * Promote prior `ready` / `facts_only` to `stale` when `as_of` is behind the
 * instrument's latest EOD close day (read-time only — never written back).
 */
export function promoteAnalysisStatus(
  status: StockAnalysisStatus,
  asOf: Date | null,
  latestEodCloseDay: string | null,
): StockAnalysisStatus {
  if (
    (status === StockAnalysisStatus.Ready ||
      status === StockAnalysisStatus.FactsOnly) &&
    asOf !== null &&
    latestEodCloseDay !== null &&
    asOfCalendarDate(asOf) < latestEodCloseDay
  ) {
    return StockAnalysisStatus.Stale;
  }
  return status;
}

/** Strip internal billing fields before returning proxied artifact JSON. */
export function omitArtifactCost<
  T extends Record<string, unknown>,
>(body: T): Omit<T, 'cost'> {
  const { cost: _cost, ...rest } = body;
  return rest;
}

type AnalysisRow = TechnicalAnalysis | FundamentalAnalysis;

function artifactPointer(
  row: AnalysisRow,
): { bucket: string; key: string } | null {
  if (row.artifactBucket && row.artifactKey) {
    return { bucket: row.artifactBucket, key: row.artifactKey };
  }
  return null;
}

function artifactPath(
  code: string,
  kind: 'technical' | 'fundamental',
  pointer: { bucket: string; key: string } | null,
): string | null {
  return pointer ? `/stocks/${code}/analysis/${kind}/artifact` : null;
}

export function pendingTechnicalAnalysis(
  code: string,
): StockTechnicalAnalysisResponse {
  return {
    code,
    status: StockAnalysisStatus.Pending,
    headline: null,
    asOf: null,
    artifact: null,
    artifactPath: null,
    errorMessage: null,
    jobName: 'analyze-technical',
  };
}

export function pendingFundamentalAnalysis(
  code: string,
): StockFundamentalAnalysisResponse {
  return {
    code,
    status: StockAnalysisStatus.Pending,
    headline: null,
    asOf: null,
    artifact: null,
    artifactPath: null,
    errorMessage: null,
    jobName: 'analyze-fundamental',
  };
}

export function toTechnicalAnalysisResponse(
  code: string,
  row: TechnicalAnalysis,
  latestEodCloseDay: string | null,
): StockTechnicalAnalysisResponse {
  const pointer = artifactPointer(row);
  return {
    code,
    status: promoteAnalysisStatus(row.status, row.asOf, latestEodCloseDay),
    headline: row.headline,
    asOf: row.asOf === null ? null : row.asOf.toISOString(),
    artifact: pointer,
    artifactPath: artifactPath(code, 'technical', pointer),
    errorMessage: row.errorMessage,
    jobName: 'analyze-technical',
  };
}

export function toFundamentalAnalysisResponse(
  code: string,
  row: FundamentalAnalysis,
  latestEodCloseDay: string | null,
): StockFundamentalAnalysisResponse {
  const pointer = artifactPointer(row);
  return {
    code,
    status: promoteAnalysisStatus(row.status, row.asOf, latestEodCloseDay),
    headline: row.headline,
    asOf: row.asOf === null ? null : row.asOf.toISOString(),
    artifact: pointer,
    artifactPath: artifactPath(code, 'fundamental', pointer),
    errorMessage: row.errorMessage,
    jobName: 'analyze-fundamental',
  };
}
