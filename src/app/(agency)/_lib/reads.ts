/**
 * The agency workspace's read path, memoised per request.
 *
 * The workspace layout needs the engagement for its title and wrap slate; the
 * pages inside it need `status` to know whether anything is writable. Both come
 * from `GET /api/engagements/:id`, and `cache()` makes that one request per
 * render rather than one per component — a layout and its page are two
 * components and would otherwise be two round trips for the same row.
 *
 * The engagement id is a parameter here and not in the client surface's
 * equivalent. That asymmetry is INV-6, not an inconsistency: an agency member
 * chooses which engagement to open, a client contact has exactly one and it
 * comes from the session.
 */

import { cache } from 'react';
import { agencyApi } from '@/lib/api-client.agency';
import { serverContext } from './server-context';

export const getEngagement = cache(async (id: string) => {
  const ctx = await serverContext();
  return agencyApi.engagement(id, ctx);
});

export const getBoard = cache(async (id: string) => {
  const ctx = await serverContext();
  return agencyApi.board(id, ctx);
});
