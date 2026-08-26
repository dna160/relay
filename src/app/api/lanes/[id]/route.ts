/**
 * `PATCH /api/lanes/:id` — rename, reposition, or change visibility.
 * `DELETE /api/lanes/:id` — take the column off the board (ADR-026).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { updateLane } from '@/domain/lane/mutate';
import { removeLane } from '@/domain/board/removal';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency, type RouteContext } from '../../_guards';
import { shadowed } from '../../_shadow';

const schema = z.object({
  engagementId: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  position: z.number().int().min(0).optional(),
  visibility: z.enum(['published', 'private']).optional(),
});

export async function PATCH(
  request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { id } = await context.params;
    const body = schema.parse(await request.json());
    const now = new Date();

    const engagement = await shadowed('PATCH /api/lanes/[id]', session, body.engagementId, () =>
      loadEngagementDetail(db, body.engagementId, session.orgId, now),
    );
    assertWritable(engagement);

    const { engagementId: _engagementId, ...patch } = body;
    const lane = await updateLane(db, engagement.id, id, patch);

    return NextResponse.json({ lane });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * `DELETE /api/lanes/:id?engagementId=…`
 *
 * A lane holding no cards is deleted outright. A lane holding any card —
 * archived ones included — is archived instead, which hides it and everything
 * standing in it without touching a single card row.
 *
 * The archived-cards-count too is the point rather than a detail. `cards.lane_id`
 * is `ON DELETE CASCADE`, so a lane whose only occupant is an archived card
 * looks empty on the board and would take that card's versions and approvals
 * with it. Emptiness is asked of the table, never of the board.
 */
const removeQuery = z.object({ engagementId: z.string().uuid() });

export async function DELETE(
  request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { id } = await context.params;
    const { engagementId } = removeQuery.parse({
      engagementId: new URL(request.url).searchParams.get('engagementId'),
    });
    const now = new Date();

    const engagement = await shadowed('DELETE /api/lanes/[id]', session, engagementId, () =>
      loadEngagementDetail(db, engagementId, session.orgId, now),
    );
    assertWritable(engagement);

    const removal = await removeLane(
      db,
      { engagementId: engagement.id, orgId: session.orgId, actorUserId: session.userId },
      id,
      now,
    );

    return NextResponse.json({
      removal: {
        kind: removal.kind,
        laneId: removal.laneId,
        archivedAt: removal.archivedAt?.toISOString() ?? null,
        cardsHidden: removal.cardsHidden,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
