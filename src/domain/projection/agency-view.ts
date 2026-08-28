/**
 * The backstage serialiser. Its counterpart is `client-view.ts`, which is the
 * only one a client contact ever reaches (INV-1).
 *
 * One card, two projections, no shadow board (ADR-002). Both read the same
 * rows; this one additionally emits assignee, internal notes, effort, the
 * possession split, and versions that have not yet passed the internal gate.
 * Nothing here is conditional on a flag — if a serialiser can emit an internal
 * field at all, sooner or later a bug makes it.
 */

import type {
  AgencyCard,
  AgencyLane,
  AgencyVersion,
  LaneVisibility,
  PossessionSplit,
} from '@/lib/types';
import type { CardRow, LaneRow } from './client-view';
import { computePossession, type TransitionRow } from '../card/possession';

/** The version row as the agency sees it — every column, published or not. */
export interface AgencyVersionRow {
  id: string;
  cardId: string;
  versionNo: number;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  uploadedByUserId: string | null;
  publishedToClientAt: Date | null;
  supersededBy: string | null;
}

export interface AssigneeRow {
  id: string;
  name: string | null;
  /**
   * The fallback when there is no name, and Phase 10 is what made it load-bearing.
   *
   * Before invitations existed, every `users` row was created by somebody
   * onboarding an agency, and a null name was a rarity. An invited colleague has
   * a null name *by construction* — they were invited by address, and there is
   * no surface on which they have yet told us anything else — so `name ?? ''`
   * rendered every newly invited person as a blank chip on the card they had
   * just been assigned. A picker that offers a name and a board that shows none
   * is the same defect the assignee work set out to fix, one step later.
   *
   * Agency-side only. `ClientCard` has no `assignee` field at all — its absence
   * is structural, not conditional (INV-1) — so an address here can never reach
   * a client response.
   *
   * Optional so that a caller with only ids and names still compiles; the
   * fallback then degrades to the empty string it produced before.
   */
  email?: string | null;
}

export interface AgencyBoardInput {
  lanes: readonly LaneRow[];
  cards: readonly CardRow[];
  versions: readonly AgencyVersionRow[];
  transitions: readonly TransitionRow[];
  assignees: readonly AssigneeRow[];
  now: Date;
}

/** A name, or the address, or nothing — never an id, which names nobody. */
function assigneeLabel(assignee: AssigneeRow): string {
  return assignee.name ?? assignee.email ?? '';
}

function toAgencyVersion(v: AgencyVersionRow): AgencyVersion {
  return {
    id: v.id,
    versionNo: v.versionNo,
    filename: v.filename,
    sizeBytes: v.sizeBytes,
    sha256: v.sha256,
    /**
     * `ClientVersion.publishedAt` is non-null by contract. Backstage, an
     * unpublished version is the normal case, so it reports the upload's own
     * publish stamp when there is one and the empty string when there is not —
     * the agency UI keys off `publishedToClientAt`, which carries the truth.
     */
    publishedAt: v.publishedToClientAt?.toISOString() ?? '',
    mime: v.mime,
    uploadedByUserId: v.uploadedByUserId,
    publishedToClientAt: v.publishedToClientAt?.toISOString() ?? null,
    supersededBy: v.supersededBy,
  };
}

export function toAgencyCard(
  card: CardRow,
  versions: readonly AgencyVersionRow[],
  possession: PossessionSplit,
  assignee: AssigneeRow | undefined,
): AgencyCard {
  return {
    id: card.id,
    laneId: card.laneId,
    title: card.title,
    description: card.description,
    state: card.state,
    dueAt: card.dueAt?.toISOString() ?? null,
    position: card.position,
    roundsUsed: card.roundsUsed,
    contractedRounds: card.contractedRounds,
    versions: versions
      .filter((v) => v.cardId === card.id)
      .sort((a, b) => b.versionNo - a.versionNo)
      .map(toAgencyVersion),
    assignee: assignee ? { id: assignee.id, name: assigneeLabel(assignee) } : null,
    internalNotes: card.internalNotes,
    effortEstimate: card.effortEstimate,
    possession,
    visibilityOverride: card.visibilityOverride,
  };
}

/** Entry point for every agency-facing board read. */
export function toAgencyBoard(input: AgencyBoardInput): AgencyLane[] {
  const { lanes, cards, versions, transitions, assignees, now } = input;

  const transitionsByCard = new Map<string, TransitionRow[]>();
  for (const t of transitions) {
    const bucket = transitionsByCard.get(t.cardId);
    if (bucket) bucket.push(t);
    else transitionsByCard.set(t.cardId, [t]);
  }

  const assigneeById = new Map(assignees.map((a) => [a.id, a]));

  return [...lanes]
    .sort((a, b) => a.position - b.position)
    .map((lane) => ({
      id: lane.id,
      name: lane.name,
      position: lane.position,
      visibility: lane.visibility as LaneVisibility,
      cards: cards
        .filter((c) => c.laneId === lane.id)
        .sort((a, b) => a.position - b.position)
        .map((c) =>
          toAgencyCard(
            c,
            versions,
            computePossession(transitionsByCard.get(c.id) ?? [], now),
            c.assigneeId ? assigneeById.get(c.assigneeId) : undefined,
          ),
        ),
    }));
}
