/**
 * The only serialiser a client contact ever reaches. (INV-1)
 *
 * Internal fields are absent from the return type, not conditionally omitted.
 * If a future field must stay agency-side, add it to the source row type and
 * simply never reference it here — the compiler then makes leaking it a type
 * error rather than a review question.
 */

import {
  AGENCY_ONLY_STATES,
  CLIENT_STATE_ALIAS,
  isAwaitingClient,
  type CardState,
} from '../card/state-machine';

export interface LaneRow {
  id: string;
  name: string;
  position: number;
  visibility: 'published' | 'private';
}

export interface CardRow {
  id: string;
  laneId: string;
  title: string;
  description: string | null;
  state: CardState;
  position: number;
  dueAt: Date | null;
  roundsUsed: number;
  contractedRounds: number | null;
  visibilityOverride: 'inherit' | 'private';
  // Agency-only below. Never referenced in this file.
  assigneeId: string | null;
  internalNotes: string | null;
  effortEstimate: number | null;
}

export interface VersionRow {
  id: string;
  cardId: string;
  versionNo: number;
  filename: string;
  sizeBytes: number;
  sha256: string;
  publishedToClientAt: Date | null;
}

export interface ClientVersion {
  id: string;
  versionNo: number;
  filename: string;
  sizeBytes: number;
  sha256: string;
  publishedAt: string;
}

export interface ClientCard {
  id: string;
  laneId: string;
  title: string;
  description: string | null;
  state: Exclude<CardState, 'draft' | 'internal_review'>;
  dueAt: string | null;
  position: number;
  roundsUsed: number;
  contractedRounds: number | null;
  versions: ClientVersion[];
  awaitingYou: boolean;
}

export interface ClientLane {
  id: string;
  name: string;
  position: number;
  cards: ClientCard[];
}

export function isLaneVisibleToClient(lane: LaneRow): boolean {
  return lane.visibility === 'published';
}

export function isCardVisibleToClient(card: CardRow, lane: LaneRow): boolean {
  if (!isLaneVisibleToClient(lane)) return false;
  if (card.visibilityOverride === 'private') return false;
  if (AGENCY_ONLY_STATES.has(card.state)) return false;
  return true;
}

function toClientVersion(v: VersionRow): ClientVersion {
  // Non-null asserted only after the publish filter below.
  return {
    id: v.id,
    versionNo: v.versionNo,
    filename: v.filename,
    sizeBytes: v.sizeBytes,
    sha256: v.sha256,
    publishedAt: v.publishedToClientAt!.toISOString(),
  };
}

export function toClientCard(card: CardRow, versions: VersionRow[]): ClientCard {
  const aliased = (CLIENT_STATE_ALIAS[card.state] ?? card.state) as ClientCard['state'];
  return {
    id: card.id,
    laneId: card.laneId,
    title: card.title,
    description: card.description,
    state: aliased,
    dueAt: card.dueAt?.toISOString() ?? null,
    position: card.position,
    roundsUsed: card.roundsUsed,
    contractedRounds: card.contractedRounds,
    versions: versions
      .filter((v) => v.cardId === card.id && v.publishedToClientAt !== null)
      .sort((a, b) => b.versionNo - a.versionNo)
      .map(toClientVersion),
    awaitingYou: isAwaitingClient(card.state),
  };
}

/** Entry point for every client-facing board read. */
export function toClientBoard(
  lanes: LaneRow[],
  cards: CardRow[],
  versions: VersionRow[],
): ClientLane[] {
  const laneById = new Map(lanes.map((l) => [l.id, l]));
  return lanes
    .filter(isLaneVisibleToClient)
    .sort((a, b) => a.position - b.position)
    .map((lane) => ({
      id: lane.id,
      name: lane.name,
      position: lane.position,
      cards: cards
        .filter((c) => c.laneId === lane.id)
        .filter((c) => isCardVisibleToClient(c, laneById.get(c.laneId)!))
        .sort((a, b) => a.position - b.position)
        .map((c) => toClientCard(c, versions)),
    }));
}
