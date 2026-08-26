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
  /**
   * Removal (ADR-026). Optional because a caller that does not select it is a
   * caller reading a set the SQL already narrowed to live rows — the query
   * layer is the enforcing half here, exactly as it is for lane visibility, and
   * this is the second net.
   */
  archivedAt?: Date | null;
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
  /** Removal (ADR-026). See `LaneRow.archivedAt`. */
  archivedAt?: Date | null;
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
  if (lane.archivedAt != null) return false;
  return lane.visibility === 'published';
}

export function isCardVisibleToClient(card: CardRow, lane: LaneRow): boolean {
  if (!isLaneVisibleToClient(lane)) return false;
  // Archived is checked before the override and before the state, because it is
  // the only one of the three that can be true of a card the client has already
  // approved. ADR-026: removal is orthogonal to the machine.
  if (card.archivedAt != null) return false;
  if (card.visibilityOverride === 'private') return false;
  if (AGENCY_ONLY_STATES.has(card.state)) return false;
  return true;
}

/** A version that has passed the internal gate. The narrowing is the proof. */
type PublishedVersionRow = VersionRow & { publishedToClientAt: Date };

function isPublished(v: VersionRow): v is PublishedVersionRow {
  return v.publishedToClientAt !== null;
}

function toClientVersion(v: PublishedVersionRow): ClientVersion {
  return {
    id: v.id,
    versionNo: v.versionNo,
    filename: v.filename,
    sizeBytes: v.sizeBytes,
    sha256: v.sha256,
    publishedAt: v.publishedToClientAt.toISOString(),
  };
}

/**
 * Raised when a caller asks the client serialiser to emit something the client
 * is not entitled to. It is a programming error, never a user-facing one — the
 * query layer should have filtered it. Crashing beats leaking (INV-1).
 */
export class ClientVisibilityError extends Error {
  readonly code = 'CLIENT_VISIBILITY_VIOLATION';
  constructor(cardId: string, reason: string) {
    super(`Refusing to serialise card ${cardId} for a client: ${reason}`);
  }
}

/**
 * Serialises one card for a client contact.
 *
 * Takes the lane so it can check visibility itself rather than trusting the
 * caller to have done it. `toClientBoard` filters first and this check never
 * fires; the guard exists for the second caller, who will not filter, and who
 * would otherwise emit a draft card carrying a state this function's own
 * return type forbids.
 */
export function toClientCard(card: CardRow, lane: LaneRow, versions: VersionRow[]): ClientCard {
  if (lane.id !== card.laneId) {
    throw new ClientVisibilityError(card.id, `lane ${lane.id} does not own this card`);
  }
  if (!isCardVisibleToClient(card, lane)) {
    throw new ClientVisibilityError(
      card.id,
      lane.archivedAt != null
        ? 'its lane is archived'
        : lane.visibility === 'private'
          ? 'its lane is private'
          : card.archivedAt != null
            ? 'it is archived'
            : card.visibilityOverride === 'private'
              ? 'it is overridden to private'
              : `its state is ${card.state}`,
    );
  }
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
      .filter((v) => v.cardId === card.id)
      .filter(isPublished)
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
  return lanes
    .filter(isLaneVisibleToClient)
    .sort((a, b) => a.position - b.position)
    .map((lane) => ({
      id: lane.id,
      name: lane.name,
      position: lane.position,
      cards: cards
        .filter((c) => c.laneId === lane.id)
        .filter((c) => isCardVisibleToClient(c, lane))
        .sort((a, b) => a.position - b.position)
        .map((c) => toClientCard(c, lane, versions)),
    }));
}
