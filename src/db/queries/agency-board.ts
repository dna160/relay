/**
 * The backstage board read. Agency sessions only — nothing in this file is
 * reachable by a client contact, which is why none of it calls `clientScope()`.
 * The client's board lives in `client-board.ts` and shares the same rows.
 */

import { and, eq, inArray } from 'drizzle-orm';
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
    })
    .from(lanes)
    .where(eq(lanes.engagementId, engagementId));

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
    })
    .from(cards)
    .where(eq(cards.engagementId, engagementId));

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
          .select({ id: users.id, name: users.name })
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
