/**
 * `GET  /api/client/versions/:id/notes` — the revision thread the client sees.
 * `POST /api/client/versions/:id/notes` — the client adds one.
 *
 * The `:id` is a *version* id and the engagement comes from the session
 * (INV-6). There is no `engagementId` on this route — not in the path, the
 * query string, or the body — and there is nothing for a future edit to
 * remember to remove: the client scope is built from the cookie and cannot be
 * constructed from a request at all.
 *
 * Visibility is decided by `loadClientDecidableVersion()`, the board's own
 * version predicate, which is enumerated and covered in
 * `tests/invariants/visibility.spec.ts`. An unpublished version, a version on a
 * private lane, a version on a draft card, or a version belonging to another
 * engagement is a 404 before a single note row is read — and the same call
 * happens before the write, so it is one predicate rather than two that have to
 * agree.
 *
 * A client note is never internal. That is not a flag this route clears:
 * `addRevisionNote` cannot mark a client-authored note internal at all, the
 * schema is `.strict()` so sending the field is a 400, and the read filters
 * `internal = false` in SQL.
 *
 * This is deliberately not the same surface as `POST /api/client/comments`. A
 * comment is card-level discussion (ADR-011); a revision note binds to one
 * immutable version and is what an approval argument is made of.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import {
  loadClientDecidableVersion,
  loadClientEngagementHeader,
} from '@/db/queries/client-board';
import { loadClientVisibleNotes } from '@/db/queries/revision-notes';
import { clientScope } from '@/db/queries/client-scope';
import { addRevisionNote, MAX_NOTE_LENGTH } from '@/domain/revision/add-note';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { toErrorResponse } from '@/lib/errors';
import { publishEvent } from '@/lib/sse';
import { requireClient, type RouteContext } from '../../../../_guards';

export async function GET(
  _request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const scope = clientScope(await requireClient());
    const { id } = await context.params;

    const target = await loadClientDecidableVersion(db, scope, id);
    const notes = await loadClientVisibleNotes(db, scope.engagementId, target.versionId);

    return NextResponse.json({ notes, cardId: target.cardId });
  } catch (error) {
    return toErrorResponse(error);
  }
}

const schema = z.object({ body: z.string().min(1).max(MAX_NOTE_LENGTH) }).strict();

export async function POST(
  request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const scope = clientScope(await requireClient());
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const now = new Date();

    // 423 before the write, not after it. B6 put the same `status` on the board
    // header so the surface can render the control read-only; this is the check
    // that has to hold regardless of what the surface did.
    assertWritable(await loadClientEngagementHeader(db, scope, now));

    const target = await loadClientDecidableVersion(db, scope, id);

    const note = await addRevisionNote(
      db,
      {
        versionId: target.versionId,
        engagementId: scope.engagementId,
        actor: { kind: 'client', contactId: scope.contactId },
        body: input.body,
      },
      now,
    );

    await publishEvent(db, {
      engagementId: scope.engagementId,
      cardId: target.cardId,
      versionId: target.versionId,
      /**
       * `ServerEvent` has no note variant and this file does not get to invent
       * one — that type is owned by the architecture layer. A note is a change
       * to the card's thread, and `comment.created` is the event both surfaces
       * already treat as "re-read this card". Raised for the contract owner.
       */
      event: { type: 'comment.created', cardId: target.cardId, commentId: note.id },
    });

    return NextResponse.json(
      {
        note: {
          id: note.id,
          versionId: note.assetVersionId,
          body: note.body,
          side: 'client' as const,
          // A name, never an id and never an email (INV-1) — the same rule the
          // read applies, applied to the row the client just wrote.
          authorName: note.authorName,
          createdAt: note.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
