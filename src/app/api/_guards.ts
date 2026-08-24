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

import { getSession } from '@/lib/auth';
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
