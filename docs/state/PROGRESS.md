# PROGRESS

> Updated at the end of every session. The phase table is the authority on where
> the build is; prose below it is context, not state.

**Current phase:** 1 — Tenancy, identity, engagement lifecycle
**Last verified:** Phase 0 exit, 2026-08-24

| Phase | Title | Status |
|---|---|---|
| 0 | Scaffolding & guardrails | ✅ complete |
| 1 | Tenancy, identity, engagement lifecycle | ⬜ not started |
| 2 | Board core | ⬜ not started |
| 3 | Assets, versions, approvals | ⬜ not started |
| 4 | Client surface | ⬜ not started |
| 5 | Time intelligence | ⬜ not started |
| 6 | Ephemerality | ⬜ not started |
| 7 | Templates, white-label, plan gates | ⬜ not started |
| 8 | Hardening & deploy | ⬜ not started |

## Invariant status

| | Invariant | State | Owned by |
|---|---|---|---|
| INV-1 | No private lane/card/internal field in a client response | 🟢 live | Phase 0, extended 2 & 4 |
| INV-2 | `cards.state` written only via the state machine | 🟢 live | Phase 0, strengthened 2 |
| INV-3 | Approval binds one immutable version + its sha256 | ⬜ skipped | Phase 3 |
| INV-4 | `asset_versions` is append-only | ⬜ skipped | Phase 3 |
| INV-5 | Every transition writes a possession row | ⬜ skipped | Phase 2 + 5 |
| INV-6 | A client session is scoped to one engagement | ⬜ skipped | Phase 1 |
| INV-7 | Purge is total and leaves one certificate | ⬜ skipped | Phase 6 |
| INV-8 | One `countActiveEngagements()` | ⬜ skipped | Phase 1 |
| INV-9 | Business logic lives in `src/domain/` | 🟢 live | Phase 0 |
| INV-10 | File bytes never traverse the app server | 🟢 live | Phase 0, strengthened 3 |

Four invariants are live from Phase 0 because they are *structural* — they are
enforced by reading the source tree, so they hold against an empty `src/` and
keep holding as code lands. The six skipped ones need rows or functions that do
not exist yet; each spec file names the phase that unskips it.

## Deferred

- Postgres is not provisioned on the build machine (`docker compose up -d db`
  when Docker is running). Phase 0 deliberately requires no database: `verify`
  is typecheck + lint + unit + invariants, all pure.
- Product name changed from the working name "Handoff" to **Relay** on
  2026-08-24. Recorded in `docs/PRD.md` §preamble.

## Open product decisions carried forward

From PRD §9, unresolved and blocking specific phases:
1. **Tombstone vs certified destruction** — blocks the certificate's legal
   wording and Phase 6's phase-two scheduling.
2. **Possession visibility default** — internal-only in v1; Phase 5 must not
   surface it to clients without this landing.
3. **Reactivation pricing** — Phase 6 builds the path, leaves the paywall
   behind a flag.
