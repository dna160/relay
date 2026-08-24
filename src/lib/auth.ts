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

import { createHmac, randomInt, timingSafeEqual, createHash } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
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

function codeIdentifier(engagementId: string, email: string): string {
  return `client:${engagementId}:${email.toLowerCase()}`;
}

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
  // Expired rows for this identifier are swept on the way past, so the table
  // does not grow one row per abandoned attempt forever.
  await db
    .delete(authVerificationTokens)
    .where(
      and(
        eq(authVerificationTokens.identifier, identifier),
        lt(authVerificationTokens.expires, now),
      ),
    );
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
