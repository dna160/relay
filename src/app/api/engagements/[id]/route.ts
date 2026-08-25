/** `GET /api/engagements/:id` — the agency projection of one engagement. */

import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { engagementToken } from '@/lib/auth';
import { assertReadable } from '@/domain/engagement/lifecycle';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency, type RouteContext } from '../../_guards';

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
    return NextResponse.json({
      engagement,
      /** The value that goes in the client's link. Derived, never stored. */
      clientLinkToken: engagementToken(engagement.id),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
