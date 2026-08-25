/**
 * `GET /api/engagements/:id/shelf` — the reference shelf, agency side.
 *
 * Not in API-CONTRACT.md; the agency shelf page needs a read to go with the
 * upload path. Flagged in the handover.
 */

import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { loadShelf } from '@/db/queries/shelf';
import { assertReadable } from '@/domain/engagement/lifecycle';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency, type RouteContext } from '../../../_guards';

export async function GET(
  _request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { id } = await context.params;
    const engagement = await loadEngagementDetail(db, id, session.orgId, new Date());
    // A purged engagement is 410 on a read too, so the caller reaches the
    // certificate instead of an empty workspace.
    assertReadable(engagement);
    const groups = await loadShelf(db, engagement.id);
    return NextResponse.json({ groups });
  } catch (error) {
    return toErrorResponse(error);
  }
}
