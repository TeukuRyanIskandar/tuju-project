import type { Tier } from './tier-policy';

/**
 * The opaque server-side session shape (ADR-0005). Stored in Redis, referenced
 * by an httpOnly/Secure/SameSite cookie. The token never touches client JS;
 * revocation is instant (delete the Redis key) — the reason session beats a
 * stateless JWT here.
 */
export interface SessionUser {
  userId: string;
  tier: Tier;
}

/** The authenticated user resolved onto the request (`req.user`). */
export type AuthedUser = SessionUser;
