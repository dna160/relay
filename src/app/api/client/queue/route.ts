/** `GET /api/client/queue` — the cards where `awaitingYou` is true. */

import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { loadClientQueue } from '@/db/queries/client-board';
import { clientScope } from '@/db/queries/client-scope';
import { toErrorResponse } from '@/lib/errors';
import { requireClient } from '../../_guards';

export async function GET(): Promise<NextResponse> {
  try {
    const scope = clientScope(await requireClient());
    const cards = await loadClientQueue(db, scope);
    return NextResponse.json({ cards });
  } catch (error) {
    return toErrorResponse(error);
  }
}
