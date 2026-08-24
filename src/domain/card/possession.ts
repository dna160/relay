/**
 * The possession clock, derived from `state_transitions` and nowhere else
 * (ADR-010, INV-5).
 *
 * No table stores a running total. Totals denormalise badly and cannot be
 * recomputed after a bug, and this number is the one the agency will put in
 * front of a client who says the delay was theirs.
 *
 * Pure: transitions in, milliseconds out, with `now` supplied by the caller.
 */

import type { PossessionSplit } from '@/lib/types';
import type { CardState, Possession } from './state-machine';

export interface TransitionRow {
  cardId: string;
  toState: CardState;
  possession: Possession | null;
  occurredAt: Date;
}

const EMPTY: PossessionSplit = { agencyMs: 0, clientMs: 0, current: null, currentMs: 0 };

/**
 * Each transition opens a possession interval that the next transition closes.
 * The last one is still open, so it runs to `now` — unless the card is signed
 * off, in which case the clock stops rather than accruing to a party that is
 * no longer doing anything.
 *
 * Transitions in, milliseconds out. There is deliberately no third argument.
 * An earlier signature accepted the card's `state` and used it to fill in
 * `current` when the card had never moved, which let a caller derive current
 * possession from `cards.state` — a second source for a number ADR-010 says
 * comes from `state_transitions` and nowhere else. A card with no transitions
 * has opened no possession interval, and reporting `current: null` for it is
 * the honest answer rather than a convenient one.
 *
 * Callers that need to know which side the board *shows* the ball on read
 * `cards.state` themselves through the state machine's own `POSSESSION` table.
 * That is a different question from the clock, and keeping the two apart is
 * the point.
 */
export function computePossession(
  transitions: readonly TransitionRow[],
  now: Date,
): PossessionSplit {
  if (transitions.length === 0) return EMPTY;

  const ordered = [...transitions].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

  let agencyMs = 0;
  let clientMs = 0;

  for (let i = 0; i < ordered.length; i += 1) {
    const row = ordered[i];
    if (!row) continue;
    const next = ordered[i + 1];
    const end = next ? next.occurredAt.getTime() : now.getTime();
    const elapsed = Math.max(0, end - row.occurredAt.getTime());
    if (row.possession === 'agency') agencyMs += elapsed;
    else if (row.possession === 'client') clientMs += elapsed;
    // `null` — signed off. Accrues to neither party.
  }

  const last = ordered[ordered.length - 1];
  const current = last ? last.possession : null;
  const currentMs = last && current ? Math.max(0, now.getTime() - last.occurredAt.getTime()) : 0;

  return { agencyMs, clientMs, current, currentMs };
}

/** Groups a flat transition set by card, for a whole-board read. */
export function possessionByCard(
  transitions: readonly TransitionRow[],
  now: Date,
): Map<string, PossessionSplit> {
  const grouped = new Map<string, TransitionRow[]>();
  for (const row of transitions) {
    const bucket = grouped.get(row.cardId);
    if (bucket) bucket.push(row);
    else grouped.set(row.cardId, [row]);
  }
  const out = new Map<string, PossessionSplit>();
  for (const [cardId, rows] of grouped) out.set(cardId, computePossession(rows, now));
  return out;
}

/** The engagement-level roll-up shown on a portfolio card. */
export function sumPossession(splits: Iterable<PossessionSplit>): PossessionSplit {
  let agencyMs = 0;
  let clientMs = 0;
  for (const s of splits) {
    agencyMs += s.agencyMs;
    clientMs += s.clientMs;
  }
  return { agencyMs, clientMs, current: null, currentMs: 0 };
}
