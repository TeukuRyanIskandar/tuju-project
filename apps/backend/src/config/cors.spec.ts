/**
 * CORS allowlist (ticket frontend-foundation/04; ADR-0005).
 *
 * Parsing is pure. The header assertions boot a MINIMAL Nest app (one stub
 * controller + `applyCors`, the same function main.ts calls) on an ephemeral
 * port — no Postgres/Redis/Docker — and hit it over real HTTP, so they prove
 * the actual response headers rather than a mocked `enableCors` call.
 */
import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { loadConfig } from './config';
import { applyCors, DEFAULT_CORS_ORIGINS, parseCorsOrigins } from './cors';

describe('parseCorsOrigins', () => {
  it('defaults to the Vite dev origin when unset', () => {
    expect(parseCorsOrigins(undefined)).toEqual(['http://localhost:5173']);
    expect(DEFAULT_CORS_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('parses a single origin', () => {
    expect(parseCorsOrigins('https://app.example.com')).toEqual([
      'https://app.example.com',
    ]);
  });

  it('parses multiple comma-separated origins in order', () => {
    expect(
      parseCorsOrigins('http://localhost:5173,https://app.example.com'),
    ).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it('trims whitespace around entries', () => {
    expect(
      parseCorsOrigins('  http://localhost:5173 ,\thttps://app.example.com  '),
    ).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it('rejects a bare wildcard (cannot be combined with credentials)', () => {
    expect(() => parseCorsOrigins('*')).toThrow(/wildcard/i);
  });

  it('rejects a wildcard anywhere in the list, with surrounding whitespace', () => {
    expect(() => parseCorsOrigins('http://localhost:5173, * ')).toThrow(
      /wildcard/i,
    );
  });

  it('rejects wildcard-pattern origins', () => {
    expect(() => parseCorsOrigins('https://*.example.com')).toThrow(/wildcard/i);
  });

  it('rejects an empty entry between commas', () => {
    expect(() => parseCorsOrigins('http://localhost:5173,,https://a.com')).toThrow(
      /empty entry/i,
    );
  });

  it('rejects a trailing comma', () => {
    expect(() => parseCorsOrigins('http://localhost:5173,')).toThrow(
      /empty entry/i,
    );
  });

  it('rejects a set-but-blank value rather than silently using the default', () => {
    expect(() => parseCorsOrigins('')).toThrow(/empty entry/i);
    expect(() => parseCorsOrigins('   ')).toThrow(/empty entry/i);
  });
});

describe('loadConfig CORS_ORIGINS', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://x';
    process.env.REDIS_URL = 'redis://x';
    process.env.SESSION_SECRET = 'fake';
    delete process.env.CORS_ORIGINS;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('defaults corsOrigins to the dev origin', () => {
    expect(loadConfig().corsOrigins).toEqual(['http://localhost:5173']);
  });

  it('reads CORS_ORIGINS from the environment', () => {
    process.env.CORS_ORIGINS = 'https://a.example.com, https://b.example.com';
    expect(loadConfig().corsOrigins).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('fails startup when CORS_ORIGINS is "*"', () => {
    process.env.CORS_ORIGINS = '*';
    expect(() => loadConfig()).toThrow(/CORS_ORIGINS/);
  });
});

@Controller('ping')
class PingController {
  @Get()
  ping(): { ok: true } {
    return { ok: true };
  }
}

describe('applyCors (HTTP headers)', () => {
  const ALLOWED = 'http://localhost:5173';
  const OTHER_ALLOWED = 'https://app.example.com';
  const DISALLOWED = 'https://evil.example.com';
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PingController],
    }).compile();
    app = moduleRef.createNestApplication();
    applyCors(app, [ALLOWED, OTHER_ALLOWED]);
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([ALLOWED, OTHER_ALLOWED])(
    'echoes an allowed origin (%s) with credentials on a simple request',
    async (origin) => {
      const res = await fetch(`${base}/ping`, { headers: { Origin: origin } });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(origin);
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    },
  );

  it('answers an allowed-origin preflight with origin + credentials', async () => {
    const res = await fetch(`${base}/ping`, {
      method: 'OPTIONS',
      headers: {
        Origin: ALLOWED,
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('omits CORS headers for a disallowed origin', async () => {
    const res = await fetch(`${base}/ping`, {
      headers: { Origin: DISALLOWED },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('omits CORS headers on a disallowed-origin preflight', async () => {
    const res = await fetch(`${base}/ping`, {
      method: 'OPTIONS',
      headers: {
        Origin: DISALLOWED,
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('never returns a wildcard allow-origin', async () => {
    const res = await fetch(`${base}/ping`, { headers: { Origin: ALLOWED } });
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('omits CORS headers when no Origin header is sent', async () => {
    const res = await fetch(`${base}/ping`);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
