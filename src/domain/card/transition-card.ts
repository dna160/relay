/**
 * The sole *persister* of `cards.state` (INV-2). The sole *decider* is
 * `state-machine.ts`, which this file calls and never second-guesses.
 *
 * Everything that moves a card — the transition route, the publish gate, a
 * recorded client decision — ends up here. One transaction does three things
 * that must not be separable:
 *
 *   1. writes `cards.state`
 *   2. appends a `state_transitions` row carrying possession (INV-5)
 *   3. bumps `engagements.last_activity_at`
 *
 * If (2) could fail after (1), the possession clock would silently lose a leg
 * and no later job could reconstruct it — the totals are derived from that
 * table and nowhere else (ADR-010).
 */

import { eq } from 'drizzle-orm';
import { cards, stateTransitions } from '@/db/schema';
import type { Database, Tx } from '@/db/types';
import { bumpActivity } from '../engagement/lifecycle';
import { notVisible } from '../errors';
import { transition, type Actor, type CardState, type Possession } from './state-machine';

export interface TransitionCardInput {
  cardId: string;
  to: CardState;
  actor: Actor;
}

export interface TransitionOutcome {
  cardId: string;
  engagementId: string;
  from: CardState;
  to: CardState;
  possession: Possession | null;
  incrementsRound: boolean;
  roundsUsed: number;
  occurredAt: Date;
}

interface CardStateRow {
  id: string;
  engagementId: string;
  state: CardState;
  roundsUsed: number;
}

/**
 * Reads the card `FOR UPDATE`. Two people clicking "approve" on the same card
 * at the same moment must produce one transition and one 409, not two rows that
 * disagree about which state the card was in.
 */
async function lockCard(tx: Tx, cardId: string): Promise<CardStateRow> {
  const rows = await tx
    .select({
      id: cards.id,
      engagementId: cards.engagementId,
      state: cards.state,
      roundsUsed: cards.roundsUsed,
    })
    .from(cards)
    .where(eq(cards.id, cardId))
    .for('update')
    .limit(1);
  const row = rows[0];
  if (!row) throw notVisible('Card not found');
  return row;
}

/**
 * Requires an open transaction. Callers that have nothing else to write use
 * `runTransition()` below; callers that do — the publish gate, a recorded
 * decision — pass their own `tx` so the whole act commits or none of it does.
 */
export async function transitionCard(
  tx: Tx,
  input: TransitionCardInput,
  now: Date,
): Promise<TransitionOutcome> {
  const card = await lockCard(tx, input.cardId);

  // The decision belongs to the state machine. This file only persists it.
  const result = transition(card.state, input.to, input.actor);

  const roundsUsed = card.roundsUsed + (result.incrementsRound ? 1 : 0);

  await tx
    .update(cards)
    .set({ state: result.to, roundsUsed, updatedAt: now })
    .where(eq(cards.id, card.id));

  await tx.insert(stateTransitions).values({
    cardId: card.id,
    fromState: result.from,
    toState: result.to,
    possession: result.possession,
    actorUserId: input.actor.kind === 'agency' ? input.actor.userId : null,
    actorContactId: input.actor.kind === 'client' ? input.actor.contactId : null,
    occurredAt: now,
  });

  await bumpActivity(tx, card.engagementId, now);

  return {
    cardId: card.id,
    engagementId: card.engagementId,
    from: result.from,
    to: result.to,
    possession: result.possession,
    incrementsRound: result.incrementsRound,
    roundsUsed,
    occurredAt: now,
  };
}

/** The standalone case: one transition, its own transaction. */
export async function runTransition(
  db: Database,
  input: TransitionCardInput,
  now: Date,
): Promise<TransitionOutcome> {
  return db.transaction(async (tx) => transitionCard(tx, input, now));
}
