/**
 * `POST /api/cards/:id/restore` — the undo for an archived card (ADR-026).
 *
 * There is no undo for a discard, and there is deliberately no route that
 * pretends otherwise: `DELETE` reports which of the two happened, and a surface
 * that offers "Undo" on a discarded card is offering something this API will
 * answer with a 404. A discard is only ever permitted on a card that carries
 * nothing, so what a missing undo costs is a title someone can retype.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { restoreCard } from '@/domain/board/removal';
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
      'POST /api/cards/[id]/restore',
      session,
      body.engagementId,
      () => loadEngagementDetail(db, body.engagementId, session.orgId, now),
    );
    assertWritable(engagement);

    const restored = await restoreCard(
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
