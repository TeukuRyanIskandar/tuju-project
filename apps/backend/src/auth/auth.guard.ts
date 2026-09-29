import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessionStore } from './session.store';

/** Cookie name carrying the opaque session id (ADR-0005). */
export const SESSION_COOKIE_NAME = 'tuju_session';

/**
 * Resolves `req.user` from the opaque session cookie (ADR-0005). Applied as a
 * global guard so `req.user` is populated everywhere; anonymous requests (Product
 * B public surface) simply have no `req.user` and are allowed through here — the
 * TierGuard enforces capability on the routes that need it.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionStore) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { cookies?: Record<string, string>; user?: unknown }>();

    const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
    if (sessionId) {
      const user = await this.sessions.resolve(sessionId);
      if (user) req.user = user;
    }
    // Never blocks here — anonymous is a valid state (ADR-0005 Product B path).
    return true;
  }
}
