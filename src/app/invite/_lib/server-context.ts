/**
 * Turns an incoming invite request into a `RequestContext` for `api-client`.
 *
 * A third copy of a seventeen-line function, and it is a copy for the reason
 * the agency's and the client's own copies each give: it reads `next/headers`,
 * so it must never be reachable from a client component, and one shared helper
 * is one import away from being the thing that drags a surface's code across a
 * boundary it was separated from on purpose. It lives under `_lib` so Next does
 * not route it.
 *
 * The cookie is forwarded so `GET /api/invites/:token` can answer *who is
 * reading* alongside *what this invite is*. The token itself grants nothing
 * either way; the cookie only decides whether the preview can say "you are
 * signed in as…" before anybody presses anything, instead of after.
 */

import { headers } from 'next/headers';
import type { RequestContext } from '@/lib/api-client.core';

export async function serverContext(): Promise<RequestContext> {
  const incoming = await headers();
  const cookie = incoming.get('cookie');
  return cookie ? { cookie } : {};
}
