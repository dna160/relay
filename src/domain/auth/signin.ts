/**
 * `issueSignin` / `consumeSignin` — proving control of an email address.
 *
 * This pair proves **an address**. It does not create a session, it does not
 * read an invite, and it cannot grant membership: nothing in this file names a
 * membership table or an organization. That is INV-12's boundary drawn as a
 * module boundary — the thing that verifies and the thing that grants are
 * different files, and the grant takes the verification as an argument rather
 * than performing it.
 *
 * ## Why this is not Auth.js's email provider
 *
 * ADR-017 chose Auth.js's own routes for agency sign-in, correctly, on the
 * grounds that the library does token generation, single-use semantics, expiry
 * and CSRF properly and a hand-rolled second flow would have to redo all four.
 * One of those four turns out to be wrong for this product: Auth.js's email
 * callback is a **GET** that consumes the token. Outlook Safe Links and
 * Proofpoint prefetch every URL in an inbound message, so on any corporate
 * tenant the token is spent before the recipient sees the mail, and the
 * recipient's own click lands on "this link has expired".
 *
 * ADR-021 §5 says so explicitly and PHASE-10's exit condition makes it
 * testable: *a mail scanner that GETs the sign-in link twice before any human
 * action leaves the token valid — only the explicit POST consumes it.* That
 * cannot be arranged inside a flow whose consuming step is a GET, so this phase
 * owns the token half. ADR-027 records the change and what stayed: Auth.js
 * still owns the **session** — `consumeSignin` hands its verdict to
 * `establishAccountSession()`, which writes an ordinary `auth_sessions` row, so
 * `auth()` and `getSession()` are untouched and there is still exactly one
 * session shape in the product.
 *
 * ## Enumeration
 *
 * There is no known/unknown distinction to leak. An address that has never been
 * seen gets a token just like one that has, because on this product email
 * sign-in *is* sign-up — the account is created when the address is proven, not
 * when the code is requested. `issueSignin` therefore does identical work for
 * every address, and the only branch in it is the rate limit, which is a fact
 * about the caller rather than about the address.
 */

import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { signinTokens } from '@/db/schema';
import type { Executor } from '@/db/types';
import {
  NO_MATCH_HASH,
  SIGNIN_CODE_TTL_MINUTES,
  SIGNIN_MAX_ATTEMPTS,
  constantTimeEquals,
  newSigninCode,
  signinTokenHash,
} from './tokens';
import {
  SIGNIN_REQUEST_MAX,
  SIGNIN_SOURCE_MAX,
  SIGNIN_THROTTLE_WINDOW_MINUTES,
  recordAndCount,
  signinSourceIdentifier,
  signinThrottleIdentifier,
} from './throttle';

export interface IssuedSignin {
  /**
   * The six digits to put in the email, or `null` when this request was over
   * budget and nothing was written.
   *
   * Null is not an error the caller may report. The route answers identically
   * either way — telling someone they have hit a limit tells them the limit
   * exists and that the address reached it.
   */
  readonly code: string | null;
  readonly expiresInMinutes: number;
}

/**
 * One live token per address.
 *
 * Every prior row for the address goes, not just the expired ones — the same
 * rule `storeClientCode()` states and for the same arithmetic. A six-digit code
 * is only as strong as the number of them that would be accepted at once, so
 * requesting a thousand codes must not turn a 1-in-10^6 guess into 1-in-10^3.
 * It is also what "we sent you a new code" means to the person reading it.
 */
export async function issueSignin(
  exec: Executor,
  email: string,
  source: string,
  now: Date,
): Promise<IssuedSignin> {
  const perAddress = await recordAndCount(
    exec,
    signinThrottleIdentifier('request', email),
    SIGNIN_THROTTLE_WINDOW_MINUTES,
    now,
  );
  const perSource = await recordAndCount(
    exec,
    signinSourceIdentifier(source),
    SIGNIN_THROTTLE_WINDOW_MINUTES,
    now,
  );

  // Both budgets are charged before either is tested, so being over one does
  // not buy free attempts against the other.
  if (perAddress > SIGNIN_REQUEST_MAX || perSource > SIGNIN_SOURCE_MAX) {
    return { code: null, expiresInMinutes: SIGNIN_CODE_TTL_MINUTES };
  }

  const code = newSigninCode();
  await exec.delete(signinTokens).where(eq(signinTokens.email, email));
  await exec.insert(signinTokens).values({
    id: uuidv7(),
    tokenHash: signinTokenHash(email, code),
    email,
    expiresAt: new Date(now.getTime() + SIGNIN_CODE_TTL_MINUTES * 60 * 1000),
  });

  return { code, expiresInMinutes: SIGNIN_CODE_TTL_MINUTES };
}

/**
 * What a successful `consumeSignin` is: an address, proven, at a moment.
 *
 * Deliberately not an account id and deliberately not a session. Turning this
 * into an account is `ensureAccountForVerifiedEmail()`, which lives in
 * `src/domain/access/` because it writes to the permission graph; turning it
 * into a session is `establishAccountSession()`. Three steps, three files, and
 * an invite is not an input to any of them.
 */
export interface VerifiedAddress {
  readonly email: string;
  readonly verifiedAt: Date;
}

/**
 * Atomic, attempt-limited, constant-time.
 *
 * **Atomic** — the consuming UPDATE carries `consumed_at IS NULL` in its own
 * WHERE and returns the row it changed. Two requests racing with the same
 * correct code produce exactly one success; the loser sees zero rows and fails
 * like any wrong code. There is no read-then-write window to lose.
 *
 * **Attempt-limited** — the counter is incremented by the *first* statement,
 * which matches on the address rather than on the hash, because the guess that
 * has to be counted is the one that does not match and a wrong code cannot be
 * looked up by its own hash. Over the limit the token is not compared and not
 * consumed: the attempt buys nothing at all, and it is still charged.
 *
 * **Constant-time** — the hash comparison is `timingSafeEqual`, and the branch
 * where no live token exists at all still performs it, against `NO_MATCH_HASH`.
 * Returning early there would make "that address has no outstanding code"
 * measurably faster than "wrong code", which is the enumeration oracle the exit
 * condition forbids.
 */
export async function consumeSignin(
  exec: Executor,
  email: string,
  code: string,
  now: Date,
): Promise<VerifiedAddress | null> {
  const charged = await exec
    .update(signinTokens)
    .set({ attempts: sql`${signinTokens.attempts} + 1` })
    .where(
      and(
        eq(signinTokens.email, email),
        isNull(signinTokens.consumedAt),
        gt(signinTokens.expiresAt, now),
      ),
    )
    .returning({
      id: signinTokens.id,
      tokenHash: signinTokens.tokenHash,
      attempts: signinTokens.attempts,
    });

  const live = charged[0];
  const presented = signinTokenHash(email, code);

  // Always compared, even with nothing to compare against. See the header.
  const matches = constantTimeEquals(live?.tokenHash ?? NO_MATCH_HASH, presented);
  if (!live || !matches) return null;
  if (live.attempts > SIGNIN_MAX_ATTEMPTS) return null;

  const consumed = await exec
    .update(signinTokens)
    .set({ consumedAt: now })
    .where(and(eq(signinTokens.id, live.id), isNull(signinTokens.consumedAt)))
    .returning({ id: signinTokens.id });

  if (!consumed[0]) return null;
  return { email, verifiedAt: now };
}

/**
 * The second — and last — producer of a `VerifiedAddress`.
 *
 * Auth.js's own magic link is an independent verification of an address; it
 * stamps `users.email_verified` when the link is followed. A person who signed
 * in that way has proved exactly what `consumeSignin()` proves, and refusing to
 * admit it would mean everyone signed in before this phase had to sign in again
 * to accept an invitation.
 *
 * It reads a column and cannot conjure one: the argument is a timestamp the
 * database either holds or does not, and `null` — the shape of "signed in, never
 * proved the address", which a future OAuth provider asserting an unverified
 * email would produce — returns `null` here and therefore grants nothing. That
 * is ADR-021 §3's linking rule with no provider yet to apply it to.
 *
 * These two functions are the whole supply. Every consumer of a
 * `VerifiedAddress` is therefore reachable only from a real verification, which
 * is the property INV-12 turns on.
 */
export function verifiedAddressFrom(
  email: string,
  emailVerifiedAt: Date | null,
): VerifiedAddress | null {
  if (emailVerifiedAt === null) return null;
  return { email, verifiedAt: emailVerifiedAt };
}
