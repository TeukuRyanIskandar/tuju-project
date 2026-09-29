import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { REDIS_CLIENT } from '../redis/redis.module';
import type { SessionUser } from './session.types';

/**
 * Opaque server-side session store in Redis (ADR-0005).
 *
 * The cookie carries only an opaque, unguessable session id; the user record
 * lives server-side keyed by that id. Deleting the key revokes instantly (needed
 * for tier downgrades/bans) — the reason this beats a stateless JWT.
 */
@Injectable()
export class SessionStore {
  private static readonly PREFIX = 'session:';

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Create a session, returning the opaque id to set in the cookie. */
  async create(user: SessionUser): Promise<string> {
    const sessionId = randomUUID();
    await this.redis.set(
      this.key(sessionId),
      JSON.stringify(user),
      'EX',
      this.config.cookie.maxAgeSeconds,
    );
    return sessionId;
  }

  /** Resolve a session id to its user, or null if missing/expired/revoked. */
  async resolve(sessionId: string): Promise<SessionUser | null> {
    const raw = await this.redis.get(this.key(sessionId));
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  }

  /** Revoke a session (instant — the JWT-vs-session tradeoff, ADR-0005). */
  async destroy(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId));
  }

  private key(sessionId: string): string {
    return `${SessionStore.PREFIX}${sessionId}`;
  }
}
