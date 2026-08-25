/** `GET /api/engagements/:id/board` — lanes plus agency cards. */

import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { loadAgencyBoard } from '@/db/queries/agency-board';
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

    // Scoped load first — the board query itself is keyed only by engagement.
    const engagement = await shadowed('GET /api/engagements/[id]/board', session, id, () =>
      loadEngagementDetail(db, id, session.orgId, now),
    );
    // A purged engagement is 410 on a read too, so the caller reaches the
    // certificate instead of an empty workspace.
    assertReadable(engagement);
    const lanes = await loadAgencyBoard(db, engagement.id, now);

    return NextResponse.json({ engagementId: engagement.id, lanes });
  } catch (error) {
    return toErrorResponse(error);
  }
}
