# PHASE 2 — Board core

## ENTRY
- Phase 1 exit conditions verified. INV-6 and INV-8 green.

## SCOPE
- Schema + migration: `lanes`, `cards`, `state_transitions`.
  `lanes.visibility` defaults to `'published'` at the column level (ADR-006).
- `domain/card/transition-card.ts` — the sole persister. One transaction:
  write `cards.state`, append `state_transitions` with possession, bump
  `engagements.last_activity_at`.
- `domain/projection/agency-view.ts` alongside the existing `client-view.ts`.
- `src/db/queries/` with `clientScope()`. Every client-reachable read goes
  through it; adding one without a case in `visibility.spec.ts` fails the build.
- Routes: `/api/lanes`, `/api/cards` (POST/PATCH — **rejects** `state`),
  `/api/cards/:id/transition` (the only state writer), `/api/engagements/:id/board`.
- Reorder writes `position` only. Drag never changes state (ADR-003).

## OUT
- Versions and the publish gate. Phase 3 — `/api/cards/:id/publish` is Phase 3.
- The possession *clock*. This phase writes the transitions rows; Phase 5
  derives durations from them.
- Client-facing pages. Phase 4.

## EXIT
- INV-1, INV-2, INV-5 (transition-row half), INV-9 unskipped and passing.
- A PATCH carrying `state` returns 400 and does not write.
- An illegal edge returns 409 `INVALID_TRANSITION`.
- Every new query in `src/db/queries/` has a case in `visibility.spec.ts`.

## INVARIANTS
Strengthens **INV-1** (real queries, not just the pure projection), **INV-2**
(a persister now exists to be constrained), **INV-5**, **INV-9**.

## HANDOVER
Record: the `clientScope()` signature, which queries are client-reachable, and
the exact error shapes returned for a rejected state PATCH.
