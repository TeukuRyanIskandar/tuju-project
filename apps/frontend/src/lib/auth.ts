import type { JobName } from '@tuju/contracts'
import { apiFetch } from './api'

/**
 * Auth surface (ADR-0005).
 *
 * The backend (NestJS) is the identity + session authority. It sets an httpOnly,
 * Secure, SameSite session cookie the browser can't read from JS; this module
 * only asks the backend "who am I?" via `/me` (cookie sent automatically by
 * `apiFetch`).
 *
 * `tier` is used on the FE for SHOW/HIDE ONLY — presentation. The backend always
 * re-checks capability at the job-enqueue seam; the FE never enforces. Call sites
 * should ask capability questions (`canRunJob`), never compare tier names, to
 * mirror the backend's capability-shaped `can()` seam.
 */

/** Ordinal subscription tier (ADR-0005 data model). `premium` reserved for Product C. */
export type Tier = 'free' | 'pro' | 'premium'

export interface SessionUser {
  id: string
  email: string
  tier: Tier
}

/**
 * FE mirror of the backend tier → allowed-job map (ADR-0005). Presentation only:
 * decides what paywalled UI to show. Kept as a capability lookup, not scattered
 * `tier === 'pro'` checks. The backend map is the source of truth.
 */
const TIER_JOBS: Record<Tier, ReadonlyArray<JobName>> = {
  free: [],
  pro: ['analyze-technical', 'analyze-fundamental'],
  premium: ['analyze-technical', 'analyze-fundamental'],
}

/** Show/hide helper — "does this user's tier expose this job type?" (presentation only). */
export function canRunJob(user: SessionUser | null, job: JobName): boolean {
  if (!user) return false
  return TIER_JOBS[user.tier].includes(job)
}

/** Fetch the current session user from the backend, or null if unauthenticated. */
export async function fetchSession(): Promise<SessionUser | null> {
  const res = await apiFetch('/me')
  if (res.status === 401 || res.status === 403) return null
  if (!res.ok) throw new Error(`Session lookup failed: ${res.status}`)
  return (await res.json()) as SessionUser
}
