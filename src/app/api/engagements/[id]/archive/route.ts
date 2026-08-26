/**
 * `GET /api/engagements/:id/archive` — what has been removed and can come back.
 *
 * A separate read from the board rather than a `?includeArchived=true` flag on
 * it. The board is the live board and its shape is `AgencyLane[]`; an archived
 * card has no lane to sit in when its lane is gone too, and threading both
 * populations through one projection would mean every consumer of the board
 * learning to skip half of it. This is a different screen answering a different
 * question, so it is a different read.
 *
 * Readable on an archived engagement, which is `assertReadable` and not
 * `assertWritable`: an archived workspace is read-only, and the whole point of
 * read-only is that you can still see what is in it.
 */

import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { loadArchivedBoard } from '@/db/queries/agency-board';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { assertReadable } from '@/domain/engagement/lifecycle';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency, type RouteContext } from '../../../_guards';
import { shadowed } from '../../../_shadow';

export async function GET(
  _request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { id } = await context.params;
    const now = new Date();

    const engagement = await shadowed('GET /api/engagements/[id]/archive', session, id, () =>
      loadEngagementDetail(db, id, session.orgId, now),
    );
    assertReadable(engagement);

    const archive = await loadArchivedBoard(db, engagement.id);
    return NextResponse.json({ archive });
  } catch (error) {
    return toErrorResponse(error);
  }
}
