/**
 * The seed strategy.
 *
 * ## The rule
 *
 * A seed script may insert rows. It may **not** set `cards.state` (INV-2). The
 * structural scan in `inv-02` only reads `src/`, so nothing stops a seed under
 * `tests/` from writing state directly — which is exactly why the rule is
 * written down here and enforced by replay instead.
 *
 * Every fixture card therefore ships a **transition script**: the ordered list
 * of moves that reaches its state legally. A database seed inserts the card in
 * `draft` and replays the script through `domain/card/transition-card.ts`,
 * producing the `state_transitions` rows the possession clock needs (INV-5) and
 * the `rounds_used` counter the breach styling needs — for free, and correctly.
 *
 * `tests/unit/fixtures.spec.ts` replays every script against the real state
 * machine and asserts that the end state and round count match the card row.
 * A fixture that cannot be reached by legal moves is a fixture that is lying
 * about the system, and tests written against it prove nothing.
 *
 * ## Determinism
 *
 * No `crypto.randomUUID()`, no faker, no locale, no timezone. Ids come from
 * `./ids` and instants from `./clock`, and every offset in this graph is a
 * hard-coded integer.
 *
 * One thing is deliberately *not* fixed: the calendar date the engagement
 * timeline hangs off. Those rows are read back by code that calls `new Date()`,
 * so they are anchored to seed time rather than to an absolute origin — a
 * fixture pinned to January is correct in January and quietly wrong in August,
 * which is exactly what happened. See the long note in `./clock.ts`. Ids,
 * ordering, row counts, card states, round counts and every *interval* are
 * still byte-identical between runs; the timestamp columns on `engagements`
 * and `client_contacts` are not, and that is the trade.
 */

import type { CardState } from '@/domain/card/state-machine';
import { CARD, ENGAGEMENT } from './ids';
import { cards, lanes, versions, approvals } from './board';
import { clientContacts, engagements } from './engagements';
import { orgs, users } from './orgs';

/** One legal move. Replayed through the state machine, never written directly. */
export interface ScriptedMove {
  from: CardState;
  to: CardState;
  actor: 'agency' | 'client';
}

function agencyMove(from: CardState, to: CardState): ScriptedMove {
  return { from, to, actor: 'agency' };
}

function clientMove(from: CardState, to: CardState): ScriptedMove {
  return { from, to, actor: 'client' };
}

/** draft -> assigned -> in_progress -> internal_review -> awaiting_client. */
const TO_CLIENT: readonly ScriptedMove[] = [
  agencyMove('draft', 'assigned'),
  agencyMove('assigned', 'in_progress'),
  agencyMove('in_progress', 'internal_review'),
  agencyMove('internal_review', 'awaiting_client'),
];

/** One revision round: the client sends it back and the agency re-publishes. */
const ONE_ROUND: readonly ScriptedMove[] = [
  clientMove('awaiting_client', 'changes_requested'),
  agencyMove('changes_requested', 'in_progress'),
  agencyMove('in_progress', 'internal_review'),
  agencyMove('internal_review', 'awaiting_client'),
];

/** The client sends it back and the agency has not picked it up again yet. */
const SENT_BACK: readonly ScriptedMove[] = [clientMove('awaiting_client', 'changes_requested')];

export const transitionScripts: Readonly<Record<string, readonly ScriptedMove[]>> = {
  // awaiting_client, one round consumed.
  [CARD.awaitingClient]: [...TO_CLIENT, ...ONE_ROUND],
  // draft is the initial state; reaching it takes no moves at all.
  [CARD.draft]: [],
  [CARD.internalReview]: TO_CLIENT.slice(0, 3),
  [CARD.privateOverride]: TO_CLIENT.slice(0, 2),
  [CARD.empty]: TO_CLIENT.slice(0, 1),
  [CARD.inPrivateLane]: TO_CLIENT.slice(0, 2),
  // signed_off, one round consumed.
  [CARD.signedOff]: [
    ...TO_CLIENT,
    ...ONE_ROUND,
    clientMove('awaiting_client', 'approved'),
    agencyMove('approved', 'signed_off'),
  ],
  // changes_requested with three rounds used — over its contracted two.
  [CARD.changesRequested]: [...TO_CLIENT, ...ONE_ROUND, ...ONE_ROUND, ...SENT_BACK],
};

/**
 * The whole fixture graph, in insertion order. Foreign keys resolve if inserted
 * top to bottom.
 *
 * `cards` here are the *end states* used by the pure projection tests. A
 * database seed inserts each one in `draft` and replays
 * `transitionScripts[card.id]`; it does not insert the state named on the row.
 */
export const seedGraph = {
  orgs,
  users,
  engagements,
  clientContacts,
  lanes,
  cards,
  versions,
  approvals,
} as const;

/** The engagement the board fixture belongs to. */
export const BOARD_ENGAGEMENT_ID = ENGAGEMENT.active;
