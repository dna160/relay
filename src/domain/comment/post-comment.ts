/**
 * Card-level discussion. This is what replaces the chat surface (ADR-011):
 * discussion attaches to the thing being discussed, so the "yeah just go ahead"
 * that gets disputed later is attached to a card rather than lost in a room.
 *
 * `internal` is agency-only and is never settable from a client session.
 */

import { and, eq } from 'drizzle-orm';
import { cards, comments } from '@/db/schema';
import type { Database } from '@/db/types';
import { authorNameFor } from '../actor-name';
import type { Actor } from '../card/state-machine';
import { bumpActivity } from '../engagement/lifecycle';
import { notVisible, validationFailed } from '../errors';

export interface PostCommentInput {
  cardId: string;
  engagementId: string;
  actor: Actor;
  body: string;
  parentId?: string | null;
  /** Ignored for client actors — structurally, not conditionally. */
  internal?: boolean;
}

export interface CommentRecord {
  id: string;
  cardId: string;
  body: string;
  internal: boolean;
  parentId: string | null;
  createdAt: Date;
  authorContactId: string | null;
  authorUserId: string | null;
  /**
   * The author's display name, resolved in the same transaction that wrote the
   * row, so the POST response and the GET response are the same shape. A thread
   * whose newest entry is missing a name until the page refreshes is a thread
   * that looks broken.
   */
  authorName: string | null;
}

export async function postComment(
  db: Database,
  input: PostCommentInput,
  now: Date,
): Promise<CommentRecord> {
  const body = input.body.trim();
  if (body.length === 0) throw validationFailed('A comment needs a body');

  return db.transaction(async (tx) => {
    const card = await tx
      .select({ id: cards.id })
      .from(cards)
      .where(and(eq(cards.id, input.cardId), eq(cards.engagementId, input.engagementId)))
      .limit(1);
    if (!card[0]) throw notVisible('Card not found');

    const actor = input.actor;
    const isAgency = actor.kind === 'agency';

    /**
     * A reply has to be a reply to something on *this* card, and the thread is
     * one level deep.
     *
     * The column is a bare self-reference, so before this check `parentId`
     * accepted any comment id in the database: a reply could be grafted onto
     * another card, another engagement, or an internal comment the author was
     * never shown. The reader emits `parentId`, so a graft is not a private
     * mistake — it is a row that renders under a thread it does not belong to.
     *
     * One level is enforced here rather than in the renderer because "the front
     * end can draw one level of reply from a flat list" is only true if the
     * data cannot be deeper than that.
     */
    const parentId = input.parentId ?? null;
    let parentInternal = false;
    if (parentId !== null) {
      const parent = await tx
        .select({
          id: comments.id,
          parentId: comments.parentId,
          internal: comments.internal,
        })
        .from(comments)
        .where(and(eq(comments.id, parentId), eq(comments.cardId, input.cardId)))
        .limit(1);

      const row = parent[0];
      // 404 rather than a message distinguishing "no such comment" from "on
      // another card" — a client contact must not be able to probe either.
      if (!row) throw notVisible('Comment not found');
      if (!isAgency && row.internal) throw notVisible('Comment not found');
      if (row.parentId !== null) {
        throw validationFailed('Replies are one level deep. Reply to the first comment instead.');
      }
      parentInternal = row.internal;
    }

    const inserted = await tx
      .insert(comments)
      .values({
        cardId: input.cardId,
        authorContactId: actor.kind === 'client' ? actor.contactId : null,
        authorUserId: actor.kind === 'agency' ? actor.userId : null,
        body,
        // A reply under an internal root is internal whatever the caller asked
        // for. The client read drops that whole thread in SQL; letting a reply
        // opt out of it would put half an internal conversation on the client's
        // screen with its root missing.
        internal: isAgency ? (parentInternal || (input.internal ?? false)) : false,
        parentId,
        createdAt: now,
      })
      .returning({
        id: comments.id,
        cardId: comments.cardId,
        body: comments.body,
        internal: comments.internal,
        parentId: comments.parentId,
        createdAt: comments.createdAt,
        authorContactId: comments.authorContactId,
        authorUserId: comments.authorUserId,
      });

    const row = inserted[0];
    if (!row) throw new Error('comment insert returned no row');

    await bumpActivity(tx, input.engagementId, now);
    return { ...row, authorName: await authorNameFor(tx, actor) };
  });
}
