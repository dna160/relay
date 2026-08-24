/**
 * Turns an incoming client request into a `RequestContext` for `api-client`.
 *
 * A copy of the agency helper rather than a shared import, so that a grep for
 * `components/agency` or `(agency)/` in this subtree returns nothing at all.
 * The cookie it forwards is scoped to exactly one engagement (INV-6); no
 * engagement id is read here, because there is nowhere to send one.
 */

import { headers } from 'next/headers';
import type { RequestContext } from '@/lib/api-client';

export async function serverContext(): Promise<RequestContext> {
  const incoming = await headers();
  const cookie = incoming.get('cookie');
  return cookie ? { cookie } : {};
}
