/**
 * The rate limiter, lifted out of `src/lib/auth.ts` so a second surface can use
 * it without a second implementation.
 *
 * ## Why this moved rather than being rewritten
 *
 * The mechanism arrived with the round-1 hardening sweep for the client code
 * and its reasoning is recorded there in full: the counters live in
 * `auth_verification_tokens` because they must be shared across app replicas
 * (an in-process counter is defeated by a second container, which is the
 * deployment shape Railway gives us) and must expire on their own, and that
 * table is already `(identifier, token)` unique with an `expires` timestamp and
 * rows nobody mourns.
 *
 * All of that is just as true of an account sign-in code, and the alternative
 * — a second limiter with its own table, its own sweeper and its own
 * `TABLE_DISPOSITION` entry — would be two mechanisms that can be tuned apart
 * and only one of which anyone remembers to check. So the function moved into
 * the domain, took an `Executor` instead of reaching for `db`, and grew a
 * window parameter. Nothing about how it counts changed.
 *
 * ## Why the attempt is recorded *before* it is counted
 *
 * Verbatim from the original, because it is the part that is easy to undo:
 * count-then-insert has a window in which N concurrent guesses all read the
 * same count and all pass. Insert-then-count closes it, because every
 * concurrent attempt is already visible to the others by the time any of them
 * counts. The bound holds under a burst, which is the only kind of attempt that
 * matters here.
 */

import { and, count, eq, lt } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { authVerificationTokens } from '@/db/schema';
import type { Executor } from '@/db/types';

/**
 * Records one occurrence and returns how many are live in the window, this one
 * included. Expired rows for the identifier are swept on the way past so the
 * table does not accumulate.
 */
export async function recordAndCount(
  exec: Executor,
  identifier: string,
  windowMinutes: number,
  now: Date,
): Promise<number> {
  const expires = new Date(now.getTime() + windowMinutes * 60 * 1000);

  await exec
    .delete(authVerificationTokens)
    .where(
      and(
        eq(authVerificationTokens.identifier, identifier),
        lt(authVerificationTokens.expires, now),
      ),
    );

  // The token column is the unique half of the key, so each occurrence needs a
  // value of its own. It is never read back — only counted.
  await exec.insert(authVerificationTokens).values({
    identifier,
    token: randomBytes(16).toString('base64url'),
    expires,
  });

  const rows = await exec
    .select({ n: count() })
    .from(authVerificationTokens)
    .where(eq(authVerificationTokens.identifier, identifier));
  return rows[0]?.n ?? 0;
}

/** Hand the budget back. Only ever called on a *success*. */
export async function clearThrottle(exec: Executor, identifier: string): Promise<void> {
  await exec
    .delete(authVerificationTokens)
    .where(eq(authVerificationTokens.identifier, identifier));
}

/* ------------------------------------------------- the account-side buckets */

export type SigninThrottleKind = 'request' | 'verify';

/**
 * Namespaced `account-throttle:` so it can never collide with the `client:` and
 * `client-throttle:` identifiers the purge deletes by prefix. An account's
 * sign-in budget is not engagement-scoped and must not be swept by a purge —
 * which is exactly what a shared prefix would cause.
 */
export function signinThrottleIdentifier(kind: SigninThrottleKind, email: string): string {
  return `account-throttle:${kind}:${email.toLowerCase()}`;
}

/**
 * The per-source bucket, so that one address is not the only thing bounded.
 *
 * Without it, a caller with a word list sends one code to each of ten thousand
 * addresses and never trips the per-address limit once. `source` is whatever
 * the route could establish — a forwarded IP, or the literal `unknown` when it
 * could not, which is deliberately one shared bucket rather than a free pass.
 */
export function signinSourceIdentifier(source: string): string {
  return `account-throttle:source:${source}`;
}

/** Codes issued for one address per window. */
export const SIGNIN_REQUEST_MAX = 5;

/** Codes issued from one source per window, across every address. */
export const SIGNIN_SOURCE_MAX = 30;

/** Matches the code TTL: a budget that outlives the code it guards is not one. */
export const SIGNIN_THROTTLE_WINDOW_MINUTES = 15;
