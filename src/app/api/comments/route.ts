/**
 * `GET  /api/comments?cardId=` — the card's discussion, backstage.
 * `POST /api/comments` — the agency adds to it, optionally internal.
 *
 * Card-level discussion is the chat surface's replacement (ADR-011, PRD §7:
 * "Discussion attaches to cards and versions"). This is the agency half of the
 * read; the client half is `GET /api/client/comments`, which never returns an
 * internal row.
 *
 * Keyed on a *card* id and nothing else. The engagement is resolved from the
 * card, org-scoped, by `loadCardEngagementForOrg()` — the route does not learn
 * it from the request, so there is no id in the query string to disagree with
 * the card. A card on another agency's board is `NOT_VISIBLE`, a 404 rather
 * than a 403, before a single comment row is read.
 *
 * The POST is what makes `comments.internal` a real column rather than a
 * decorative one. Until it existed, only `POST /api/client/comments` could
 * write, a client comment can never be internal, and so every defence around
 * internal threads — the parent self-join in the read, the forced-internal
 * reply in `postComment()` — was guarding a set that was empty by construction.
 * A read path with no writer is the kind of half-feature someone completes in
 * six months without having read any of that.
 *
 * Not named in API-CONTRACT.md: the frozen contract has `comments` in the data
 * model and one write endpoint over it. Flagged for the amendments log.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/db/client';
import { loadAgencyComments, loadCardEngagementForOrg } from '@/db/queries/comments';
import { loadEngagementDetail } from '@/db/queries/engagements';
import { postComment } from '@/domain/comment/post-comment';
import { assertWritable } from '@/domain/engagement/lifecycle';
import { notVisible } from '@/domain/errors';
import { toErrorResponse } from '@/lib/errors';
import { publishEvent } from '@/lib/sse';
import { requireAgency } from '../_guards';

const querySchema = z.object({ cardId: z.string().uuid() });

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const { searchParams } = new URL(request.url);
    const { cardId } = querySchema.parse({ cardId: searchParams.get('cardId') ?? undefined });

    const target = await loadCardEngagementForOrg(db, session.orgId, cardId);
    const comments = await loadAgencyComments(db, target.engagementId, target.cardId);

    return NextResponse.json(
      { comments, cardId: target.cardId },
      { headers: { 'cache-control': 'private, no-store' } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

const schema = z
  .object({
    /**
     * Amendment A5 — an agency mutation names its engagement explicitly, so the
     * authorisation check has a subject before any row is read. It is then
     * checked against the card's own engagement rather than trusted.
     */
    engagementId: z.string().uuid(),
    cardId: z.string().uuid(),
    body: z.string().min(1).max(20_000),
    /** A root when absent. `postComment` refuses a reply to a reply. */
    parentId: z.string().uuid().nullish(),
    /** Agency-only. The client route has no field through which to reach this. */
    internal: z.boolean().optional(),
  })
  .strict();

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await requireAgency();
    const input = schema.parse(await request.json());
    const now = new Date();

    const engagement = await loadEngagementDetail(db, input.engagementId, session.orgId, now);
    // 423 before the write. Round 2 found both client mutations missing this
    // (amendment A9); a new writer is exactly where it gets forgotten again.
    assertWritable(engagement);

    const target = await loadCardEngagementForOrg(db, session.orgId, input.cardId);
    if (target.engagementId !== engagement.id) throw notVisible('Card not found');

    const comment = await postComment(
      db,
      {
        cardId: target.cardId,
        engagementId: engagement.id,
        actor: { kind: 'agency', userId: session.userId },
        body: input.body,
        parentId: input.parentId ?? null,
        ...(input.internal === undefined ? {} : { internal: input.internal }),
      },
      now,
    );

    /**
     * An internal comment announces nothing.
     *
     * `GET /api/client/events` filters a frame on whether the contact can see
     * the *card*, which an internal comment's card usually is. The frame
     * carries no body — but its arrival is a signal, and "something was just
     * said about your card" is precisely the fact an internal thread exists to
     * withhold. The agency stream shares the bus, so there is no way to tell
     * one side and not the other; not publishing is the only correct answer
     * until the envelope can carry an audience.
     */
    if (!comment.internal) {
      await publishEvent(db, {
        engagementId: engagement.id,
        cardId: comment.cardId,
        versionId: null,
        event: { type: 'comment.created', cardId: comment.cardId, commentId: comment.id },
      });
    }

    return NextResponse.json(
      {
        comment: {
          id: comment.id,
          cardId: comment.cardId,
          parentId: comment.parentId,
          body: comment.body,
          internal: comment.internal,
          side: 'agency' as const,
          authorName: comment.authorName,
          authorUserId: comment.authorUserId,
          authorContactId: comment.authorContactId,
          createdAt: comment.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
