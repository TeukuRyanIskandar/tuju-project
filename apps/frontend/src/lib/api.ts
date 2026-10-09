import { ContractParseError, parseOrThrow } from '@tuju/contracts'
import type { z } from 'zod'

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

/**
 * Whether `apiGet` validates response bodies against their contract schema.
 *
 * ON in dev and test, OFF in production builds. Validation exists to catch
 * backend/contract drift while developing (the contract objects are strict, so
 * an unannounced backend field fails loudly); in production it would only turn
 * a harmless extra field into a broken page, and costs parse time on big
 * payloads. "Warn-only in prod" (parse, report, still return the data) is the
 * later escape hatch once error reporting exists.
 */
export const VALIDATE_RESPONSES: boolean =
  import.meta.env.DEV || import.meta.env.MODE === 'test'

/** A non-2xx response from the backend. */
export class ApiError extends Error {
  override readonly name = 'ApiError'

  constructor(
    /** HTTP status code. */
    readonly status: number,
    /** Parsed JSON body when the response was JSON, else the raw text (may be empty). */
    readonly body: unknown,
    /** The request path (as passed to `apiGet`, including any query string). */
    readonly path: string,
  ) {
    super(`GET ${path} failed with ${status}`)
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (text === '') return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * Typed GET. Non-2xx throws {@link ApiError}. On success the JSON body is
 * validated against `schema` (throwing `ContractParseError`) when
 * {@link VALIDATE_RESPONSES} is on; otherwise it is returned as-is, typed by
 * the schema.
 */
export async function apiGet<S extends z.ZodType>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<z.output<S>> {
  const res = await apiFetch(path, init)
  if (!res.ok) throw new ApiError(res.status, await readBody(res), path)
  const text = await res.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    // A 2xx that is not JSON (e.g. an SPA fallback page) is a contract failure,
    // not a transient one: surface it typed so it is not retried.
    throw new ContractParseError(
      path,
      [{ code: 'custom', path: [], message: 'body is not JSON', input: text }],
      error,
    )
  }
  return VALIDATE_RESPONSES ? parseOrThrow(schema, json, path) : (json as z.output<S>)
}

type QueryValue = string | number | boolean | null | undefined

/** Append query params to a path, dropping `undefined`/`null` values. */
export function withQuery(path: string, params?: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null) search.set(key, String(value))
  }
  const qs = search.toString()
  return qs === '' ? path : `${path}${path.includes('?') ? '&' : '?'}${qs}`
}
