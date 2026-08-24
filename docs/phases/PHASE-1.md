# PHASE 1 — Tenancy, identity, engagement lifecycle

## ENTRY
- `npm run verify` passes at Phase 0 exit.
- `docker compose up -d db` reaches a healthy Postgres.

## SCOPE
- Drizzle schema for `organizations`, `users`, `engagements`, `client_contacts`,
  `audit_log`, plus the three enums from DATA-MODEL.md. First forward-only migration.
- Auth.js v5, email provider only. Agency sign-in.
- Client magic link: `POST /api/auth/client/request` and `/verify`. The session
  cookie carries exactly one engagement id and cannot be widened (INV-6).
- `src/lib/types.ts` — the `Session` union and shared types from API-CONTRACT.md.
  Both sides import it; neither redeclares it.
- `domain/engagement/`: create, wrap, archive, `bumpActivity()`.
- `domain/engagement/count-active.ts` — `countActiveEngagements()`, the only
  definition of active in the codebase (INV-8).
- `domain/plan/` — limits table, gate returning `PLAN_LIMIT_REACHED` (402).
- `GET/POST /api/engagements`, `GET /api/engagements/:id`, `:id/invite`, `:id/wrap`.

## OUT
- Lanes, cards, state machine. Phase 2.
- Uploads, versions, approvals. Phase 3.
- The client board UI. Phase 4. This phase ends at a verified client session.
- Archive sweeps and purge jobs. Phase 6 — write the columns, not the worker.

## EXIT
- INV-6 and INV-8 unskipped and passing.
- `npm run db:migrate` on an empty database succeeds; rerunning is a no-op.
- Creating an engagement past the plan limit returns 402 `PLAN_LIMIT_REACHED`.
- A client session issued for engagement A returns 404 `NOT_VISIBLE` for B.

## INVARIANTS
Unskips **INV-6**, **INV-8**. Must not weaken INV-9 — the counter is pure and
takes its rows as an argument.

## HANDOVER
Record: the migration filename, the plan limits as implemented, and how the
client session cookie is signed and scoped.
