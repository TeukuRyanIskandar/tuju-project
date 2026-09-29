import type { JobName } from '@tuju/contracts';

/**
 * Authorization policy (ADR-0005) — the two durable invariants:
 *   1. All authorization flows through ONE central seam (the job-enqueue boundary).
 *   2. Call sites ask capability questions, NEVER tier names.
 *
 * Today's implementation of `can()` is a single central tier → allowed-job-types
 * map. More tiers later = a map edit. Per-user grants later = swap this lookup for
 * an entitlements lookup behind the same `can()` — call sites unchanged.
 */

/** Ordinal tier field on the user (ADR-0005). `premium` reserved for Product C. */
export type Tier = 'free' | 'pro' | 'premium';

/**
 * The single source of truth: tier → the job types that tier may enqueue.
 * `free` gets the dashboard only (no jobs); `pro` gets TA/FA; `premium` is
 * reserved for Product C (adds deep analysis job types additively).
 */
const TIER_ALLOWED_JOBS: Record<Tier, readonly JobName[]> = {
  free: [],
  pro: ['analyze-technical', 'analyze-fundamental'],
  premium: ['analyze-technical', 'analyze-fundamental'],
};

/**
 * The capability check. Call sites ask `can(user, jobName)` — never
 * `if (tier === 'pro')`. This is the single `can(user, action)`-shaped seam.
 */
export function can(
  user: { tier: Tier } | undefined,
  jobName: JobName,
): boolean {
  if (!user) return false;
  return TIER_ALLOWED_JOBS[user.tier]?.includes(jobName) ?? false;
}

export { TIER_ALLOWED_JOBS };
