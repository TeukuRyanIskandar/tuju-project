import type { SessionUser } from '@tuju/contracts';

// The wire shape lives in `@tuju/contracts` (ADR-0014).
export type { SessionUser };

/**
 * The opaque server-side session shape (ADR-0005). Stored in Redis, referenced
 * by an httpOnly/Secure/SameSite cookie. The token never touches client JS;
 * revocation is instant (delete the Redis key) — the reason session beats a
 * stateless JWT here.
 */
/** The authenticated user resolved onto the request (`req.user`). */
export type AuthedUser = SessionUser;
