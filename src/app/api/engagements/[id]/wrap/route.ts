/**
 * `POST /api/engagements/:id/wrap` — marks delivered, starts the countdown.
 *
 * Wrapping does not freeze the workspace. It records that the work was
 * delivered and recomputes the retention window; the archive sweep is what
 * makes it read-only, thirty days later, after four warnings.
 */

import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { wrapEngagement } from '@/domain/engagement/lifecycle';
import { daysToPurge } from '@/domain/retention/schedule';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency, type RouteContext } from '../../../_guards';

export async function POST(
  _request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { id } = await context.params;
    const now = new Date();

    const engagement = await wrapEngagement(db, { engagementId: id, orgId: session.orgId }, now);

    return NextResponse.json({
      engagement: {
        id: engagement.id,
        status: engagement.status,
        wrappedAt: engagement.wrappedAt?.toISOString() ?? null,
        lastActivityAt: engagement.lastActivityAt.toISOString(),
        daysToPurge: daysToPurge(engagement.purgeAt, now),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
