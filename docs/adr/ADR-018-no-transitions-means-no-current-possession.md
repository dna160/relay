# ADR-018 — A card with no transitions has no current possession

**Status:** accepted (Round 3, confirming B5) · **Relates to:** ADR-010, INV-5

## Context

B5 removed the optional third argument from
`computePossession(transitions, now, currentState?)`. That argument let a caller
pass `cards.state` and have the clock fill in `current` for a card that had
never moved.

The consequence, raised in round 2 and confirmed here: a card with zero rows in
`state_transitions` now reports `current: null`. Every card is such a card at
some point — a freshly created one, until the first transition. The front end is
adding a `POSSESSION[card.state]` fallback in the UI so the board still shows
which side the ball is on.

This ADR records that the clock is not changing, and why the surface is the
right place for that fallback.

## Decision

`computePossession` stays as it is. `current: null` for a card with no
transitions is the correct answer, not a gap to be papered over.

Three reasons, in order of weight:

1. **ADR-010 says possession is derived from `state_transitions` and nowhere
   else.** The third argument was a second source for the same number. Two
   sources agree until they don't, and the day they disagree is a day someone
   is looking at an invoice. A rule with an exception for the empty case is a
   rule that has to be re-argued every time the empty case gets slightly less
   empty.
2. **The two questions are genuinely different.** "Which side has the ball
   right now" is a property of `cards.state`, and the state machine already
   publishes the mapping as `POSSESSION`. "How long has each side held it" is a
   property of the transition log. The first is answerable for a card that has
   never moved; the second is not, because no interval has opened. Collapsing
   them into one function made the second question quietly answer the first,
   badly.
3. **The honest answer is the useful one.** A card with no transitions has
   accrued zero time to either party. Reporting `current: 'agency'` alongside
   `agencyMs: 0` invites a reader to believe the clock is running when nothing
   has started it.

The surface reading `POSSESSION[card.state]` is not a workaround. It is the
front end asking the question it actually has — "which side do I colour this
card for" — of the thing that knows the answer, instead of asking the clock a
question the clock cannot answer and taking a guess for a fact.

## Consequences

- `PossessionSplit.current` means "the possession opened by the most recent
  transition", and is `null` both for a card that has never moved and for one
  that is signed off. Both are cases where no party is accruing time.
  A consumer that needs a displayable side reads `cards.state`.
- **QA:** assert the behaviour — zero transitions yields
  `{ agencyMs: 0, clientMs: 0, current: null, currentMs: 0 }` — and assert that
  `computePossession` has arity 2. Do not assert on how any surface fills the
  gap; that is a rendering decision and may change.
- The invariant harness's INV-5 suite is unaffected: it is about a transition
  row existing and carrying what the state machine decided, which is exactly
  the input this function reads.
