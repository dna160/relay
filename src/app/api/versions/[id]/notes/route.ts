/**
 * `GET  /api/versions/:id/notes` — the revision thread, backstage.
 * `POST /api/versions/:id/notes` — add one, optionally internal.
 *
 * The `:id` is a *version* id. That is the whole feature: PRD §5.3 says notes
 * thread to the version they were written against and never float forward, and
 * a route keyed on a card id could not have honoured it. It is also what
 * restores the front end's "on v4" label — the version number comes back on
 * every note.
 *
 * Not named in API-CONTRACT.md. The contract has `revision_notes` in the data
 * model and no endpoint over it, which is how the table ended up with a writer
 * and no reader. Flagged for the amendments log.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { loadEngagementDetail } from '@/db/queries/engagements';
import {
  loadAgencyRevisionNotes,
  loadVersionEngagementForOrg,
} from '@/db/queries/revision-notes';
import { addRevisionNote, MAX_NOTE_LENGTH } from '@/domain/revision/add-note';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { notVisible } from '@/domain/errors';
import { toErrorResponse } from '@/lib/errors';
import { requireAgency, type RouteContext } from '../../../_guards';
import { shadowed, shadowedByVersion } from '../../../_shadow';

export async function GET(
  _request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { id } = await context.params;

    // Org-scoped in the predicate: a version on another agency's board is
    // NOT_VISIBLE, and no note row is read before that is settled.
    const target = await shadowedByVersion('GET /api/versions/[id]/notes', session, id, () =>
      loadVersionEngagementForOrg(db, session.orgId, id),
    );
    const notes = await loadAgencyRevisionNotes(db, target.engagementId, id);

    return NextResponse.json({ notes, cardId: target.cardId });
  } catch (error) {
    return toErrorResponse(error);
  }
}

const schema = z
  .object({
    /**
     * Amendment A5 — an agency mutation names its engagement explicitly, so the
     * authorisation check has a subject before any row is read. It is then
     * checked against the version's own engagement rather than trusted.
     */
    engagementId: z.string().uuid(),
    body: z.string().min(1).max(MAX_NOTE_LENGTH),
    /** Agency-only. The client route has no field through which to reach this. */
    internal: z.boolean().optional(),
  })
  .strict();

export async function POST(
  request: Request,
  context: RouteContext<{ id: string }>,
): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const now = new Date();

    const engagement = await shadowed(
      'POST /api/versions/[id]/notes',
      session,
      input.engagementId,
      () => loadEngagementDetail(db, input.engagementId, session.orgId, now),
    );
    assertWritable(engagement);

    const target = await shadowedByVersion(
      'POST /api/versions/[id]/notes',
      session,
      id,
      () => loadVersionEngagementForOrg(db, session.orgId, id),
      'version-belongs-to-engagement',
    );
    if (target.engagementId !== engagement.id) throw notVisible('Version not found');

    const note = await addRevisionNote(
      db,
      {
        versionId: id,
        engagementId: engagement.id,
        actor: { kind: 'agency', userId: session.userId },
        body: input.body,
        ...(input.internal === undefined ? {} : { internal: input.internal }),
      },
      now,
    );

    return NextResponse.json(
      {
        note: {
          id: note.id,
          versionId: note.assetVersionId,
          body: note.body,
          internal: note.internal,
          side: 'agency' as const,
          authorName: note.authorName,
          authorUserId: note.authorUserId,
          authorContactId: note.authorContactId,
          createdAt: note.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
