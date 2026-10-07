import type { INestApplication } from '@nestjs/common';
import type { CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * CORS allowlist (ADR-0005: the browser talks to NestJS directly from a
 * different origin and needs the session cookie).
 *
 * ACCESS CONTROL: credentials are enabled, so the allowed origin must be an
 * explicit allowlist. A wildcard is rejected at startup — `*` cannot be combined
 * with credentials, and we never want a misconfig to silently open the API.
 */

/** Dev default: the Vite dev server. */
export const DEFAULT_CORS_ORIGINS: readonly string[] = ['http://localhost:5173'];

/**
 * Parse a comma-separated `CORS_ORIGINS` value into an allowlist.
 * `undefined` (unset) yields the dev default. A set-but-blank value, an empty
 * entry (`a,,b`, trailing comma) or any `*` throws so the process fails fast.
 */
export function parseCorsOrigins(raw: string | undefined): readonly string[] {
  if (raw === undefined) return DEFAULT_CORS_ORIGINS;

  const origins = raw.split(',').map((entry) => entry.trim());
  for (const origin of origins) {
    if (origin === '') {
      throw new Error(
        'Invalid CORS_ORIGINS: empty entry. Provide a comma-separated list of explicit origins (e.g. "http://localhost:5173,https://app.example.com").',
      );
    }
    if (origin.includes('*')) {
      throw new Error(
        `Invalid CORS_ORIGINS: wildcard "${origin}" is not allowed. A wildcard origin cannot be combined with credentials; list explicit origins instead.`,
      );
    }
  }
  return origins;
}

/**
 * Enable credentialed CORS for exactly the allowlisted origins.
 *
 * Uses a per-request options delegate rather than a static
 * `{ origin: allowlist, credentials: true }`: the underlying `cors` package
 * emits `Access-Control-Allow-Credentials: true` even when the origin is not
 * allowed. The delegate switches credentials off for non-allowlisted origins,
 * so they receive no CORS headers at all. Allowed origins get the same result
 * as the static options (origin echoed, credentials true).
 */
export function applyCors(
  app: Pick<INestApplication, 'enableCors'>,
  origins: readonly string[],
): void {
  const allowlist = new Set(origins);
  const delegate: CorsOptionsDelegate<{ headers: { origin?: string } }> = (
    req,
    callback,
  ) => {
    const origin = req.headers.origin;
    if (origin !== undefined && allowlist.has(origin)) {
      callback(null, { origin, credentials: true });
    } else {
      callback(null, { origin: false, credentials: false });
    }
  };
  app.enableCors(delegate);
}
