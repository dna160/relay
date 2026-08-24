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
import { loadClientDecidableVersion } from '@/db/queries/client-board';
import { clientScope } from '@/db/queries/client-scope';
import { recordDecision } from '@/domain/approval/record-decision';
import { toErrorResponse } from '@/lib/errors';
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
