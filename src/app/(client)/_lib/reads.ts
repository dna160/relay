/**
 * The client surface's read path, memoised per request.
 *
 * The layout needs the engagement's title and purge countdown; the page needs
 * the lanes. Both come from `GET /api/client/board`, and `cache()` makes that
 * one request rather than two. On a 4G connection with a 1.5s first-paint
 * budget, a duplicated round trip in a layout is most of the budget.
 *
 * Neither function takes an engagement id, and neither can be given one. The
 * session names the engagement (INV-6).
 */

import { cache } from 'react';
import { clientApi } from '@/lib/api-client.client';
import { serverContext } from './server-context';

export const getClientBoard = cache(async () => {
  const ctx = await serverContext();
  return clientApi.board(ctx);
});

export const getClientQueue = cache(async () => {
  const ctx = await serverContext();
  return clientApi.queue(ctx);
});
