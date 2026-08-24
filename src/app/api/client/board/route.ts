/**
 * `GET /api/client/board` — published lanes and cards only.
 *
 * The engagement comes from the session and from nowhere else. There is no
 * parameter, no query string, and no body on this route, which is what makes
 * INV-6 mechanical here rather than a convention.
 */

import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { loadClientBoard, loadClientEngagementHeader } from '@/db/queries/client-board';
import { clientScope } from '@/db/queries/client-scope';
import { toErrorResponse } from '@/lib/errors';
import { requireClient } from '../../_guards';

export async function GET(): Promise<NextResponse> {
  try {
    const session = await requireClient();
    const scope = clientScope(session);
    const now = new Date();

    const [header, lanes] = await Promise.all([
      loadClientEngagementHeader(db, scope, now),
      loadClientBoard(db, scope),
    ]);

    return NextResponse.json({ engagement: header, lanes });
  } catch (error) {
    return toErrorResponse(error);
  }
}
