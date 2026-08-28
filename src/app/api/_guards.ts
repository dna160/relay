/**
 * Session guards for route handlers.
 *
 * Not a route file — Next ignores anything in `app/` that is not `route.ts` or
 * a page. It lives here rather than in `src/lib/` because it is HTTP-shaped:
 * it turns a missing session into a 401 and a wrong-kind session into a 404.
 *
 * A client route calls `requireClient()` and reads the engagement off the
 * returned session. There is no other way to get one, which is what makes "a
 * client route that accepts an engagementId is a bug" mechanical (INV-6).
 */

import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { auth, getSession } from '@/lib/auth';
import { ensureAccountForVerifiedEmail } from '@/domain/access/provision-account';
import { verifiedAddressFrom } from '@/domain/auth/signin';
import { notVisible, unauthenticated } from '@/domain/errors';
import type { Session } from '@/lib/types';

type AgencySession = Extract<Session, { kind: 'agency' }>;
type ClientSession = Extract<Session, { kind: 'client' }>;

export async function requireAgency(): Promise<AgencySession> {
  const session = await getSession();
  if (!session) throw unauthenticated();
  // An agency route reached with a client cookie is not a permission problem;
  // as far as that contact is concerned the route does not exist.
  if (session.kind !== 'agency') throw notVisible('Not found');
  return session;
}

export async function requireClient(): Promise<ClientSession> {
  const session = await getSession();
  if (!session) throw unauthenticated();
  if (session.kind !== 'client') throw notVisible('Not found');
  return session;
}

/** For the approval audit trail: who, from where, with what. */
export function requestOrigin(request: Request): { ip: string | null; userAgent: string | null } {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip');
  return { ip: ip && ip.length > 0 ? ip : null, userAgent: request.headers.get('user-agent') };
}

/** Next 15 hands route params as a promise. */
export type RouteContext<T extends Record<string, string>> = { params: Promise<T> };

/* ------------------------------------------------- the verified-account gate */

/**
 * A session whose underlying **email address has been independently verified**.
 *
 * This is the guard `POST /api/invites/:token/redeem` runs, and it is the
 * left-hand side of INV-12. `requireAgency()` will not do: it answers "is there
 * a session for an onboarded agency member", and an invitee has no org yet, so
 * every invitation in the product would be unredeemable. `auth()` on its own
 * will not do either: it answers "is there a session", and a session is not
 * proof that its owner controls the address on it.
 *
 * ## What counts as verified
 *
 * A non-null `users.email_verified`, which exactly two things write: Auth.js's
 * own magic-link callback, and `ensureAccountForVerifiedEmail()` acting on a
 * `VerifiedAddress` from `consumeSignin()`. Both are a code or a link sent to
 * the address and returned from it. Nothing else in the codebase sets that
 * column, so there is no third way to satisfy this guard — and in particular
 * there is no way an *invite* satisfies it, because no invite path writes it.
 *
 * ## Why it provisions
 *
 * The account graph is what membership is written into, and a person who signed
 * in through Auth.js before this phase has a `users` row and no `accounts` row.
 * `ensureAccountForVerifiedEmail()` is idempotent and grants nothing that the
 * person's existing v1 row does not already imply, so calling it here costs a
 * write on the first redemption and nothing afterwards.
 */
export interface VerifiedAccount {
  readonly accountId: string;
  readonly legacyUserId: string;
  readonly email: string;
}

export async function requireVerifiedAccount(): Promise<VerifiedAccount> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw unauthenticated();

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const user = rows[0];
  if (!user) throw unauthenticated();

  const verified = verifiedAddressFrom(user.email, user.emailVerified);
  if (!verified) {
    // Signed in, address never proved. Unreachable with the email provider and
    // deliberately handled anyway: this is the shape a future OAuth provider
    // asserting an unverified address arrives in (ADR-021 §3), and the answer
    // to it is "prove the address", not "you are close enough".
    throw unauthenticated('Confirm your email address before accepting an invitation');
  }

  const account = await ensureAccountForVerifiedEmail(db, verified, user.name, new Date());
  return { accountId: account.accountId, legacyUserId: account.legacyUserId, email: user.email };
}
