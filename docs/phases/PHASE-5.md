# PHASE 5 — Time intelligence

## ENTRY
- Phase 2 exit verified. `state_transitions` is being written on every move.

## SCOPE
- `domain/card/possession.ts` — `computePossession(transitions, now)`, pure,
  derived from `state_transitions` alone (ADR-010). No stored totals anywhere.
- Rounds used vs contracted on the card; `--breach` styling when exceeded.
- The attention model: *blocked on me*, *blocked on my team*, *with the client*,
  *no movement in 7 days*. Ranked by actionability, not deadline proximity.
- `AttentionList` on the portfolio home.
- pg-boss nudge jobs on stalled `awaiting_client` cards.
- `PossessionBar` wired to real durations.

## OUT
- Showing possession to the client. Internal-only in v1 (PRD 9).
- Purge and warning jobs. Phase 6, though they share the pg-boss setup.

## EXIT
- Possession totals recomputed from a transitions fixture match within 1s.
- A grep of `src/db/schema/` finds no denormalised possession column.
- INV-5 fully unskipped, including the "no running total" case.

## INVARIANTS
Completes **INV-5**.

## HANDOVER
Record: the attention ranking function, the nudge schedule, and the fixture path
used for the possession tolerance test.
