/**
 * The backstage board read. Agency sessions only — nothing in this file is
 * reachable by a client contact, which is why none of it calls `clientScope()`.
 * The client's board lives in `client-board.ts` and shares the same rows.
 *
 * The board is the *live* board (ADR-026): archived lanes and archived cards
 * are excluded here, in SQL, rather than filtered by whoever renders it. What
 * has been removed is read by `loadArchivedBoard()` below, which is a different
 * screen answering a different question.
 */

import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { assetVersions, cards, lanes, stateTransitions, users } from '@/db/schema';
import type { Executor } from '@/db/types';
import type { AgencyLane } from '@/lib/types';
import { toAgencyBoard, type AgencyVersionRow } from '@/domain/projection/agency-view';
import type { CardRow, LaneRow } from '@/domain/projection/client-view';
import type { TransitionRow } from '@/domain/card/possession';

export async function loadAgencyBoard(
  exec: Executor,
  engagementId: string,
  now: Date,
): Promise<AgencyLane[]> {
  const laneRows: LaneRow[] = await exec
    .select({
      id: lanes.id,
      name: lanes.name,
      position: lanes.position,
      visibility: lanes.visibility,
      archivedAt: lanes.archivedAt,
    })
    .from(lanes)
    .where(and(eq(lanes.engagementId, engagementId), isNull(lanes.archivedAt)));

  const cardRows: CardRow[] = await exec
    .select({
      id: cards.id,
      laneId: cards.laneId,
      title: cards.title,
      description: cards.description,
      state: cards.state,
      position: cards.position,
      dueAt: cards.dueAt,
      roundsUsed: cards.roundsUsed,
      contractedRounds: cards.contractedRounds,
      visibilityOverride: cards.visibilityOverride,
      assigneeId: cards.assigneeId,
      internalNotes: cards.internalNotes,
      effortEstimate: cards.effortEstimate,
      archivedAt: cards.archivedAt,
    })
    .from(cards)
    .where(and(eq(cards.engagementId, engagementId), isNull(cards.archivedAt)));

  if (cardRows.length === 0) {
    return toAgencyBoard({
      lanes: laneRows,
      cards: [],
      versions: [],
      transitions: [],
      assignees: [],
      now,
    });
  }

  const cardIds = cardRows.map((c) => c.id);

  const versionRows: AgencyVersionRow[] = await exec
    .select({
      id: assetVersions.id,
      cardId: assetVersions.cardId,
      versionNo: assetVersions.versionNo,
      filename: assetVersions.filename,
      mime: assetVersions.mime,
      sizeBytes: assetVersions.sizeBytes,
      sha256: assetVersions.sha256,
      uploadedByUserId: assetVersions.uploadedByUserId,
      publishedToClientAt: assetVersions.publishedToClientAt,
      supersededBy: assetVersions.supersededBy,
    })
    .from(assetVersions)
    .where(inArray(assetVersions.cardId, cardIds));

  const transitionRows: TransitionRow[] = await exec
    .select({
      cardId: stateTransitions.cardId,
      toState: stateTransitions.toState,
      possession: stateTransitions.possession,
      occurredAt: stateTransitions.occurredAt,
    })
    .from(stateTransitions)
    .where(inArray(stateTransitions.cardId, cardIds));

  const assigneeIds = [
    ...new Set(cardRows.map((c) => c.assigneeId).filter((id): id is string => id !== null)),
  ];
  const assignees =
    assigneeIds.length === 0
      ? []
      : await exec
          // `email` is the fallback for an invited colleague who has not set a
          // name — see `AssigneeRow`. Agency reads only; the client projection
          // has no `assignee` field to put it in.
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, assigneeIds));

  return toAgencyBoard({
    lanes: laneRows,
    cards: cardRows,
    versions: versionRows,
    transitions: transitionRows,
    assignees,
    now,
  });
}

/* --------------------------------------------------------------- the archive */

export interface ArchivedLane {
  id: string;
  name: string;
  position: number;
  archivedAt: string;
  archivedByName: string | null;
  /** Cards standing in it, which come back exactly as they were on restore. */
  cardsHidden: number;
}

export interface ArchivedCard {
  id: string;
  laneId: string;
  laneName: string;
  title: string;
  state: string;
  archivedAt: string;
  archivedByName: string | null;
  /**
   * What archiving kept. This is the number that makes the design legible in
   * the UI: it is precisely the reason the card was archived instead of
   * deleted, and it is the count of immutable rows a hard delete would have
   * taken with it (ADR-026).
   */
  versionCount: number;
}

export interface ArchivedBoard {
  lanes: ArchivedLane[];
  cards: ArchivedCard[];
}

/**
 * AGENCY-ONLY. What has been removed from this board and can be restored.
 *
 * A card sitting in an archived lane is *not* listed here: it is not archived,
 * it is hidden by its lane, and restoring the lane brings it back. Listing it
 * as archived would offer a restore that does nothing visible, which is the
 * kind of affordance that teaches people the undo is broken.
 */
export async function loadArchivedBoard(
  exec: Executor,
  engagementId: string,
): Promise<ArchivedBoard> {
  const laneRows = await exec
    .select({
      id: lanes.id,
      name: lanes.name,
      position: lanes.position,
      archivedAt: lanes.archivedAt,
      archivedByName: users.name,
      cardsHidden: sql<number>`(select count(*) from ${cards} where ${cards.laneId} = ${lanes.id})`,
    })
    .from(lanes)
    .leftJoin(users, eq(users.id, lanes.archivedByUserId))
    .where(and(eq(lanes.engagementId, engagementId), isNotNull(lanes.archivedAt)))
    .orderBy(lanes.position);

  const cardRows = await exec
    .select({
      id: cards.id,
      laneId: cards.laneId,
      laneName: lanes.name,
      title: cards.title,
      state: cards.state,
      archivedAt: cards.archivedAt,
      archivedByName: users.name,
      versionCount: sql<number>`(select count(*) from ${assetVersions} where ${assetVersions.cardId} = ${cards.id})`,
    })
    .from(cards)
    .innerJoin(lanes, eq(lanes.id, cards.laneId))
    .leftJoin(users, eq(users.id, cards.archivedByUserId))
    .where(and(eq(cards.engagementId, engagementId), isNotNull(cards.archivedAt)))
    .orderBy(desc(cards.archivedAt));

  return {
    lanes: laneRows.map((l) => ({
      id: l.id,
      name: l.name,
      position: l.position,
      // `isNotNull` in the predicate is the proof; the fallback exists because
      // drizzle types the column, not the predicate.
      archivedAt: (l.archivedAt ?? new Date(0)).toISOString(),
      archivedByName: l.archivedByName,
      cardsHidden: Number(l.cardsHidden),
    })),
    cards: cardRows.map((c) => ({
      id: c.id,
      laneId: c.laneId,
      laneName: c.laneName,
      title: c.title,
      state: c.state,
      archivedAt: (c.archivedAt ?? new Date(0)).toISOString(),
      archivedByName: c.archivedByName,
      versionCount: Number(c.versionCount),
    })),
  };
}

/** Confirms a card belongs to the engagement the caller is scoped to. */
export async function cardBelongsToEngagement(
  exec: Executor,
  cardId: string,
  engagementId: string,
): Promise<boolean> {
  const rows = await exec
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.engagementId, engagementId)))
    .limit(1);
  return rows[0] !== undefined;
}
