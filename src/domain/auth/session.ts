/**
 * Turning a proven address into a session — the third and last step, and the
 * only one that mints anything a browser carries.
 *
 * ## One session shape, not two
 *
 * Auth.js is configured for database sessions (`strategy: 'database'`), so a
 * session *is* an `auth_sessions` row and a cookie naming it. This writes one
 * of those. It does not invent a provider, add a credentials flow, or introduce
 * a second thing `getSession()` has to understand — which is the same argument
 * `src/app/api/test/session/route.ts` already makes for the e2e path, and the
 * reason ADR-027 could narrow ADR-017 to the token half without disturbing the
 * session half.
 *
 * ## What it takes, and what that rules out
 *
 * A `VerifiedAddress` and a legacy user id. There is no overload that takes an
 * invite, a token, or an email that has not been through `consumeSignin()`. A
 * caller holding only an invite token has nothing to pass, which is INV-12
 * expressed as a signature rather than as a check.
 */

import { randomBytes } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { authSessions } from '@/db/schema';
import type { Executor } from '@/db/types';
import type { VerifiedAddress } from './signin';

/** ADR-021 §5: 30 days, rolling. Auth.js reads `expires` off the row. */
export const ACCOUNT_SESSION_TTL_DAYS = 30;

/** How old a `VerifiedAddress` may be and still mint a session. See below. */
const FRESH_VERIFICATION_MS = 60_000;

export interface EstablishedSession {
  readonly sessionToken: string;
  readonly expires: Date;
}

/**
 * @param verified the *only* way to get one of these is `consumeSignin()`.
 *   Typed rather than destructured at the call site so that a caller cannot
 *   pass an address it merely read off a request body.
 */
export async function establishAccountSession(
  exec: Executor,
  verified: VerifiedAddress,
  legacyUserId: string,
  now: Date,
): Promise<EstablishedSession> {
  /**
   * The verification has to be *this* request's.
   *
   * `consumeSignin()` stamps `verifiedAt` with the same clock the caller then
   * passes here, so a fresh one is always well inside the window. A stale one
   * means the value was carried across requests — held in a cache, replayed off
   * a queue, or reconstructed by a caller that wanted a session without going
   * through the code. None of those is a flow this product has, and the cheapest
   * moment to say so is before the row is written.
   */
  if (now.getTime() - verified.verifiedAt.getTime() > FRESH_VERIFICATION_MS) {
    throw new Error('establishAccountSession: the verification is not from this request');
  }

  // Sweep this user's dead rows on the way past. Auth.js's adapter deletes a
  // session when it reads an expired one; nothing deletes the sessions of
  // someone who simply stopped coming back.
  await exec
    .delete(authSessions)
    .where(and(eq(authSessions.userId, legacyUserId), lt(authSessions.expires, now)));

  const sessionToken = randomBytes(32).toString('hex');
  const expires = new Date(now.getTime() + ACCOUNT_SESSION_TTL_DAYS * 86_400_000);
  await exec.insert(authSessions).values({ sessionToken, userId: legacyUserId, expires });

  return { sessionToken, expires };
}
