/**
 * `PATCH /api/cards/:id` — edit a card's content and position.
 *
 * A body carrying `state` is rejected with 400 and nothing is written (INV-2).
 * The schema below has no state field at all, and `.strict()` makes every
 * unknown key an error, so the rejection is structural rather than a check
 * someone has to remember to keep. The explicit test above it exists only to
 * return a message that says where to go instead of "unrecognized key".
 *
 * Moving a card writes `position` and `laneId`. Dragging never changes state
 * (ADR-003) — a board people can move by hand becomes a board that lies.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { updateAndPlaceCard, updateCard } from '@/domain/card/mutate';
import { removeCard } from '@/domain/board/removal';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { validationFailed } from '@/domain/errors';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency, type RouteContext } from '../../_guards';
import { shadowed } from '../../_shadow';

const schema = z
  .object({
    engagementId: z.string().uuid(),
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(20_000).nullish(),
    assigneeId: z.string().uuid().nullish(),
    dueAt: z.coerce.date().nullish(),
    contractedRounds: z.number().int().min(0).max(99).nullish(),
    internalNotes: z.string().max(20_000).nullish(),
    effortEstimate: z.number().int().min(0).nullish(),
    visibilityOverride: z.enum(['inherit', 'private']).optional(),
    laneId: z.string().uuid().optional(),
    position: z.number().int().min(0).optional(),
  })
  .strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function PATCH(
  request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { id } = await context.params;
    const raw: unknown = await request.json();

    if (isRecord(raw) && Object.prototype.hasOwnProperty.call(raw, 'state')) {
      throw validationFailed(
        'A card state cannot be set here. Use POST /api/cards/:id/transition.',
        { field: 'state' },
      );
    }

    const body = schema.parse(raw);
    const now = new Date();

    const engagement = await shadowed('PATCH /api/cards/[id]', session, body.engagementId, () =>
      loadEngagementDetail(db, body.engagementId, session.orgId, now),
    );
    assertWritable(engagement);

    const { engagementId: _engagementId, laneId, position, ...patch } = body;

    if (laneId !== undefined || position !== undefined) {
      // One transaction: an edit that names an unreachable lane must leave the
      // prose unwritten too, or the 404 it returns is a lie about what happened.
      const card = await updateAndPlaceCard(
        db,
        engagement.id,
        id,
        patch,
        {
          ...(laneId === undefined ? {} : { laneId }),
          ...(position === undefined ? {} : { position }),
        },
        now,
      );
      return NextResponse.json({ card });
    }

    const card = await updateCard(db, engagement.id, id, patch, now);
    return NextResponse.json({ card });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * `DELETE /api/cards/:id?engagementId=…` — take this card off the board.
 *
 * The caller does not say *how*. ADR-026: the route discards the card when
 * deleting it destroys nothing else, and archives it otherwise, and the
 * response says which one happened so the surface knows whether to offer an
 * undo. A person clicking a remove button cannot be expected to know whether
 * this particular card has an approval bound to a sha256 behind it, and asking
 * them is how the wrong answer gets clicked.
 *
 * The engagement id rides in the query string rather than a body: a DELETE with
 * a body is legal and is inconsistently forwarded by proxies and by `fetch`
 * implementations, and it is not worth being clever about.
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

    const engagement = await shadowed('DELETE /api/cards/[id]', session, engagementId, () =>
      loadEngagementDetail(db, engagementId, session.orgId, now),
    );
    assertWritable(engagement);

    const removal = await removeCard(
      db,
      { engagementId: engagement.id, orgId: session.orgId, actorUserId: session.userId },
      id,
      now,
    );

    return NextResponse.json({
      removal: {
        kind: removal.kind,
        cardId: removal.cardId,
        archivedAt: removal.archivedAt?.toISOString() ?? null,
        kept: removal.kept,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
