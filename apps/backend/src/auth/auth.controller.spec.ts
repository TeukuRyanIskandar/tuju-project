import { UnauthorizedException } from '@nestjs/common';
import { SessionUser, parseOrThrow } from '@tuju/contracts';
import type { AppConfig } from '../config/config';
import { AuthController } from './auth.controller';
import type { SessionStore } from './session.store';

/**
 * `/auth/me` and `/auth/login` return the contracts `SessionUser` (ADR-0014):
 * the same schema the SPA parses in `fetchSession`. Unit layer, no Redis.
 */
describe('AuthController wire shape', () => {
  const sessions = { create: async () => 'sid' } as unknown as SessionStore;
  const config = {
    cookie: { secure: false, sameSite: 'lax', domain: undefined, maxAgeSeconds: 60 },
  } as unknown as AppConfig;
  const controller = new AuthController(sessions, config);

  it('me() returns a body that parses as SessionUser', () => {
    const body = controller.me({ user: { userId: 'u1', tier: 'pro' } } as never);
    expect(parseOrThrow(SessionUser, JSON.parse(JSON.stringify(body)))).toEqual({
      userId: 'u1',
      tier: 'pro',
    });
  });

  it('me() without a session is 401', () => {
    expect(() => controller.me({} as never)).toThrow(UnauthorizedException);
  });

  it('login() returns a body that parses as SessionUser', async () => {
    const res = { cookie: jest.fn() } as never;
    const body = await controller.login({ userId: 'u2', tier: 'free' }, res);
    parseOrThrow(SessionUser, JSON.parse(JSON.stringify(body)));
  });
});
