/**
 * Turns an incoming agency request into a `RequestContext` for `api-client`.
 *
 * It lives inside the agency route group, under an underscore so Next does not
 * route it, because it reads `next/headers` and must never be reachable from a
 * client component. The client surface has its own copy for the same reason:
 * one shared helper is one import away from being the thing that drags agency
 * code across the boundary.
 */

import { headers } from 'next/headers';
import type { RequestContext } from '@/lib/api-client';

export async function serverContext(): Promise<RequestContext> {
  const incoming = await headers();
  const cookie = incoming.get('cookie');
  return cookie ? { cookie } : {};
}
