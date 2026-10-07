import type { JobName } from '@tuju/contracts';

/**
 * BullMQ queue + job name constants (ADR-0007 §1).
 *
 * The `JobName` string-literal type is imported from `@tuju/contracts` (the single
 * source of truth, ADR-0002). We reference it as a *type* only — the contract
 * package is ESM and the backend is CommonJS, so importing runtime values would
 * cross the ESM/CJS boundary. The literal values below are checked against the
 * contract's `JobName` union by the compiler (`satisfies`), so any drift from the
 * contract is a build error, not a silent divergence.
 */
export const ANALYSIS_QUEUE = 'analysis';

export const JobNames = {
  technical: 'analyze-technical',
  fundamental: 'analyze-fundamental',
  // Spec-06 system-triggered showcase jobs (free-tier-ai-showcase, tickets 02/03).
  marketBrief: 'generate-market-brief',
  announcementSummary: 'summarize-announcement',
  // Spec-06 flagship (ticket 05): system-triggered by the `enqueue-prospectus` ops command.
  prospectus: 'analyze-prospectus',
} as const satisfies Record<string, JobName>;

/** The stub job used to prove the JobBus round-trips end-to-end (ADR-0001). */
export const STUB_JOB_NAME = JobNames.technical;
