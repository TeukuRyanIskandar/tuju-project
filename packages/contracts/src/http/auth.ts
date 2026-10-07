import { z } from 'zod';

/** Ordinal user tier (ADR-0005); `premium` is reserved for Product C. */
export const Tier = z.enum(['free', 'pro', 'premium']);
export type Tier = z.infer<typeof Tier>;

/** `GET /auth/me` and `POST /auth/login` — the resolved session user. */
export const SessionUser = z.strictObject({
  userId: z.string(),
  tier: Tier,
});
export type SessionUser = z.infer<typeof SessionUser>;
