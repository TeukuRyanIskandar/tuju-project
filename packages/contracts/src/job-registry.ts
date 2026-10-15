import {
  AnnouncementSummaryPhase,
  FundamentalPhase,
  type JobName,
  MarketBriefPhase,
  type Phase,
  ProspectusPhase,
  TechnicalPhase,
} from './enums.js';
import { SCHEMA_VERSIONS, type SchemaVersion } from './schema-versions.js';

/**
 * Job registry — per-`JobName` metadata both worlds used to hand-mirror
 * (architecture-deepening ticket 07). Metadata only: no envelope/result/artifact
 * shape lives here (ADR-0007, ADR-0014 hold unchanged).
 *
 * Generated into Python as `contracts_generated/job_registry.py` by
 * scripts/generate.mjs and covered by the drift gate (ADR-0008).
 *
 * - `phases`: the job type's fixed, ordered progress phases (ADR-0007 §4).
 * - `resultIdPrefix`: the colon-form prefix of the worker's `JobResult.jobId`
 *   (ADR-0007 §2), e.g. `prospectus:{id}`. The BullMQ custom id is a separate,
 *   BullMQ-legal hyphen form owned by each job family — not registered here.
 * - `schemaVersion`: the `schemaVersion` of the claim-checked artifact.
 */

// --- §1 The one queue every job rides (ADR-0003) ----------------------------
export const ANALYSIS_QUEUE = 'analysis';
export type JobQueue = typeof ANALYSIS_QUEUE;

export interface JobSpec {
  readonly name: JobName;
  readonly queue: JobQueue;
  readonly phases: readonly Phase[];
  readonly resultIdPrefix: string;
  readonly schemaVersion: SchemaVersion;
}

export const JOBS = {
  'analyze-technical': {
    name: 'analyze-technical',
    queue: ANALYSIS_QUEUE,
    phases: TechnicalPhase.options,
    resultIdPrefix: 'technical:',
    schemaVersion: SCHEMA_VERSIONS.technical,
  },
  'analyze-fundamental': {
    name: 'analyze-fundamental',
    queue: ANALYSIS_QUEUE,
    phases: FundamentalPhase.options,
    resultIdPrefix: 'fundamental:',
    schemaVersion: SCHEMA_VERSIONS.fundamental,
  },
  'generate-market-brief': {
    name: 'generate-market-brief',
    queue: ANALYSIS_QUEUE,
    phases: MarketBriefPhase.options,
    resultIdPrefix: 'brief:',
    schemaVersion: SCHEMA_VERSIONS.brief,
  },
  'summarize-announcement': {
    name: 'summarize-announcement',
    queue: ANALYSIS_QUEUE,
    phases: AnnouncementSummaryPhase.options,
    resultIdPrefix: 'ann:',
    schemaVersion: SCHEMA_VERSIONS.announcementsummary,
  },
  'analyze-prospectus': {
    name: 'analyze-prospectus',
    queue: ANALYSIS_QUEUE,
    phases: ProspectusPhase.options,
    resultIdPrefix: 'prospectus:',
    schemaVersion: SCHEMA_VERSIONS.prospectus,
  },
} as const satisfies { readonly [N in JobName]: JobSpec & { readonly name: N } };

export type JobRegistry = typeof JOBS;
/** The worker's colon-form `JobResult.jobId` prefix for job `N`, as a literal type. */
export type ResultIdPrefix<N extends JobName> = JobRegistry[N]['resultIdPrefix'];
