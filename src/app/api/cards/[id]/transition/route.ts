/**
 * `POST /api/cards/:id/transition` — the only route that changes a card's state.
 *
 * The body names a destination; the state machine decides whether the move is
 * legal and what it costs (INV-2). An illegal edge is 409 `INVALID_TRANSITION`,
 * and the message deliberately does not distinguish "that edge does not exist"
 * from "you may not take it" — a distinct permission error tells a client which
 * moves exist.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { cardBelongsToEngagement } from '@/db/queries/agency-board';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { runTransition } from '@/domain/card/transition-card';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { notVisible } from '@/domain/errors';
import { toErrorResponse } from '@/lib/errors';
import { publishEvent } from '@/lib/sse';
import { requireAgency, type RouteContext } from '../../../_guards';
import { shadowed } from '../../../_shadow';

const schema = z
  .object({
    engagementId: z.string().uuid(),
    to: z.enum([
      'draft',
      'assigned',
      'in_progress',
      'internal_review',
      'awaiting_client',
      'changes_requested',
      'approved',
      'signed_off',
    ]),
    reason: z.string().max(2000).optional(),
  })
  .strict();

export async function POST(
  request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { id } = await context.params;
    const body = schema.parse(await request.json());
    const now = new Date();

    const engagement = await shadowed('POST /api/cards/[id]/transition', session, body.engagementId, () =>
      loadEngagementDetail(db, body.engagementId, session.orgId, now),
    );
    assertWritable(engagement);
    if (!(await cardBelongsToEngagement(db, id, engagement.id))) {
      throw notVisible('Card not found');
    }

    const outcome = await runTransition(
      db,
      { cardId: id, to: body.to, actor: { kind: 'agency', userId: session.userId } },
      now,
    );

    // Best-effort, after the transaction has committed. A dropped announcement
    // costs a stale board until its next read; it never costs the transition.
    await publishEvent(db, {
      engagementId: engagement.id,
      cardId: outcome.cardId,
      versionId: null,
      event: { type: 'card.transitioned', cardId: outcome.cardId, to: outcome.to },
    });

    return NextResponse.json({
      transition: {
        cardId: outcome.cardId,
        from: outcome.from,
        to: outcome.to,
        possession: outcome.possession,
        roundsUsed: outcome.roundsUsed,
        occurredAt: outcome.occurredAt.toISOString(),
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
