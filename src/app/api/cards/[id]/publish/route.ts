/**
 * `POST /api/cards/:id/publish` — the internal gate (PRD §5.2).
 *
 * Stamps `published_to_client_at` on the version and moves the card
 * `internal_review -> awaiting_client` through the state machine, in one
 * transaction. Nothing reaches the client projection until this runs.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { publishCardToClient } from '@/domain/version/publish-to-client';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { toErrorResponse } from '@/lib/errors';
import { publishEvent } from '@/lib/sse';
import { requireAgency, type RouteContext } from '../../../_guards';

const schema = z
  .object({
    engagementId: z.string().uuid(),
    /** Optional — defaults to the card's newest version. */
    versionId: z.string().uuid().optional(),
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

    const engagement = await loadEngagementDetail(db, body.engagementId, session.orgId, now);
    assertWritable(engagement);

    const result = await publishCardToClient(
      db,
      {
        cardId: id,
        engagementId: engagement.id,
        ...(body.versionId === undefined ? {} : { versionId: body.versionId }),
        actorUserId: session.userId,
      },
      now,
    );

    /**
     * Two events, because two things happened and a client cares about both:
     * a file crossed the internal gate, and the card came to them. Announced
     * only when the version was newly published — a re-publish is a no-op and
     * should not make every open board blink.
     */
    if (result.newlyPublished) {
      await publishEvent(db, {
        engagementId: engagement.id,
        cardId: id,
        versionId: result.version.id,
        event: {
          type: 'version.published',
          cardId: id,
          versionId: result.version.id,
          versionNo: result.version.versionNo,
        },
      });
    }
    await publishEvent(db, {
      engagementId: engagement.id,
      cardId: id,
      versionId: null,
      event: { type: 'card.transitioned', cardId: id, to: result.transition.to },
    });

    return NextResponse.json({
      version: {
        id: result.version.id,
        versionNo: result.version.versionNo,
        publishedToClientAt: result.version.publishedToClientAt?.toISOString() ?? null,
      },
      newlyPublished: result.newlyPublished,
      transition: {
        from: result.transition.from,
        to: result.transition.to,
        possession: result.transition.possession,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
