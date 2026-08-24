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
import { POSSESSION, type CardState, type Possession } from './state-machine';

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
 */
export function computePossession(
  transitions: readonly TransitionRow[],
  now: Date,
  currentState?: CardState,
): PossessionSplit {
  if (transitions.length === 0) {
    if (!currentState) return EMPTY;
    return { ...EMPTY, current: POSSESSION[currentState] };
  }

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
