/**
 * Taking a card or a lane off the board (ADR-026).
 *
 * The whole of removal lives in this one file so that the argument for it can
 * be read in one place, because the argument is the design.
 *
 * ## Why `DELETE FROM cards` is not the primitive
 *
 * A card is the parent of the evidence. `asset_versions.card_id`,
 * `comments.card_id` and `state_transitions.card_id` are all `ON DELETE
 * CASCADE`, and `approvals.asset_version_id` cascades again behind the
 * versions. So one `DELETE FROM cards` destroys, in order: the immutable
 * versions INV-4 says are append-only and deletable only by the purge worker,
 * the approvals INV-3 says bind a version and its sha256 so that "approved"
 * survives a dispute six months later, and the possession ledger INV-5 says is
 * the sole source of the clock. A lane is worse: `cards.lane_id` cascades too,
 * so deleting a column deletes every card standing in it and everything
 * underneath them.
 *
 * INV-7 gives exactly one path that may destroy an engagement's content, and it
 * ends in a `purge_certificate`. A delete button is not that path.
 *
 * ## The two operations, and the rule that picks between them
 *
 * **Discard** is a real `DELETE`, and it is permitted only when the cascade has
 * nothing to cascade to: no versions, no transitions, no comments. That is not
 * a heuristic standing in for "this card is unimportant" — it is the literal
 * statement that deleting this row destroys no other row. A card in that state
 * is a typo or a mis-drag, and it is the case the product owner is actually
 * complaining about.
 *
 * **Archive** is everything else. `archived_at` is set, the card leaves both
 * boards and the attention list, and every version, approval, transition and
 * comment stays exactly where it was.
 *
 * The caller does not choose. `removeCard()` takes the least destructive
 * mechanism that satisfies the request and reports which one it used, because
 * "which of these two things happens" is a question about the database that the
 * person clicking the button cannot answer and should not be asked.
 *
 * ## "Has the client seen it?" is answered by INV-5's own table
 *
 * A card that has never left `draft` has never been visible to a client — the
 * client scope excludes `draft`, and INV-2 says a card leaves `draft` only
 * through the state machine, which INV-5 says always writes a
 * `state_transitions` row. So *zero transitions* is a sound proof of *never
 * seen*, derived from the ledger that already exists rather than from a new
 * `seen_by_client_at` column that something would have to remember to write.
 *
 * The converse is not claimed and does not need to be: a card that has moved
 * *might* have been seen, and "might" is enough to require archiving.
 *
 * ## What this file never does
 *
 * It never writes `cards.state` (INV-2) — archived is orthogonal to the machine
 * and the word `state` does not appear in a write position anywhere below. It
 * never deletes an `asset_version` or an `approval` (INV-4, INV-7) — it refuses
 * to delete anything that would.
 */

import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { assetVersions, auditLog, cards, comments, lanes, stateTransitions } from '@/db/schema';
import type { Database, Executor } from '@/db/types';
import { notVisible } from '../errors';

/**
 * Who is removing what, from where.
 *
 * `orgId` is here for the audit row rather than for permission: the route has
 * already resolved the engagement against the session, and a second scoping
 * decision in this file would be a second place that can be wrong about it.
 */
export interface RemovalActor {
  readonly engagementId: string;
  readonly orgId: string;
  readonly actorUserId: string;
}

/**
 * What actually happened. Returned rather than assumed, so the surface can
 * offer an undo for one and not for the other — an "Undo" on a row that no
 * longer exists is the worst affordance in this whole feature.
 */
export type RemovalKind = 'discarded' | 'archived';

export interface CardRemoval {
  readonly kind: RemovalKind;
  readonly cardId: string;
  /** Null when discarded. There is nothing left to have a timestamp. */
  readonly archivedAt: Date | null;
  /** Why archiving was necessary. Empty when discarded. */
  readonly kept: CardDependents;
}

export interface LaneRemoval {
  readonly kind: RemovalKind;
  readonly laneId: string;
  readonly archivedAt: Date | null;
  /**
   * Cards hidden along with the lane. Zero on a discard, by definition — a lane
   * is only ever discarded when it holds none.
   */
  readonly cardsHidden: number;
}

/** Every row that would be destroyed by deleting this card, counted. */
export interface CardDependents {
  readonly versions: number;
  readonly transitions: number;
  readonly comments: number;
}

function carriesNothing(d: CardDependents): boolean {
  return d.versions === 0 && d.transitions === 0 && d.comments === 0;
}

/**
 * The three tables with a foreign key to `cards`, counted in one round trip.
 *
 * Approvals and revision notes are absent on purpose and are still covered:
 * both hang off `asset_versions`, so a card with no versions has neither, and a
 * card with versions is archived rather than deleted regardless of what those
 * versions carry. Counting them as well would suggest there is a case where a
 * version exists and its approvals are the deciding fact. There is not.
 *
 * If a fourth table ever references `cards`, it belongs here. That is the one
 * maintenance obligation this design creates, and it is stated on the function
 * rather than left to be discovered by a cascade in production.
 */
export async function cardDependents(
  exec: Executor,
  cardId: string,
): Promise<CardDependents> {
  const rows = await exec
    .select({
      versions: sql<number>`(select count(*) from ${assetVersions} where ${assetVersions.cardId} = ${cardId})`,
      transitions: sql<number>`(select count(*) from ${stateTransitions} where ${stateTransitions.cardId} = ${cardId})`,
      comments: sql<number>`(select count(*) from ${comments} where ${comments.cardId} = ${cardId})`,
    })
    .from(cards)
    .where(eq(cards.id, cardId))
    .limit(1);

  const row = rows[0];
  if (!row) throw notVisible('Card not found');
  return {
    versions: Number(row.versions),
    transitions: Number(row.transitions),
    comments: Number(row.comments),
  };
}

/**
 * Remove a card: discard it if that destroys nothing, archive it otherwise.
 *
 * One transaction. The dependent count and the delete have to see the same
 * snapshot, or a version that lands between them is destroyed by a delete that
 * was authorised against a card that did not have it yet.
 *
 * `FOR UPDATE` on the card row is what makes that true under concurrency:
 * `POST /api/versions` and `POST /api/cards/:id/transition` both write children
 * of this row, and a read-committed count is a count as of a moment that has
 * already passed by the time the delete runs.
 */
export async function removeCard(
  db: Database,
  actor: RemovalActor,
  cardId: string,
  now: Date,
): Promise<CardRemoval> {
  const { engagementId, orgId, actorUserId } = actor;
  return db.transaction(async (tx) => {
    const locked = await tx
      .select({ id: cards.id, archivedAt: cards.archivedAt })
      .from(cards)
      .where(and(eq(cards.id, cardId), eq(cards.engagementId, engagementId)))
      .for('update')
      .limit(1);

    const card = locked[0];
    if (!card) throw notVisible('Card not found');

    // Already archived. Idempotent rather than an error: the second click of a
    // double-click is not a different intention.
    if (card.archivedAt !== null) {
      return {
        kind: 'archived' as const,
        cardId,
        archivedAt: card.archivedAt,
        kept: await cardDependents(tx, cardId),
      };
    }

    const kept = await cardDependents(tx, cardId);

    const kind: RemovalKind = carriesNothing(kept) ? 'discarded' : 'archived';

    if (kind === 'discarded') {
      await tx
        .delete(cards)
        .where(and(eq(cards.id, cardId), eq(cards.engagementId, engagementId)));
    } else {
      await tx
        .update(cards)
        .set({ archivedAt: now, archivedByUserId: actorUserId, updatedAt: now })
        .where(and(eq(cards.id, cardId), eq(cards.engagementId, engagementId)));
    }

    /**
     * The audit row is written for both outcomes and in the same transaction.
     * A discard leaves no row behind anywhere else, so this is the only record
     * that it ever existed — and it carries the counts the decision was made
     * from, which is what makes "why was this allowed to be deleted?" an
     * answerable question later.
     */
    await tx.insert(auditLog).values({
      orgId,
      engagementId,
      actor: `user:${actorUserId}`,
      action: kind === 'discarded' ? 'card.discarded' : 'card.archived',
      subjectType: 'card',
      subjectId: cardId,
      metadata: { ...kept },
      occurredAt: now,
    });

    return {
      kind,
      cardId,
      archivedAt: kind === 'discarded' ? null : now,
      kept,
    };
  });
}

export interface RestoredCard {
  readonly cardId: string;
  /**
   * True when the card came back into a lane that is itself archived, so the
   * board still will not show it. Reported rather than silently fixed:
   * un-archiving a whole column because someone restored one card in it is a
   * larger action than the one that was asked for.
   */
  readonly laneIsArchived: boolean;
}

export async function restoreCard(
  db: Database,
  actor: RemovalActor,
  cardId: string,
  now: Date,
): Promise<RestoredCard> {
  const { engagementId, orgId, actorUserId } = actor;
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(cards)
      .set({ archivedAt: null, archivedByUserId: null, updatedAt: now })
      .where(and(eq(cards.id, cardId), eq(cards.engagementId, engagementId)))
      .returning({ id: cards.id, laneId: cards.laneId });

    const row = updated[0];
    if (!row) throw notVisible('Card not found');

    const lane = await tx
      .select({ archivedAt: lanes.archivedAt })
      .from(lanes)
      .where(eq(lanes.id, row.laneId))
      .limit(1);

    await tx.insert(auditLog).values({
      orgId,
      engagementId,
      actor: `user:${actorUserId}`,
      action: 'card.restored',
      subjectType: 'card',
      subjectId: cardId,
      occurredAt: now,
    });

    return { cardId: row.id, laneIsArchived: lane[0]?.archivedAt != null };
  });
}

/**
 * Remove a lane: discard it if it holds no cards at all, archive it otherwise.
 *
 * "No cards at all" counts archived ones too. A lane holding an archived card
 * looks empty on the board and is not empty in the database, and deleting it
 * would cascade straight through that card into the versions and approvals this
 * whole design exists to keep. The one place the archive could have opened a
 * hole is the one place it is closed explicitly.
 *
 * Archiving a lane hides its cards without touching a single card row — the
 * same shape `visibility = 'private'` already has, where the lane is the thing
 * that decides and the cards underneath are untouched. That is what makes
 * restoring a lane exact: the cards come back where they were, in the order
 * they were, because nothing about them ever moved.
 */
export async function removeLane(
  db: Database,
  actor: RemovalActor,
  laneId: string,
  now: Date,
): Promise<LaneRemoval> {
  const { engagementId, orgId, actorUserId } = actor;
  return db.transaction(async (tx) => {
    const locked = await tx
      .select({ id: lanes.id, archivedAt: lanes.archivedAt })
      .from(lanes)
      .where(and(eq(lanes.id, laneId), eq(lanes.engagementId, engagementId)))
      .for('update')
      .limit(1);

    const lane = locked[0];
    if (!lane) throw notVisible('Lane not found');

    const occupancy = await tx
      .select({ total: count() })
      .from(cards)
      .where(and(eq(cards.laneId, laneId), eq(cards.engagementId, engagementId)));
    const total = occupancy[0]?.total ?? 0;

    if (lane.archivedAt !== null) {
      return { kind: 'archived' as const, laneId, archivedAt: lane.archivedAt, cardsHidden: total };
    }

    const kind: RemovalKind = total === 0 ? 'discarded' : 'archived';

    if (kind === 'discarded') {
      await tx
        .delete(lanes)
        .where(and(eq(lanes.id, laneId), eq(lanes.engagementId, engagementId)));
    } else {
      await tx
        .update(lanes)
        .set({ archivedAt: now, archivedByUserId: actorUserId })
        .where(and(eq(lanes.id, laneId), eq(lanes.engagementId, engagementId)));
    }

    await tx.insert(auditLog).values({
      orgId,
      engagementId,
      actor: `user:${actorUserId}`,
      action: kind === 'discarded' ? 'lane.discarded' : 'lane.archived',
      subjectType: 'lane',
      subjectId: laneId,
      metadata: { cards: total },
      occurredAt: now,
    });

    return {
      kind,
      laneId,
      archivedAt: kind === 'discarded' ? null : now,
      cardsHidden: total,
    };
  });
}

export interface RestoredLane {
  readonly laneId: string;
  /** Cards that come back with it — the ones not separately archived. */
  readonly cardsRestored: number;
}

export async function restoreLane(
  db: Database,
  actor: RemovalActor,
  laneId: string,
  now: Date,
): Promise<RestoredLane> {
  const { engagementId, orgId, actorUserId } = actor;
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(lanes)
      .set({ archivedAt: null, archivedByUserId: null })
      .where(and(eq(lanes.id, laneId), eq(lanes.engagementId, engagementId)))
      .returning({ id: lanes.id });

    const row = updated[0];
    if (!row) throw notVisible('Lane not found');

    const live = await tx
      .select({ total: count() })
      .from(cards)
      .where(
        and(
          eq(cards.laneId, laneId),
          eq(cards.engagementId, engagementId),
          isNull(cards.archivedAt),
        ),
      );

    await tx.insert(auditLog).values({
      orgId,
      engagementId,
      actor: `user:${actorUserId}`,
      action: 'lane.restored',
      subjectType: 'lane',
      subjectId: laneId,
      occurredAt: now,
    });

    return { laneId: row.id, cardsRestored: live[0]?.total ?? 0 };
  });
}
