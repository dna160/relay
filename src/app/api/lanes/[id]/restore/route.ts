/**
 * `POST /api/lanes/:id/restore` — the undo for an archived lane (ADR-026).
 *
 * Restoring a lane brings back exactly the cards that were standing in it, in
 * the order they were standing, because archiving a lane never moved them. A
 * card that was separately archived stays archived and is restored on its own.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { restoreLane } from '@/domain/board/removal';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency, type RouteContext } from '../../../_guards';
import { shadowed } from '../../../_shadow';

const schema = z.object({ engagementId: z.string().uuid() }).strict();

export async function POST(
  request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { id } = await context.params;
    const body = schema.parse(await request.json());
    const now = new Date();

    const engagement = await shadowed(
      'POST /api/lanes/[id]/restore',
      session,
      body.engagementId,
      () => loadEngagementDetail(db, body.engagementId, session.orgId, now),
    );
    assertWritable(engagement);

    const restored = await restoreLane(
      db,
      { engagementId: engagement.id, orgId: session.orgId, actorUserId: session.userId },
      id,
      now,
    );

    return NextResponse.json({ restored });
  } catch (error) {
    return toErrorResponse(error);
  }
}
