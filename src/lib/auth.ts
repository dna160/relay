/**
 * Identity, both kinds.
 *
 * Agency members sign in with Auth.js v5, email provider only — there is no
 * password surface to defend (ARCHITECTURE, stack table).
 *
 * Client contacts do not sign in at all in the account sense (ADR-005). They
 * open one link, confirm an emailed code, and receive a cookie naming exactly
 * one engagement. That cookie is signed with `CLIENT_LINK_SECRET` and carries a
 * single `engagementId` with no list, no array, and no wildcard — INV-6 is a
 * property of the payload's shape, not of the code that reads it. Rotating the
 * secret invalidates every outstanding client link, which is the intended blast
 * radius.
 */

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { and, count, eq, lt } from 'drizzle-orm';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Resend from 'next-auth/providers/resend';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { cookies } from 'next/headers';
import { db } from '@/db/client';
import {
  authAccounts,
  authSessions,
  authVerificationTokens,
  clientContacts,
  users,
} from '@/db/schema';
import {
  clientCodeIdentifier,
  clientThrottleIdentifier,
} from '@/domain/engagement/client-token-identity';
import type { AgencyRole, Session } from '@/lib/types';

/* ------------------------------------------------------------------ agency */

/**
 * The adapter's table types are written against `text`/`varchar` email columns;
 * ours is `citext`, which is the same thing to Postgres and a different generic
 * to TypeScript. The cast is at this one boundary and nowhere else.
 */
const adapterSchema = {
  usersTable: users,
  accountsTable: authAccounts,
  sessionsTable: authSessions,
  verificationTokensTable: authVerificationTokens,
} as unknown as Parameters<typeof DrizzleAdapter<typeof db>>[1];

export const authConfig: NextAuthConfig = {
  adapter: DrizzleAdapter(db, adapterSchema),
  session: { strategy: 'database' },
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY ?? 'missing',
      from: process.env.EMAIL_FROM ?? 'Relay <no-reply@example.com>',
    }),
  ],
  /**
   * All three are Relay pages, because all three are places a person lands in
   * the middle of trying to sign in.
   *
   * `error` was absent and defaulted to `/api/auth/error`, an unstyled Auth.js
   * HTML page outside the product. That is where an expired or already-used
   * link puts someone — the single most common failure of a magic-link flow,
   * and the one moment they most need a "send me another" button rather than a
   * dead end. Pointing it back at `/signin` costs nothing: the page is public,
   * so there is no redirect loop (Auth.js guards for one), and the error
   * arrives as `?error=` for the page to render.
   *
   * The codes that reach it: `Verification` (link expired or already used),
   * `EmailSignInError` (the provider refused to send), `AccessDenied`,
   * `Configuration` (a server-side misconfiguration — say so generically and
   * log it, never echo it). Anything else should render the same generic
   * message rather than the raw code.
   */
  pages: { signIn: '/signin', verifyRequest: '/signin/check-email', error: '/signin' },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/**
 * Signed in with Auth.js, but not yet a member of any org (ADR-013).
 *
 * `getSession()` below returns `null` for this person, deliberately: a null org
 * reads as "not onboarded" and can only ever deny access. But *only* null is
 * indistinguishable from signed-out, and a surface that cannot tell the two
 * apart sends a freshly magic-linked user back to `/signin`, where they sign in
 * again, and land in the same place. The loop is the whole reason this exists.
 *
 * It widens nothing. It answers one question — "is there an Auth.js session
 * whose user has no org?" — and returns no org, no role, and nothing an agency
 * route would accept. `POST /api/onboarding/org` is the only thing to do with
 * the answer.
 */
export async function pendingOnboarding(): Promise<{ userId: string; email: string } | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const rows = await db
    .select({ id: users.id, orgId: users.orgId, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const user = rows[0];
  if (!user || user.orgId !== null) return null;
  return { userId: user.id, email: user.email };
}

/* ------------------------------------------------------------------ client */

const CLIENT_COOKIE = 'relay_client_session';
const CLIENT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
export const CLIENT_CODE_TTL_MINUTES = 15;

function secret(): Buffer {
  const value = process.env.CLIENT_LINK_SECRET;
  if (!value) throw new Error('CLIENT_LINK_SECRET is not set');
  return Buffer.from(value, 'utf8');
}

function hmac(input: string): string {
  return createHmac('sha256', secret()).update(input).digest('base64url');
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The value in a client's URL. Derived rather than stored: there is no
 * `engagements.client_token` column to leak, to rotate per row, or to forget to
 * purge, and rotating the secret revokes every link at once.
 */
export function engagementToken(engagementId: string): string {
  return `${engagementId}.${hmac(`engagement:${engagementId}`)}`;
}

export function readEngagementToken(token: string): string | null {
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;
  const engagementId = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!constantTimeEquals(signature, hmac(`engagement:${engagementId}`))) return null;
  return engagementId;
}

export interface ClientSessionPayload {
  contactId: string;
  /** Exactly one. Not a list, not widenable (INV-6). */
  engagementId: string;
  exp: number;
}

export function signClientSession(
  contactId: string,
  engagementId: string,
  now: Date,
): { value: string; maxAge: number } {
  const payload: ClientSessionPayload = {
    contactId,
    engagementId,
    exp: Math.floor(now.getTime() / 1000) + CLIENT_SESSION_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return { value: `${body}.${hmac(body)}`, maxAge: CLIENT_SESSION_TTL_SECONDS };
}

export function verifyClientSession(raw: string, now: Date): ClientSessionPayload | null {
  const separator = raw.lastIndexOf('.');
  if (separator <= 0) return null;
  const body = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!constantTimeEquals(signature, hmac(body))) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const { contactId, engagementId, exp } = parsed as Record<string, unknown>;
  if (typeof contactId !== 'string' || typeof engagementId !== 'string') return null;
  if (typeof exp !== 'number' || exp * 1000 <= now.getTime()) return null;
  return { contactId, engagementId, exp };
}

/* ------------------------------------------------- the token in the URL bar */

/**
 * What the `[token]` segment of a `/e/{token}/…` URL means for this request.
 *
 * The client surface takes its engagement from the cookie and never from the
 * path (INV-6) — which is what makes the session unwidenable, and is also why
 * the path segment ended up never being looked at at all.
 * `/e/{someone-elses-token}/board` and `/e/garbage/board` both render *this*
 * contact's own workspace, with a 200.
 *
 * No other engagement's data is ever served, so this is not an INV-6 breach.
 * Two things are still wrong with it:
 *
 *   - A contact forwarded the wrong link sees a workspace, believes it is the
 *     one they were sent, and has nothing on the page to tell them otherwise.
 *     In a product whose whole access model is "one contract, one link", a link
 *     that silently means nothing is its own kind of failure.
 *   - It leaves a pre-validated-*looking* value sitting in the path. The next
 *     person to read the engagement from the URL instead of the session
 *     inherits something that was never checked, and that mistake would be a
 *     real INV-6 breach.
 *
 * ## Why a mismatch is not a 404
 *
 * The obvious rule — "the path token must equal the session's engagement, else
 * 404" — is wrong, and wrong in a way that would only show up in front of a
 * customer. The same person is routinely a contact on two engagements: they are
 * two `client_contacts` rows, and verifying the second link deliberately
 * *replaces* the cookie rather than merging it. Under that rule, a contact
 * signed in to engagement A who clicks their perfectly valid link for
 * engagement B gets "not found" for a workspace they were invited to.
 *
 * So a mismatch is not an error at all. It means "this cookie is not for this
 * workspace", and the honest response is the one the surface already has for
 * that: the verify path for the engagement the *link* names. Only a token that
 * does not parse is a 404 — and that one is a 404 even with no session, because
 * the landing page is where a stranger arrives and "this is not a link" is the
 * true answer.
 *
 * 404 and never 403, as everywhere else: which engagement tokens are real is
 * not a fact an anonymous caller is entitled to.
 */
export type PathTokenVerdict =
  /** Serve the workspace: either no client session yet, or it names this one. */
  | { state: 'ok'; engagementId: string }
  /** 404. The segment is not a signed token at all. */
  | { state: 'malformed' }
  /**
   * Render the **verify path for `engagementId`**. Do not 404, and do not serve
   * the session's own workspace under this URL.
   */
  | { state: 'other_engagement'; engagementId: string };

export async function checkClientPathToken(
  pathToken: string,
  now = new Date(),
): Promise<PathTokenVerdict> {
  const named = readEngagementToken(pathToken);
  if (!named) return { state: 'malformed' };

  const session = await getSession(now);
  if (!session || session.kind !== 'client') return { state: 'ok', engagementId: named };

  return named === session.engagementId
    ? { state: 'ok', engagementId: named }
    : { state: 'other_engagement', engagementId: named };
}

export const clientCookieName = CLIENT_COOKIE;

export function clientCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

/* ----------------------------------------------------------- one-time codes */

/** Six digits. Long enough against a rate-limited guess, short enough to type. */
export function newClientCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Shared with the purge worker, which deletes these rows. */
const codeIdentifier = clientCodeIdentifier;

/** Only the hash is stored. A database dump is not a set of live magic links. */
function codeHash(engagementId: string, email: string, code: string): string {
  return createHash('sha256')
    .update(`${codeIdentifier(engagementId, email)}:${code}`)
    .digest('hex');
}

export async function storeClientCode(
  engagementId: string,
  email: string,
  code: string,
  now: Date,
): Promise<void> {
  const identifier = codeIdentifier(engagementId, email);
  /**
   * **Every** prior code for this identifier goes, not just the expired ones.
   *
   * Sweeping only expired rows left every requested-but-unused code live at
   * once, and a six-digit code is only as strong as the number of them that
   * would be accepted: requesting a thousand codes turned a 1-in-10^6 guess
   * into 1-in-10^3 without any of them ever being used. Exactly one code is
   * live per contact per engagement, which is also what "we sent you a new
   * code" means to the person reading the email.
   */
  await db
    .delete(authVerificationTokens)
    .where(eq(authVerificationTokens.identifier, identifier));
  await db.insert(authVerificationTokens).values({
    identifier,
    token: codeHash(engagementId, email, code),
    expires: new Date(now.getTime() + CLIENT_CODE_TTL_MINUTES * 60 * 1000),
  });
}

/** Single use: the row is deleted by the same statement that matched it. */
export async function consumeClientCode(
  engagementId: string,
  email: string,
  code: string,
  now: Date,
): Promise<boolean> {
  const deleted = await db
    .delete(authVerificationTokens)
    .where(
      and(
        eq(authVerificationTokens.identifier, codeIdentifier(engagementId, email)),
        eq(authVerificationTokens.token, codeHash(engagementId, email, code)),
      ),
    )
    .returning({ expires: authVerificationTokens.expires });

  const row = deleted[0];
  if (!row) return false;
  return row.expires.getTime() > now.getTime();
}

/* ------------------------------------------------------------- throttling */

/**
 * Rate limiting on the one surface that has no password behind it.
 *
 * A client contact proves themselves with six digits. Six digits is 10^6, a
 * 15-minute window is 900 seconds, and an attacker who can put a thousand
 * requests a second at `POST /api/auth/client/verify` walks the whole space
 * inside one code's lifetime. Without a limit the link is not protected by the
 * code at all; it is protected by nobody having tried. That is the whole of
 * INV-6's practical strength, so the limit is not optional.
 *
 * ## Why the counters live in `auth_verification_tokens`
 *
 * They need to be shared across app replicas — an in-process counter is
 * defeated by a second container, which is the deployment shape Railway gives
 * us — and they need to expire on their own. That is exactly what this table
 * already is: `(identifier, token)` unique, `expires` timestamped, rows nobody
 * mourns. A dedicated table would need a migration, a `TABLE_DISPOSITION`
 * entry, and its own sweeper, to store strictly less. The identifiers are
 * namespaced so a throttle row can never collide with a code row.
 *
 * ## Why the attempt is recorded *before* it is counted
 *
 * Count-then-insert has a window: N concurrent guesses all read the same count
 * and all pass. Insert-then-count closes it, because every concurrent attempt
 * is already visible to the others by the time any of them counts. The bound
 * holds under a burst, which is the only kind of attempt that matters here.
 */

/** Guesses per contact per engagement per window. Cleared on success. */
export const CLIENT_VERIFY_MAX_ATTEMPTS = 10;
/** Codes sent to one address for one engagement per window. */
export const CLIENT_REQUEST_MAX = 5;
/** Matches the code TTL: a budget that outlives the code it guards is not one. */
export const CLIENT_THROTTLE_WINDOW_MINUTES = CLIENT_CODE_TTL_MINUTES;

/**
 * Records one occurrence and returns how many are live in the window,
 * this one included. Expired rows for the identifier are swept on the way past
 * so the table does not accumulate.
 */
async function recordAndCount(identifier: string, now: Date): Promise<number> {
  const expires = new Date(now.getTime() + CLIENT_THROTTLE_WINDOW_MINUTES * 60 * 1000);

  await db
    .delete(authVerificationTokens)
    .where(
      and(
        eq(authVerificationTokens.identifier, identifier),
        lt(authVerificationTokens.expires, now),
      ),
    );

  // The token column is the unique half of the key, so each occurrence needs a
  // value of its own. It is never read back — only counted.
  await db.insert(authVerificationTokens).values({
    identifier,
    token: randomBytes(16).toString('base64url'),
    expires,
  });

  const rows = await db
    .select({ n: count() })
    .from(authVerificationTokens)
    .where(eq(authVerificationTokens.identifier, identifier));
  return rows[0]?.n ?? 0;
}

/**
 * @returns false when this attempt is over budget and must not be allowed to
 * test a code. The attempt is still charged — an attacker does not get free
 * guesses by being over the limit.
 */
export async function chargeVerifyAttempt(
  engagementId: string,
  email: string,
  now: Date,
): Promise<boolean> {
  const used = await recordAndCount(clientThrottleIdentifier('verify', engagementId, email), now);
  return used <= CLIENT_VERIFY_MAX_ATTEMPTS;
}

/**
 * Only a *successful* verification clears the budget. Requesting a fresh code
 * deliberately does not: otherwise the attacker resets their own allowance by
 * asking for a code they never receive.
 */
export async function clearVerifyAttempts(engagementId: string, email: string): Promise<void> {
  await db
    .delete(authVerificationTokens)
    .where(eq(authVerificationTokens.identifier, clientThrottleIdentifier('verify', engagementId, email)));
}

/**
 * @returns false when this address has already been sent its allowance of codes
 * for this engagement. Charged whether or not the address is a real contact, so
 * the throttle cannot be used to tell the two apart.
 */
export async function chargeCodeRequest(
  engagementId: string,
  email: string,
  now: Date,
): Promise<boolean> {
  const used = await recordAndCount(clientThrottleIdentifier('request', engagementId, email), now);
  return used <= CLIENT_REQUEST_MAX;
}

/* --------------------------------------------------------------- resolution */

/**
 * The one place a request's identity is decided. A request carries exactly one
 * session kind; the client cookie is checked first because a client route must
 * never be satisfied by an agency member's browser happening to be signed in.
 */
export async function getSession(now = new Date()): Promise<Session | null> {
  const jar = await cookies();
  const raw = jar.get(CLIENT_COOKIE)?.value;
  if (raw) {
    const payload = verifyClientSession(raw, now);
    if (payload) {
      // The contact must still exist and still belong to that engagement.
      const rows = await db
        .select({ id: clientContacts.id, engagementId: clientContacts.engagementId })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.id, payload.contactId),
            eq(clientContacts.engagementId, payload.engagementId),
          ),
        )
        .limit(1);
      const contact = rows[0];
      if (contact) {
        return { kind: 'client', contactId: contact.id, engagementId: contact.engagementId };
      }
    }
  }

  const agency = await auth();
  const userId = agency?.user?.id;
  if (!userId) return null;

  const rows = await db
    .select({ id: users.id, orgId: users.orgId, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = rows[0];
  if (!user || user.orgId === null) return null;

  return {
    kind: 'agency',
    userId: user.id,
    orgId: user.orgId,
    role: user.role as AgencyRole,
  };
}
