/**
 * The attention model (PRD §5.5): "cards rank by *actionability*, not deadline
 * proximity: blocked on me, blocked on my team, blocked on client, silently
 * rotting. Proximity is one input."
 *
 * That sentence is the whole specification and it is a deliberate rejection of
 * the obvious implementation. Sorting by due date produces a list that is
 * identical for every member of the agency and that reorders itself every
 * midnight; sorting by actionability produces a list whose top item is
 * something the person reading it can do right now. Proximity survives as
 * `dueAt` on the item and as a tie-break, never as the primary key.
 *
 * Pure. Rows in, ranked items out, `now` supplied by the caller. It reads
 * `cards.state` to decide *which side is holding the card*, which is the board's
 * own fact, and it derives every elapsed number from `state_transitions` and
 * nowhere else (ADR-010, INV-5). Those are two different questions and this
 * file is careful not to answer the second with the first.
 */

import type { AttentionBucket, AttentionItem } from '@/lib/types';
import { isAwaitingClient, type CardState } from '../card/state-machine';
import { possessionByCard, type TransitionRow } from '../card/possession';

/** PRD §5.5's "silently rotting". A week is a sprint; two is a lost fortnight. */
export const NO_MOVEMENT_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The columns the ranker needs. Deliberately not `AgencyCard` — the attention
 * list spans engagements and never renders a board, so it must not drag the
 * whole card projection (and its internal notes) across the portfolio query.
 */
export interface AttentionCardRow {
  cardId: string;
  engagementId: string;
  engagementTitle: string;
  cardTitle: string;
  state: CardState;
  assigneeId: string | null;
  dueAt: Date | null;
  roundsUsed: number;
  contractedRounds: number | null;
  /**
   * The card's last transition, or its creation instant when it has never
   * moved. A card that has sat in `draft` since March has not moved, and the
   * absence of transitions is the evidence, not a missing value.
   */
  lastMovedAt: Date;
}

export interface RankAttentionInput {
  cards: readonly AttentionCardRow[];
  /** Every transition for the cards above, in any order. */
  transitions: readonly TransitionRow[];
  /** Whose list this is. "Blocked on you" is per-person, not per-org. */
  viewerUserId: string;
  now: Date;
}

/**
 * Rank order, most actionable first. The order is the PRD's sentence, in the
 * PRD's order, and it is also the declaration order of `AttentionBucket` in
 * `src/lib/types.ts` — if the two ever disagree, the PRD wins and both change.
 */
const BUCKET_RANK: Readonly<Record<AttentionBucket, number>> = {
  blocked_on_you: 0,
  blocked_on_your_team: 1,
  with_the_client: 2,
  no_movement_7d: 3,
};

/**
 * One card, one bucket. First match wins, and the order of the checks is the
 * argument:
 *
 * - The ball is with the agency and it has your name on it: nothing outranks a
 *   thing you can finish this afternoon.
 * - The ball is with the agency and it has someone else's name on it: you can
 *   chase a person.
 * - The ball is with the client and it moved recently: nothing to do yet.
 * - Everything else still open has gone quiet — a client who has not answered
 *   in a week, or an agency-side card with nobody's name on it that nobody has
 *   touched. Both are rot, and rot is the bucket you look at last and act on
 *   most decisively.
 *
 * Note what does *not* demote a card: an agency-side card assigned to a real
 * person stays "blocked on your team" however long it sits. "Blocked on your
 * team for three weeks" is a more actionable framing than "rotting", because it
 * names who to ask.
 */
function bucketFor(
  card: AttentionCardRow,
  viewerUserId: string,
  stale: boolean,
): AttentionBucket | null {
  // Signed off is finished. A finished card is never an item of attention, and
  // its possession is null by design — the clock stopped.
  if (card.state === 'signed_off') return null;

  if (isAwaitingClient(card.state)) {
    return stale ? 'no_movement_7d' : 'with_the_client';
  }
  if (card.assigneeId !== null && card.assigneeId === viewerUserId) return 'blocked_on_you';
  if (card.assigneeId === null && stale) return 'no_movement_7d';
  return 'blocked_on_your_team';
}

/** The only use of `--breach` in the design system (types.ts, DESIGN-SYSTEM). */
function roundsBreached(card: AttentionCardRow): boolean {
  return card.contractedRounds !== null && card.roundsUsed > card.contractedRounds;
}

interface Ranked {
  item: AttentionItem;
  rank: number;
  /** Sorted on inside `no_movement_7d`, where possession time says little. */
  idleMs: number;
}

export function rankAttention(input: RankAttentionInput): AttentionItem[] {
  const { cards, transitions, viewerUserId, now } = input;
  const splits = possessionByCard(transitions, now);
  const staleBefore = now.getTime() - NO_MOVEMENT_DAYS * DAY_MS;

  const ranked: Ranked[] = [];

  for (const card of cards) {
    const idleMs = Math.max(0, now.getTime() - card.lastMovedAt.getTime());
    const stale = card.lastMovedAt.getTime() <= staleBefore;
    const bucket = bucketFor(card, viewerUserId, stale);
    if (bucket === null) continue;

    /**
     * Milliseconds accrued in the *current* possession, from the transition
     * table. A card that has never transitioned has opened no possession
     * interval, so this is zero — which is the honest answer, and the reason
     * the rot bucket sorts on `idleMs` instead.
     */
    const possessionMs = splits.get(card.cardId)?.currentMs ?? 0;

    ranked.push({
      rank: BUCKET_RANK[bucket],
      idleMs,
      item: {
        cardId: card.cardId,
        engagementId: card.engagementId,
        engagementTitle: card.engagementTitle,
        cardTitle: card.cardTitle,
        bucket,
        possessionMs,
        dueAt: card.dueAt?.toISOString() ?? null,
        roundsBreached: roundsBreached(card),
      },
    });
  }

  ranked.sort(compare);
  return ranked.map((r) => r.item);
}

/**
 * Bucket first, then how long it has been stuck, then proximity, then id.
 *
 * The last clause is not decoration: without a total order two runs of the same
 * query can return the same list in a different sequence, and a portfolio that
 * reshuffles on refresh reads as broken even when every row is correct.
 */
function compare(a: Ranked, b: Ranked): number {
  if (a.rank !== b.rank) return a.rank - b.rank;

  // Inside the rot bucket, possession time is uninformative — often zero. How
  // long it has been silent is the whole point of the bucket.
  const aWeight = a.item.bucket === 'no_movement_7d' ? a.idleMs : a.item.possessionMs;
  const bWeight = b.item.bucket === 'no_movement_7d' ? b.idleMs : b.item.possessionMs;
  if (aWeight !== bWeight) return bWeight - aWeight;

  // Proximity is one input. Undated cards sort after dated ones rather than
  // before — an undated card is not urgent, it is unscheduled.
  const aDue = a.item.dueAt === null ? Number.POSITIVE_INFINITY : Date.parse(a.item.dueAt);
  const bDue = b.item.dueAt === null ? Number.POSITIVE_INFINITY : Date.parse(b.item.dueAt);
  if (aDue !== bDue) return aDue - bDue;

  return a.item.cardId < b.item.cardId ? -1 : a.item.cardId > b.item.cardId ? 1 : 0;
}
