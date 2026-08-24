/**
 * `POST /api/client/versions/:id/decision` — approve, or request changes.
 *
 * The `:id` is a *version* id, not an engagement id. The engagement comes from
 * the session (INV-6), and the version is resolved through `clientScope()`, so
 * a version belonging to another engagement is 404 `NOT_VISIBLE` rather than
 * 403 — a 403 would confirm that it exists.
 *
 * `changes_requested` without a note is 400 and writes nothing.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import {
  loadClientDecidableVersion,
  loadClientEngagementHeader,
} from '@/db/queries/client-board';
import { clientScope } from '@/db/queries/client-scope';
import { recordDecision } from '@/domain/approval/record-decision';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { toErrorResponse } from '@/lib/errors';
import { publishEvent } from '@/lib/sse';
import { requireClient, requestOrigin, type RouteContext } from '../../../../_guards';

const schema = z
  .object({
    decision: z.enum(['approved', 'changes_requested']),
    note: z.string().max(20_000).optional(),
  })
  .strict();

export async function POST(
  request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireClient();
    const scope = clientScope(session);
    const { id } = await context.params;
    const body = schema.parse(await request.json());
    const { ip, userAgent } = requestOrigin(request);
    const now = new Date();

    /**
     * Read-only means read-only for the client too. The status comes from
     * `loadClientEngagementHeader()` — the board header's own read, already
     * enumerated and covered in `visibility.spec.ts` — rather than from a
     * second scoped query written for this one check. B6 put `status` on that
     * header so the surface can disable the control first; this is the half
     * that has to be true regardless of what the surface did.
     */
    assertWritable(await loadClientEngagementHeader(db, scope, now));

    // Resolved through the same visibility predicate as the board, so an
    // unpublished or private version is a 404 before any write is attempted.
    const target = await loadClientDecidableVersion(db, scope, id);

    const result = await recordDecision(
      db,
      {
        versionId: target.versionId,
        engagementId: scope.engagementId,
        actor: { kind: 'client', contactId: scope.contactId },
        decision: body.decision,
        note: body.note ?? null,
        ip,
        userAgent,
      },
      now,
    );

    /**
     * The agency's boards are the audience here — this is the moment they have
     * been waiting on. The client's own board picks the same events up through
     * `GET /api/client/events`, filtered through the board's predicate.
     */
    await publishEvent(db, {
      engagementId: scope.engagementId,
      cardId: result.transition.cardId,
      versionId: target.versionId,
      event: {
        type: 'decision.recorded',
        versionId: target.versionId,
        decision: result.approval.decision,
      },
    });
    await publishEvent(db, {
      engagementId: scope.engagementId,
      cardId: result.transition.cardId,
      versionId: null,
      event: {
        type: 'card.transitioned',
        cardId: result.transition.cardId,
        to: result.transition.to,
      },
    });

    return NextResponse.json(
      {
        decision: {
          id: result.approval.id,
          versionId: result.approval.assetVersionId,
          decision: result.approval.decision,
          versionSha256: result.approval.versionSha256,
          decidedAt: result.approval.decidedAt.toISOString(),
        },
        card: {
          id: result.transition.cardId,
          state: result.transition.to,
          roundsUsed: result.roundsUsed,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
