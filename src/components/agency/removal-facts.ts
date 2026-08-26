/**
 * The facts a removal confirmation is written from.
 *
 * **This file has no `'use client'` and must not gain one.** It exists because
 * `movedEver()` lived in `remove-controls.tsx`, which does — and a server
 * component calling a function exported from a client module is not a type
 * error, not a lint error, and not a build error. It is a runtime error, at
 * request time, on the page:
 *
 *   Attempted to call movedEver() from the server but movedEver is on the
 *   client. It's not possible to invoke a client function from the server.
 *
 * `npm run verify` had nothing to say about it. That is the same family as the
 * `'use server'` file exporting a non-async const in CLAUDE.md's standing rules
 * — a directive at the top of a file changing what an export *is*, invisibly to
 * every static check the project runs. The card page is a server component and
 * it needs this value to render the control at all, so the predicate lives
 * somewhere both sides may import.
 */

/** What `removeCard()` will find behind this card. See `cardDependents()`. */
export interface CardRemovalFacts {
  versions: number;
  comments: number;
  /** Whether this card has ever moved. See `movedEver()`. */
  hasMoved: boolean;
  /** Whether the client can see it right now. See `onClientBoard()`. */
  visibleToClient: boolean;
}

/**
 * Is this card on the client's board right now?
 *
 * Kept separate from `movedEver()` because conflating them produces a false
 * sentence, and this one was briefly shipped: the removal dialog inferred "the
 * client has seen this" from *having transitions*, so a card moved
 * `draft → assigned` and nothing else — a purely internal act — told the agency
 * their client had seen it.
 *
 * Zero transitions is a sound proof of never-seen, and that is the direction
 * COMPONENTS.md §18 states. The converse does not follow: a card can move
 * several times inside a private lane and never appear to anybody. So visibility
 * is asked of the three things that actually decide it, which are the same three
 * the client projection uses:
 *
 * - the lane is published (INV-1: a private lane's cards are never serialised),
 * - the card carries no private override,
 * - and the state is not agency-only — `AGENCY_ONLY_STATES` is exactly
 *   `{draft}`, so an `assigned` card in a published lane *is* on the client's
 *   board even though nobody has published a version to it.
 *
 * This is a statement about the present, so the copy says "is on their board"
 * rather than "has seen", which is the claim the data can actually support.
 */
export function onClientBoard(card: {
  state: string;
  visibilityOverride: string;
  laneVisibility: string;
}): boolean {
  return (
    card.laneVisibility === 'published' &&
    card.visibilityOverride !== 'private' &&
    card.state !== 'draft'
  );
}

/**
 * Has this card ever moved?
 *
 * Derived from the possession split rather than from `state`, and the
 * difference is a real case rather than a theoretical one: a card that was
 * moved forward and then *returned* to draft — `Return to draft` is a labelled
 * action in `vocabulary.ts` — sits in `draft` with transitions behind it. So
 * reading `state === 'draft'` as "never moved" would predict a discard on a
 * card the server is about to archive, and the confirmation would promise a
 * deletion that did not happen.
 *
 * Possession is computed from `state_transitions` and nothing else (INV-5,
 * ADR-010), and ADR-018 says no transitions means no current possession. So a
 * null holder with zero accrued time on both sides is an exact proof that the
 * ledger is empty — which is one of the three counts `cardDependents()` uses to
 * decide between discarding and archiving.
 */
export function movedEver(possession: {
  current: string | null;
  agencyMs: number;
  clientMs: number;
}): boolean {
  return possession.current !== null || possession.agencyMs > 0 || possession.clientMs > 0;
}
