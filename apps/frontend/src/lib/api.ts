/**
 * API base URL — a single configurable entry point (ADR-0005).
 *
 * ADR-0005 pays a small "keep-it-migratable" tax: the FE must never hard-code
 * backend URLs. Everything goes through this one base so a later move to a
 * TanStack Start BFF/proxy is an additive config change, not a code hunt.
 *
 * Configured by `VITE_API_BASE_URL` (Vite inlines `VITE_`-prefixed env at build
 * time). Defaults to a relative empty base so that, when the SPA is served
 * behind the same origin/proxy as the API, calls resolve same-origin and the
 * httpOnly session cookie (ADR-0005) is sent automatically.
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? ''

/** Join the configured base with a path, tolerant of trailing/leading slashes. */
export function apiUrl(path: string): string {
  const base = API_BASE_URL.replace(/\/$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}

/**
 * `fetch` wrapper that always sends credentials so the backend's httpOnly,
 * Secure, SameSite session cookie (ADR-0005) rides along. The token never
 * touches client JS; the browser manages the cookie.
 */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), {
    credentials: 'include',
    ...init,
  })
}
