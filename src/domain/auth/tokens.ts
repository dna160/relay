/**
 * Token generation, hashing, and the one comparison that has to be timing-safe.
 *
 * Pure. No executor, no clock, no environment — everything here is a function
 * of its arguments, which is what lets the interesting parts be tested without
 * a database.
 *
 * ## Only the hash is ever persisted
 *
 * `issueSignin()` and `issueInvite()` return the raw value once, to their
 * caller, which puts it in an email. Nothing writes it down. That is the same
 * property `storeClientCode()` already has and for the same reason: a database
 * dump must not be a set of live credentials.
 *
 * ## Why the sign-in hash includes the address
 *
 * `sha256(code)` alone, over a six-digit space, is a rainbow table with a
 * million entries in it — an attacker with read access to `signin_tokens` reads
 * every live code straight off. Binding the address in makes the precomputation
 * per-address, and the address is also what `consumeSignin()` drives from, so
 * nothing is lost by requiring it.
 *
 * An invite token is 32 random bytes and needs no such binding: there is no
 * space to precompute.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** ADR-021 §5. Fifteen minutes, single use. */
export const SIGNIN_CODE_TTL_MINUTES = 15;

/** ADR-021 §5. Seven days, single use. */
export const INVITE_TTL_DAYS = 7;

/**
 * Guesses against one address before the live token is worthless.
 *
 * Six digits is 10^6 and the token lives fifteen minutes. Ten attempts is the
 * same budget the client code already gets (`CLIENT_VERIFY_MAX_ATTEMPTS`),
 * chosen for the same reason: it is far more than a person mistypes and far
 * fewer than a search of the space needs.
 */
export const SIGNIN_MAX_ATTEMPTS = 10;

/** Six digits, uniformly. `randomInt` is rejection-sampled; `% 10**6` is not. */
export function newSigninCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * 32 bytes, base64url. Long enough that `GET /api/invites/:token` needs no rate
 * limit of its own to survive being guessed at.
 */
export function newInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * The address is lowercased here as well as being stored `citext`. Belt and
 * braces on purpose: `citext` makes the *column* case-insensitive, and this
 * makes the *hash input* case-insensitive, which the column cannot do.
 */
export function signinTokenHash(email: string, code: string): string {
  return sha256Hex(`signin:${email.toLowerCase()}:${code}`);
}

export function inviteTokenHash(token: string): string {
  return sha256Hex(`invite:${token}`);
}

/**
 * Constant-time string equality.
 *
 * The length check short-circuits, which leaks the length — irrelevant here,
 * where both sides are always 64 hex characters, and unavoidable for
 * `timingSafeEqual`, which throws on a length mismatch.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * A hash-shaped value that matches nothing, for the branch where there is no
 * row to compare against.
 *
 * `consumeSignin()` calls `constantTimeEquals` even when it found no live token
 * for the address, so that "no such address" and "wrong code" do the same work.
 * Without this the unknown-address path returns early and is measurably faster,
 * which is precisely the enumeration oracle the exit condition forbids.
 */
export const NO_MATCH_HASH = '0'.repeat(64);

/**
 * `ana@studio.com` → `a•••••••@studio.com`.
 *
 * `GET /api/invites/:token` is unauthenticated: anyone holding a forwarded link
 * can read the preview. The intended recipient has to be able to recognise
 * their own address in it — otherwise "sign in as the invited address" names
 * nothing — and nobody else should be able to harvest it. Masking the local
 * part keeps the domain, which is what makes it recognisable, and gives up the
 * part that makes it deliverable.
 *
 * The mask length is the local part's own length rather than a fixed run, so
 * two different addresses at one domain do not render identically.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '•••';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(2, local.length - 1))}${domain}`;
}
