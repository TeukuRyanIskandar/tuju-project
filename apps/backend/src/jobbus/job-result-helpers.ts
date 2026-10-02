import type { JobResult } from '@tuju/contracts';

/** Narrows `JobResult['summary']` to the verdict-bearing `Summary` variant. */
export function isVerdictSummary(
  summary: JobResult['summary'],
): summary is Extract<JobResult['summary'], { verdict: unknown }> {
  return 'verdict' in summary;
}
