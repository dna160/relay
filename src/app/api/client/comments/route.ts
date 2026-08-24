/**
 * `POST /api/client/comments` — discussion on a card the contact can see.
 *
 * Takes a card id, never an engagement id: the engagement comes from the
 * session (INV-6), and the card is resolved through `clientScope()`, so a card
 * on a private lane is 404 rather than 403.
 *
 * A client comment is never internal. That is not a flag this route clears —
 * `postComment` cannot mark a client-authored comment internal at all.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import {
  loadClientEngagementHeader,
  loadClientVisibleCardId,
} from '@/db/queries/client-board';
import { clientScope } from '@/db/queries/client-scope';
import { postComment } from '@/domain/comment/post-comment';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { toErrorResponse } from '@/lib/errors';
import { publishEvent } from '@/lib/sse';
import { requireClient } from '../../_guards';

const schema = z
  .object({
    cardId: z.string().uuid(),
    body: z.string().min(1).max(20_000),
    parentId: z.string().uuid().nullish(),
  })
  .strict();

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await requireClient();
    const scope = clientScope(session);
    const input = schema.parse(await request.json());
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

    const cardId = await loadClientVisibleCardId(db, scope, input.cardId);

    const comment = await postComment(
      db,
      {
        cardId,
        engagementId: scope.engagementId,
        actor: { kind: 'client', contactId: scope.contactId },
        body: input.body,
        parentId: input.parentId ?? null,
      },
      now,
    );

    await publishEvent(db, {
      engagementId: scope.engagementId,
      cardId: comment.cardId,
      versionId: null,
      event: { type: 'comment.created', cardId: comment.cardId, commentId: comment.id },
    });

    return NextResponse.json(
      {
        comment: {
          id: comment.id,
          cardId: comment.cardId,
          body: comment.body,
          parentId: comment.parentId,
          createdAt: comment.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
