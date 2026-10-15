import type {
  StockFundamentalAnalysisResponse,
  StockTechnicalAnalysisResponse,
} from '@tuju/contracts';
import type { StockAnalysisKind } from '../cache';
import { StockAnalysisStatus } from '../data/entities/enums';
import type { FundamentalAnalysis } from '../data/entities/fundamental-analysis.entity';
import type { TechnicalAnalysis } from '../data/entities/technical-analysis.entity';
import type { StockAnalysisJob } from '../jobbus/job-identities';
import { JobNames } from '../jobbus/job-names';

/**
 * Pure mapping for the stock-analysis read side (internal to the
 * `StockAnalysis` module): row → thin HTTP envelope, read-time stale
 * promotion, cost stripping. The module's tests exercise these through
 * `StockAnalysis.status` / `artifact`.
 */

/** The thin envelope for one kind (`GET /stocks/:code/analysis/{kind}`). */
export type StockAnalysisEnvelope<K extends StockAnalysisKind = StockAnalysisKind> =
  K extends 'technical'
    ? StockTechnicalAnalysisResponse
    : StockFundamentalAnalysisResponse;

type StockAnalysisRow = TechnicalAnalysis | FundamentalAnalysis;

export function jobNameOf(kind: StockAnalysisKind): StockAnalysisJob {
  return kind === 'technical' ? JobNames.technical : JobNames.fundamental;
}

export function kindOf(jobName: StockAnalysisJob): StockAnalysisKind {
  return jobName === JobNames.technical ? 'technical' : 'fundamental';
}

/**
 * The envelope as stored, before stale promotion. `row === null` ⇒ pending
 * (never enqueued).
 */
export function toEnvelope<K extends StockAnalysisKind>(
  code: string,
  kind: K,
  row: StockAnalysisRow | null,
): StockAnalysisEnvelope<K> {
  const pointer =
    row?.artifactBucket && row.artifactKey
      ? { bucket: row.artifactBucket, key: row.artifactKey }
      : null;
  return {
    code,
    status: row?.status ?? StockAnalysisStatus.Pending,
    headline: row?.headline ?? null,
    asOf: row?.asOf ? row.asOf.toISOString() : null,
    artifact: pointer,
    artifactPath: pointer ? `/stocks/${code}/analysis/${kind}/artifact` : null,
    errorMessage: row?.errorMessage ?? null,
    jobName: jobNameOf(kind),
  } as StockAnalysisEnvelope<K>;
}

/** Only a landed result (`ready` / `facts_only`) with an `asOf` can go stale. */
export function canGoStale(envelope: StockAnalysisEnvelope): boolean {
  return (
    (envelope.status === StockAnalysisStatus.Ready ||
      envelope.status === StockAnalysisStatus.FactsOnly) &&
    envelope.asOf !== null
  );
}

/**
 * Promote a landed `ready` / `facts_only` envelope to `stale` when its `asOf`
 * calendar day is behind the instrument's latest EOD close day (on read,
 * never written back to the row).
 */
export function promoteStale<E extends StockAnalysisEnvelope>(
  envelope: E,
  latestEodCloseDay: string | null,
): E {
  if (
    canGoStale(envelope) &&
    latestEodCloseDay !== null &&
    (envelope.asOf as string).slice(0, 10) < latestEodCloseDay
  ) {
    return { ...envelope, status: StockAnalysisStatus.Stale };
  }
  return envelope;
}

/** Strip internal billing fields before returning proxied artifact JSON. */
export function omitArtifactCost<T extends Record<string, unknown>>(
  body: T,
): Omit<T, 'cost'> {
  const { cost: _cost, ...rest } = body;
  return rest;
}
