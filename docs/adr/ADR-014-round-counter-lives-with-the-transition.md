# ADR-014 — The revision-round counter increments where the transition persists

**Status:** accepted (Phase 3) · **Relates to:** INV-2, INV-5, PRD §5.5

## Context

`transition()` reports `incrementsRound: true` on exactly one edge,
`awaiting_client -> changes_requested`. PHASE-3.md assigns the increment to
`domain/approval/record-decision.ts`.

But that edge is not reachable only through a client decision. An agency member
can take it through `POST /api/cards/:id/transition` — `canTransition` allows
it and the actor check only constrains *clients*. If `record-decision.ts` owned
the increment, the same edge would count a round when a client took it and not
when an agency member did.

`rounds_used` is the number an agency puts in front of a client to say round
four of a two-round agreement has begun. It is the number an invoice gets argued
over. Two increment sites will eventually disagree, and the disagreement will
surface as a billing dispute rather than as a failing test.

## Decision

`transitionCard()` applies the increment, in the same statement and the same
transaction that writes `cards.state`. It reads `incrementsRound` off the
`TransitionResult` and never decides for itself which edge costs a round.

`record-decision.ts` still *causes* the increment — it calls `transitionCard()`
inside its own transaction — and PHASE-3.md's requirement is satisfied
behaviourally. It simply does not carry a second copy of the rule.

## Consequences

- One place counts rounds. The state machine still decides which edge costs one.
- A test that asserts "recording `changes_requested` increments `rounds_used`"
  passes unchanged; a test that greps `record-decision.ts` for the increment
  itself would not. Noted for the QA agent.
- The same argument would apply to any future consequence of a transition
  (nudge scheduling, SLA clocks): it belongs next to the persist, not next to
  one of the callers.
