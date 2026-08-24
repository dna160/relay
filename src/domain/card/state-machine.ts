/**
 * The only writer of `cards.state` in this codebase. (INV-2)
 *
 * Nothing else — no route handler, no query file, no seed script — may set a
 * card's state. Board position is a separate concern: dragging a card writes
 * `position` and never touches state. A board people can move by hand becomes a
 * board that lies, and every metric built on it becomes fiction.
 */

export type CardState =
  | 'draft'
  | 'assigned'
  | 'in_progress'
  | 'internal_review'
  | 'awaiting_client'
  | 'changes_requested'
  | 'approved'
  | 'signed_off';

export type Possession = 'agency' | 'client';

/** Which side the ball is with in each state. Drives the clock. (INV-5) */
export const POSSESSION: Record<CardState, Possession | null> = {
  draft: 'agency',
  assigned: 'agency',
  in_progress: 'agency',
  internal_review: 'agency',
  awaiting_client: 'client',
  changes_requested: 'agency',
  approved: 'agency',
  signed_off: null,
};

/** States a client contact may never observe directly. */
export const AGENCY_ONLY_STATES: ReadonlySet<CardState> = new Set(['draft']);

/**
 * `internal_review` is real, but the client sees `in_progress`. They learn that
 * work is underway, not that the art director rejected draft two.
 */
export const CLIENT_STATE_ALIAS: Partial<Record<CardState, CardState>> = {
  internal_review: 'in_progress',
};

const TRANSITIONS: Record<CardState, readonly CardState[]> = {
  draft: ['assigned'],
  assigned: ['in_progress'],
  in_progress: ['internal_review'],
  internal_review: ['awaiting_client', 'in_progress'],
  awaiting_client: ['approved', 'changes_requested'],
  changes_requested: ['in_progress'],
  approved: ['signed_off', 'changes_requested'],
  signed_off: [],
};

export type Actor =
  | { kind: 'agency'; userId: string }
  | { kind: 'client'; contactId: string };

/** Transitions a client contact is allowed to cause, and from where. */
const CLIENT_ALLOWED: ReadonlyArray<[CardState, CardState]> = [
  ['awaiting_client', 'approved'],
  ['awaiting_client', 'changes_requested'],
];

export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION';
  constructor(from: CardState, to: CardState, reason: string) {
    super(`Cannot move ${from} -> ${to}: ${reason}`);
  }
}

export function canTransition(from: CardState, to: CardState): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface TransitionResult {
  from: CardState;
  to: CardState;
  possession: Possession | null;
  /** True when this cycle consumed a contracted revision round. */
  incrementsRound: boolean;
}

/**
 * Pure. Validates a move and reports its consequences. Persistence — writing
 * `cards.state`, appending to `state_transitions`, bumping
 * `engagements.last_activity_at` — belongs to the caller, in one transaction.
 */
export function transition(
  from: CardState,
  to: CardState,
  actor: Actor,
): TransitionResult {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to, 'not a legal edge');
  }

  if (actor.kind === 'client') {
    const permitted = CLIENT_ALLOWED.some(([f, t]) => f === from && t === to);
    if (!permitted) {
      // Deliberately the same error shape as an illegal edge. A distinct
      // "you lack permission" message tells a client which moves exist.
      throw new InvalidTransitionError(from, to, 'not a legal edge');
    }
  }

  return {
    from,
    to,
    possession: POSSESSION[to],
    incrementsRound: from === 'awaiting_client' && to === 'changes_requested',
  };
}

/** Cards the client is currently expected to act on. */
export function isAwaitingClient(state: CardState): boolean {
  return state === 'awaiting_client';
}
