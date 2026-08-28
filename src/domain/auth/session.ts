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
import { authSessions, users } from '@/db/schema';
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

  /**
   * `users.last_seen_at` has existed since Phase 1 and nothing has ever written
   * it. The column read as "has this person ever actually used Relay", and the
   * honest answer it gave was *no* — for everybody, including whoever was
   * reading the page. The team roster found it by trying to use it and shipped
   * the join date instead, which was right: a field nothing maintains is worse
   * than a field that is absent, because it is confidently wrong.
   *
   * Here rather than in `getSession()`, which runs on every authenticated
   * request: a write on a read path is a side effect in the wrong place, and
   * the question the roster asks is "did they ever get in", not "were they here
   * a minute ago". Establishing a session is exactly that event.
   *
   * ## What this does not cover
   *
   * Auth.js's own magic-link callback creates its session through the adapter
   * and does not pass through here, so a person who signs in by that route is
   * not stamped. It is the fallback path since ADR-027 made the code flow
   * primary, and closing it means either an Auth.js `events.signIn` callback or
   * the lazy stamp in `getSession()` that this comment argues against. Named so
   * the gap is a decision rather than an omission.
   */
  await exec.update(users).set({ lastSeenAt: now }).where(eq(users.id, legacyUserId));

  return { sessionToken, expires };
}
