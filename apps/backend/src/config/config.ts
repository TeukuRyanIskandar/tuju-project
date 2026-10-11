/**
 * Environment configuration (ADR-0006 invariant: every dependency reached by a
 * connection URL / env var, never a hardcoded host). The interface is identical
 * across environments; only the target differs (local container/LocalStack vs
 * RDS/S3). Values come from `.env` locally and AWS SSM in prod (ADR-0009) — the
 * app only ever reads them from the environment.
 */
import { parseCorsOrigins } from './cors';

export type DataSourceMode = 'synthetic' | 'yfinance';

export interface AppConfig {
  readonly nodeEnv: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly sessionSecret: string;
  /** Explicit CORS origin allowlist (comma-separated `CORS_ORIGINS`; never `*`). */
  readonly corsOrigins: readonly string[];
  /** Market/fundamentals adapter binding (`DATA_SOURCE`; default `synthetic`). */
  readonly dataSource: DataSourceMode;
  readonly cookie: {
    /** Parent domain a future BFF proxy can assume (ADR-0005 keep-it-migratable). */
    readonly domain: string | undefined;
    /** Secure flag off only for plain-HTTP local dev. */
    readonly secure: boolean;
    readonly sameSite: 'lax' | 'strict' | 'none';
    /** Session TTL in seconds (mirrors the Redis session TTL). */
    readonly maxAgeSeconds: number;
  };
  readonly cache: {
    /** Read cache TTL in seconds (default one EOD-derived horizon). */
    readonly readTtlSeconds: number;
  };
}

export function parseDataSource(raw: string | undefined): DataSourceMode {
  if (raw === 'yfinance') {
    return 'yfinance';
  }
  return 'synthetic';
}

function parseCookieSameSite(raw: string | undefined): 'lax' | 'strict' | 'none' {
  const value = raw ?? 'lax';
  if (!['lax', 'strict', 'none'].includes(value)) {
    throw new Error(
      `Invalid COOKIE_SAMESITE: "${value}". Expected one of: lax, strict, none`,
    );
  }
  return value as 'lax' | 'strict' | 'none';
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable ${name} (ADR-0006: connection-URL-by-env).`,
    );
  }
  return value;
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const secure = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : nodeEnv === 'production';

  const readTtlSeconds = Number(process.env.READ_CACHE_TTL_SECONDS ?? (24 * 60 * 60));
  if (!Number.isFinite(readTtlSeconds) || readTtlSeconds <= 0) {
    throw new Error('READ_CACHE_TTL_SECONDS must be a positive number');
  }

  return {
    nodeEnv,
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: required('DATABASE_URL'),
    redisUrl: required('REDIS_URL'),
    sessionSecret: required('SESSION_SECRET'),
    corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
    dataSource: parseDataSource(process.env.DATA_SOURCE),
    cookie: {
      domain: process.env.COOKIE_DOMAIN || undefined,
      secure,
      sameSite: parseCookieSameSite(process.env.COOKIE_SAMESITE),
      maxAgeSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 7),
    },
    cache: {
      readTtlSeconds,
    },
  };
}

/** DI token for the resolved AppConfig. */
export const APP_CONFIG = 'APP_CONFIG';
