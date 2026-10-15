import type { JobEnvelope, JobName, ResultIdPrefix } from '@tuju/contracts';
import type { JobIdentity, JobRef } from './job-family';
import { JobNames } from './job-names';

/**
 * Every job family's identity, in one place (architecture-deepening ticket 01).
 * See `job-family.ts` for the two-id rule. The result-id prefixes are typed by
 * the contract's job registry (`JOBS[n].resultIdPrefix`, which the Python
 * worker's prefixes are generated from), so drift is a build error. Type-only:
 * the contract is ESM, the backend CommonJS.
 */

const TECHNICAL_RESULT_PREFIX: ResultIdPrefix<'analyze-technical'> = 'technical:';
const FUNDAMENTAL_RESULT_PREFIX: ResultIdPrefix<'analyze-fundamental'> = 'fundamental:';
const BRIEF_RESULT_PREFIX: ResultIdPrefix<'generate-market-brief'> = 'brief:';
const ANNOUNCEMENT_RESULT_PREFIX: ResultIdPrefix<'summarize-announcement'> = 'ann:';
const PROSPECTUS_RESULT_PREFIX: ResultIdPrefix<'analyze-prospectus'> = 'prospectus:';

function payloadField(env: JobEnvelope<unknown>, field: string): string | undefined {
  const value = (env.payload as Record<string, unknown> | undefined)?.[field];
  return value === undefined || value === null ? undefined : String(value);
}

/** UTC bucket of `asOf`, matching the worker's `astimezone(utc).strftime(...)`. */
function utcBucket(asOf: string, length: 10 | 13): string {
  return new Date(asOf).toISOString().slice(0, length);
}

/** `prefix + rest`, with `rest` non-empty; `null` otherwise. */
function afterPrefix(id: string, prefix: string): string | null {
  if (!id.startsWith(prefix)) return null;
  const rest = id.slice(prefix.length);
  return rest.length > 0 ? rest : null;
}

// --- Stock analysis (TA + FA, one parameterised family) ---------------------

export type StockAnalysisJob =
  | typeof JobNames.technical
  | typeof JobNames.fundamental;

export interface StockAnalysisKey {
  stockCode: string;
  /** TA: the timeframe (`1D`); FA: the period (`quarterly`). */
  discriminator: string;
  /** UTC hour bucket of `asOf`, e.g. `2026-10-08T18`. */
  hourBucket: string;
}

const STOCK_ANALYSIS_IDS: Record<
  StockAnalysisJob,
  { bullPrefix: string; resultPrefix: string; discriminatorField: string }
> = {
  [JobNames.technical]: {
    bullPrefix: 'ta',
    resultPrefix: TECHNICAL_RESULT_PREFIX,
    discriminatorField: 'timeframe',
  },
  [JobNames.fundamental]: {
    bullPrefix: 'fa',
    resultPrefix: FUNDAMENTAL_RESULT_PREFIX,
    discriminatorField: 'period',
  },
};

/**
 * Content-derived and hour-bucketed (ADR-0007 §2): a user click and a system
 * trigger for the same stock in the same hour collapse to one job.
 * BullMQ id `ta-1155-1D-2026-10-08T18`; result id `technical:1155:1D:2026-10-08T18`.
 */
export const stockAnalysisIdentity: JobIdentity<StockAnalysisJob, StockAnalysisKey> = {
  jobNames: [JobNames.technical, JobNames.fundamental],
  key: (jobName, env) => ({
    stockCode: payloadField(env, 'symbol') ?? 'unknown',
    discriminator:
      payloadField(env, STOCK_ANALYSIS_IDS[jobName].discriminatorField) ?? 'default',
    hourBucket: utcBucket(env.asOf, 13),
  }),
  bullId: (jobName, k) =>
    [STOCK_ANALYSIS_IDS[jobName].bullPrefix, k.stockCode, k.discriminator, k.hourBucket].join('-'),
  resultId: (jobName, k) =>
    `${STOCK_ANALYSIS_IDS[jobName].resultPrefix}${[k.stockCode, k.discriminator, k.hourBucket].join(':')}`,
  parseResultId: (resultId) => {
    for (const jobName of [JobNames.technical, JobNames.fundamental] as const) {
      const rest = afterPrefix(resultId, STOCK_ANALYSIS_IDS[jobName].resultPrefix);
      if (rest === null) continue;
      const match = /^([^:]+):([^:]+):([^:]+)$/.exec(rest);
      if (!match) return null;
      return {
        jobName,
        key: { stockCode: match[1], discriminator: match[2], hourBucket: match[3] },
      };
    }
    return null;
  },
};

// --- Single-key families -----------------------------------------------------

/** A family whose domain key is one string: `{bullWord}-{key}` / `{prefix}{key}`. */
function singleKeyIdentity<N extends JobName>(
  jobName: N,
  bullWord: string,
  resultPrefix: string,
  key: (env: JobEnvelope<unknown>) => string,
): JobIdentity<N, string> {
  return {
    jobNames: [jobName],
    key: (_jobName, env) => key(env),
    bullId: (_jobName, k) => `${bullWord}-${k}`,
    resultId: (_jobName, k) => `${resultPrefix}${k}`,
    parseResultId: (resultId) => {
      const k = afterPrefix(resultId, resultPrefix);
      return k === null ? null : { jobName, key: k };
    },
  };
}

/**
 * Date-bucketed, not hour-bucketed: re-enqueuing the same day collapses to the
 * existing job. Key = UTC brief date. `brief-2026-09-29` / `brief:2026-09-29`.
 */
export const marketBriefIdentity = singleKeyIdentity(
  JobNames.marketBrief,
  'brief',
  BRIEF_RESULT_PREFIX,
  (env) => utcBucket(env.asOf, 10),
);

/**
 * One job per announcement, independent of asOf: a re-summarize overwrites the
 * same row. Key = announcement id. `ann-{id}` / `ann:{id}`.
 */
export const announcementSummaryIdentity = singleKeyIdentity(
  JobNames.announcementSummary,
  'ann',
  ANNOUNCEMENT_RESULT_PREFIX,
  (env) => payloadField(env, 'announcementId') ?? 'unknown',
);

/**
 * One job per prospectus, independent of asOf: a re-run of the same curated
 * IPO overwrites the same thin row. Key = `IpoListing.id`.
 * `prospectus-{id}` / `prospectus:{id}`.
 */
export const prospectusIdentity = singleKeyIdentity(
  JobNames.prospectus,
  'prospectus',
  PROSPECTUS_RESULT_PREFIX,
  (env) => payloadField(env, 'prospectusId') ?? 'unknown',
);

// --- The table ----------------------------------------------------------------

/** Exhaustive over `JobName`: adding a job without an identity fails tsc. */
export const JOB_IDENTITIES: { readonly [N in JobName]: JobIdentity<N, unknown> } = {
  [JobNames.technical]: stockAnalysisIdentity as JobIdentity<'analyze-technical', unknown>,
  [JobNames.fundamental]: stockAnalysisIdentity as JobIdentity<'analyze-fundamental', unknown>,
  [JobNames.marketBrief]: marketBriefIdentity,
  [JobNames.announcementSummary]: announcementSummaryIdentity,
  [JobNames.prospectus]: prospectusIdentity,
};

const DISTINCT_IDENTITIES: readonly JobIdentity[] = [
  ...new Set<JobIdentity>(Object.values(JOB_IDENTITIES) as JobIdentity[]),
];

/** The BullMQ custom id for an envelope (hyphen form, BullMQ-legal). */
export function bullIdFor(jobName: JobName, env: JobEnvelope<unknown>): string {
  const identity = JOB_IDENTITIES[jobName] as JobIdentity;
  return identity.bullId(jobName, identity.key(jobName, env));
}

/** The `JobResult.jobId` the worker mints for an envelope (colon form). */
export function resultIdFor(jobName: JobName, env: JobEnvelope<unknown>): string {
  const identity = JOB_IDENTITIES[jobName] as JobIdentity;
  return identity.resultId(jobName, identity.key(jobName, env));
}

/** Which job (and domain key) a worker result id belongs to; `null` if none. */
export function resolveResultId(resultId: string): JobRef | null {
  for (const identity of DISTINCT_IDENTITIES) {
    const ref = identity.parseResultId(resultId);
    if (ref) return ref;
  }
  return null;
}
