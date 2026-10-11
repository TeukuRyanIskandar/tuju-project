import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { SESSION_COOKIE_NAME } from './auth.guard';
import { SessionStore } from './session.store';
import type { AuthedUser, SessionUser } from './session.types';
import { LoginRequestDto } from './dto/login.dto';

/**
 * STUB auth endpoints (ADR-0005: "Login/session endpoints can be stubs").
 *
 * `login` does NOT verify credentials at scaffold time — it mints a session for a
 * supplied userId/tier so the cookie + session + TierGuard path is exercisable
 * end-to-end. Real credential verification/password hashing is a feature effort.
 * The cookie flags (httpOnly/Secure/SameSite) are the ADR-0005 durable part.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly sessions: SessionStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('login')
  async login(
    @Body() body: LoginRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionUser> {
    // STUB: accept the claimed identity; a feature effort adds real verification.
    const user: SessionUser = {
      userId: body.userId ?? 'stub-user',
      tier: body.tier ?? 'free',
    };
    const sessionId = await this.sessions.create(user);

    res.cookie(SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true, // token never touches client JS (ADR-0005)
      secure: this.config.cookie.secure, // Secure (off only for local HTTP)
      sameSite: this.config.cookie.sameSite,
      domain: this.config.cookie.domain, // shared parent domain for a future BFF
      maxAge: this.config.cookie.maxAgeSeconds * 1000,
      path: '/',
    });
    return user;
  }

  @Post('logout')
  async logout(
    @Req() req: Request & { cookies?: Record<string, string> },
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
    if (sessionId) await this.sessions.destroy(sessionId); // instant revocation
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return { ok: true };
  }

  /** FE reads `tier` from here to show/hide paywalled UI — presentation only. */
  @Get('me')
  me(@Req() req: Request & { user?: AuthedUser }): SessionUser {
    if (!req.user) throw new UnauthorizedException();
    return req.user;
  }
}
