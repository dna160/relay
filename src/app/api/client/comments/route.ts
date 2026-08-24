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
import { loadClientVisibleCardId } from '@/db/queries/client-board';
import { clientScope } from '@/db/queries/client-scope';
import { postComment } from '@/domain/comment/post-comment';
import { toErrorResponse } from '@/lib/errors';
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
