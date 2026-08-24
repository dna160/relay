/**
 * `GET  /api/client/comments?cardId=` — the discussion on a card, as the
 *   contact sees it.
 * `POST /api/client/comments` — the contact adds to it.
 *
 * Takes a card id, never an engagement id: the engagement comes from the
 * session (INV-6), and the card is resolved through `clientScope()`, so a card
 * on a private lane is 404 rather than 403.
 *
 * The GET shipped a round late. The route was write-only, which meant the
 * client surface could offer a contact a box to type into and no way to ever
 * read back what they had written — the front end deleted the thread rather
 * than ship that, and was right to.
 *
 * Visibility is decided by `loadClientVisibleCardId()`, the same predicate the
 * POST below already writes behind and the same one the board uses. It is
 * enumerated and covered in `tests/invariants/visibility.spec.ts`. Nothing new
 * here takes a `ClientScope`: the read that follows it is narrowed by the
 * engagement and refuses internal rows, and the decision about *which cards
 * exist* stays in one place.
 *
 * A client comment is never internal. That is not a flag this route clears —
 * `postComment` cannot mark a client-authored comment internal at all, and the
 * read filters `internal = false`, root and reply both, in SQL.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import {
  loadClientEngagementHeader,
  loadClientVisibleCardId,
} from '@/db/queries/client-board';
import { loadClientVisibleComments } from '@/db/queries/comments';
import { clientScope } from '@/db/queries/client-scope';
import { postComment } from '@/domain/comment/post-comment';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { toErrorResponse } from '@/lib/errors';
import { publishEvent } from '@/lib/sse';
import { requireClient } from '../../_guards';

const querySchema = z.object({ cardId: z.string().uuid() });

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const scope = clientScope(await requireClient());
    const { searchParams } = new URL(request.url);
    const { cardId } = querySchema.parse({ cardId: searchParams.get('cardId') ?? undefined });

    const resolved = await loadClientVisibleCardId(db, scope, cardId);
    const comments = await loadClientVisibleComments(db, scope.engagementId, resolved);

    return NextResponse.json(
      { comments, cardId: resolved },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

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
          // Shape parity with the GET above, minus `authorName`: the caller is
          // the contact, and their own display name is already on the board
          // header. A `comment.created` frame follows this response anyway, so
          // the authoritative row arrives on the next read either way.
          side: 'client' as const,
          createdAt: comment.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
