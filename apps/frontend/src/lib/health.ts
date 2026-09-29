import { apiFetch } from './api'

/**
 * Backend health probe — the end-to-end wiring proof (ticket 04 / ADR-0010).
 *
 * ADR-0010 defines a plain `/health` endpoint on the backend. Hitting it from
 * the FE through the configurable API base proves the whole seam: env-driven
 * base URL → cross-origin/proxy fetch → backend up. Feature calls reuse the same
 * `apiFetch` path.
 */
export interface HealthStatus {
  ok: boolean
  /** Raw payload echoed from the backend when reachable, else the error text. */
  detail: string
}

export async function checkBackendHealth(): Promise<HealthStatus> {
  try {
    const res = await apiFetch('/health')
    const text = await res.text()
    return { ok: res.ok, detail: text || `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) }
  }
}
