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

    const inserted = await tx
      .insert(comments)
      .values({
        cardId: input.cardId,
        authorContactId: actor.kind === 'client' ? actor.contactId : null,
        authorUserId: actor.kind === 'agency' ? actor.userId : null,
        body,
        internal: isAgency ? (input.internal ?? false) : false,
        parentId: input.parentId ?? null,
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
    return row;
  });
}
