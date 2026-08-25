# PROGRESS

> The phase table is the authority on where the build is. Prose below it is
> context, not state. `docs/state/VERIFICATION.md` is the audit surface — it maps
> every invariant and exit condition to the command that proves it, and names
> what nothing proves yet.

**Current phase:** 5 — Time intelligence
**Last verified:** `npm run verify:all` green, 2026-08-25

| Phase | Title | Status |
|---|---|---|
| 0 | Scaffolding & guardrails | ✅ complete |
| 1 | Tenancy, identity, engagement lifecycle | ✅ complete — one exit condition unproven (needs a database) |
| 2 | Board core | ✅ complete |
| 3 | Assets, versions, approvals | ✅ complete — one exit condition unproven (RSS not measured) |
| 4 | Client surface | ✅ complete |
| 5 | Time intelligence | 🟡 partial — possession clock, rounds and `AttentionList` shipped early; nudge jobs not built |
| 6 | Ephemerality | ⬜ not started |
| 7 | Templates, white-label, plan gates | 🟡 partial — white-label lock shipped; `applyTemplate()` does not exist |
| 8 | Hardening & deploy | ⬜ not started |
| — | *v1.1 platform layer below — specified, not started* | |
| 9 | Identity and tenancy migration | 🟡 in progress — D3 answered (ADR-022) |
| 10 | Auth and invites | ⬜ not started |
| 11 | Multi-org navigation and teams | ⬜ not started |
| 12 | Document ingestion | 🔴 blocked on D4, D5 |
| 13 | Deployment and retention hardening | ⬜ not started — D1, D2 answered (ADR-022) |

Phases 5 and 7 are partial because Round 2 pulled work forward deliberately:
`GET /api/attention` because the portfolio is the agency home screen and shipping
it dead until a later phase was not a defensible handover state, and the
white-label token lock because the design system needed it to be structural
rather than a review rule.

## Invariant status

| | Invariant | State |
|---|---|---|
| INV-1 | No private lane/card/internal field in a client response | 🟢 live — 64 cases |
| INV-2 | `cards.state` written only via the state machine | 🟢 live |
| INV-3 | Approval binds one immutable version + its sha256 | 🟢 live (DB half skipped) |
| INV-4 | `asset_versions` is append-only | 🟢 live (DB half skipped) |
| INV-5 | Every transition writes a possession row | 🟢 live |
| INV-6 | A client session is scoped to one engagement | 🟢 live (DB half skipped) |
| INV-7 | Purge is total and leaves one certificate | ⬜ skipped — Phase 6 |
| INV-8 | One `countActiveEngagements()` | 🟢 live |
| INV-9 | Business logic lives in `src/domain/` | 🟢 live |
| INV-10 | File bytes never traverse the app server | 🟢 live |

**454 live assertions** — 341 unit, 113 invariant. 9 of 10 suites enforcing.

## What the suite caught that review would not have

Recorded because it is the argument for the harness existing:

- A client serialiser that would emit a **draft card** carrying a state its own
  return type forbids. The back-end had already tripped it once.
- **Four** client-reachable queries that escaped visibility review, one caught
  during the guard author's own final verify run.
- A reply that could be **grafted onto another engagement** — `parent_id` was a
  bare self-reference.
- A **public reply under an internal comment**, which would have carried a
  `parentId` the client could never resolve, confirming a hidden thread exists.
- A dark-mode token that painted `rgb(0,163,144)` where the design system
  published `#499D8F`. Every contrast check passed — against a colour the
  product did not paint.
- A `data-theme="light"` selector that never matched, so a reader who explicitly
  chose light got dark anyway. Both palettes were internally valid; the selector
  was wrong.

## Deferred / carried forward

- **No Postgres has ever run this code.** Docker Hub was unreachable on the build
  machine — even a 13 KB image hung. Migrations, seed ordering, `LISTEN`/`NOTIFY`
  reconnect, the Auth.js cookie name, `FOR UPDATE` locking and both `approvals`
  CHECK constraints are compile-verified and **unexecuted**. CI's `e2e` job is
  their first real run.
- **Deploy and rollback have never been executed.** The largest open risk, and
  the one exit condition no test can cover.
- Six agency components still use the raw `input` token instead of the `Field`
  primitive. Blocked on two primitive gaps: no visually-hidden label, and no mono
  control. Documented on the token itself.
- `POST /api/client/comments` could return `authorName` now that it is resolved
  in the write transaction. One line, whenever the front-end wants it.

## v1.1 note

`docs/PRD.md` is now v2.0 and supersedes v1, which is preserved as
`docs/PRD-v1.md`. `docs/DELIVERY-PLAN.md` carries the platform-layer blueprint.
Phase files now exist for all of 9–13. The package shipped 9 and 12; 10, 11 and
13 were named in the plan and written here from `DELIVERY-PLAN.md`.

**D1, D2 and D3 are resolved** (ADR-022, 2026-08-25), which unblocks Phases 9
and 13. D4 and D5 still block Phase 12 — the model sub-processor default, and
what a low-confidence extraction should do.

## Open product decisions

From PRD §9, still unresolved and each blocking a specific phase:
1. **Tombstone vs certified destruction** — blocks the certificate's legal
   wording and Phase 6's phase-two scheduling.
2. **Possession visibility default** — internal-only in v1. Phase 5 must not
   surface it to clients without this landing.
3. **Reactivation pricing** — Phase 6 builds the path, leaves the paywall
   behind a flag.
