# RELAY — Claude Code Context Anchor

> Read this file at the start of every session. It is the shortest complete
> description of what must remain true about this codebase.

## What this is

A per-engagement collaboration workspace for agencies and their clients.
One signed contract → one workspace → one link. Board, files, approvals, and
sign-off all live inside it. When the engagement ends, the workspace expires
and is hard-purged unless the agency is on a retaining plan.

Not a Trello clone. The board is a *rendering of an approval state machine*,
and the client is a first-class user of it.

## Session protocol

1. Read this file.
2. Read `docs/state/PROGRESS.md` — tells you the current phase and what's done.
3. Read `docs/state/HANDOVER.md` — the previous session's note to you.
4. Read the phase file named in PROGRESS.md (`docs/phases/PHASE-N.md`). Read only that one.
5. Work only inside that phase's scope. Do not start the next phase.
6. Before ending a session, run `npm run verify` and update both state files.

Do not read every document in `docs/` at once. The phase file tells you which
contracts you need. Loading everything is how context gets burned.

## The ten invariants

These are enforced by tests in `tests/invariants/`. If you change behaviour so
that one of these tests fails, you have introduced a bug, not a feature. Never
edit a test in `tests/invariants/` to make it pass.

- **INV-1** No response served to a client contact ever contains a private lane,
  a private card, or an internal-only field. Enforced at the query layer, never
  in the UI.
- **INV-2** `cards.state` changes only via `domain/card/state-machine.ts`.
  No route handler, no query file, and no seed script writes it directly.
- **INV-3** An approval references exactly one immutable `asset_version` and
  stores that version's sha256 at decision time.
- **INV-4** `asset_versions` is append-only. Rows are never updated or deleted
  except by the purge worker.
- **INV-5** Every state transition writes a `state_transitions` row carrying
  possession (`agency` | `client`). The possession clock is derived from this
  table and nowhere else.
- **INV-6** A client session is scoped to exactly one engagement. There is no
  cross-engagement client identity.
- **INV-7** Purge destroys all object bytes and content rows for an engagement
  and leaves exactly one `purge_certificate`.
- **INV-8** Active-project count is one function, `countActiveEngagements()`.
  Billing limits and expiry scheduling both call it. They may never diverge.
- **INV-9** Business logic lives in `src/domain/`. Route handlers parse input,
  call a domain function, and serialise output. Nothing else.
- **INV-10** File bytes never traverse the app server. Uploads and downloads are
  presigned direct to object storage.

## The platform layer (v1.1) — four more, not yet live

Introduced by `docs/PRD.md` v2.0 and `docs/adr/ADR-021-identity-and-tenancy.md`,
which **supersedes ADR-005** and narrows INV-6 to reviewer sessions. None of
these are enforcing yet; each names the phase that makes it so.

- **INV-11** All access decisions come from `resolveAccess()`. Deny by default.
  No route, component, or query compares an account id to a membership row.
  *Phase 9.*
- **INV-12** An invite token never establishes a session. Membership is written
  only after independent verification of the invited address. *Phase 10.*
- **INV-13** Ingestion never writes a project graph. It emits a template
  definition that a human confirms; only `applyTemplate()` creates lanes and
  cards. *Phase 12.*
- **INV-14** No inferred assignment triggers an outbound email. Invites are
  always an explicit human action on a named address. *Phase 12.*

**INV-6 is narrowed, not retired.** A *reviewer* session is still scoped to one
project. What changes is that an agency-side person is now an account with a
membership graph, which is the thing ADR-005 said would double the tenancy
surface — it does, and v1.1 accepts that cost deliberately.

## Vocabulary drift you will hit immediately

The v1 code says **`engagement`**; the v2.0 PRD says **`project`**. They are the
same object. The v1.1 handover is explicit that renaming mid-migration is a
Phase 11 tidy at the earliest, and only if it is free. Read `engagement` in code
as `project` in the PRD and do not start a rename.

Likewise **`client contact`** in code is **`reviewer`** in the PRD, and
`(client)` is the reviewer bundle.

## Vocabulary (use these words in code and UI)

| Term | Means |
|---|---|
| Engagement | One contract's workspace. The unit of work, billing, access, and deletion. |
| Lane | A column on the board. Published by default; private is explicit. |
| Card | A requested deliverable, not a task. Carries state, versions, approvals. |
| Stage / Backstage | The client projection and the agency projection of the same card. |
| Version | An immutable uploaded file with a hash. Approvals bind to versions. |
| Possession | Which side the ball is with. Drives the clock and the board colour. |
| Wrap | The end of an engagement. Starts the retention countdown. |
| Purge | Irreversible destruction of an engagement's content. |

## Commands

```
npm run dev            # app + worker
npm run verify         # typecheck + lint + unit + invariants. Fast; run it constantly.
npm run verify:all     # the above plus `next build`. THIS is the handover gate.
npm run db:generate    # drizzle migration from schema
npm run db:migrate
npm run test:e2e
```

## Standing rules

- TypeScript strict. No `any`. No non-null assertions on database reads.
- Every new query function that can be reached by a client contact needs a case
  in `tests/invariants/visibility.spec.ts`. No exceptions.
- Migrations are forward-only and never edited after commit.
- `npm run verify` does not prove the build. A `'use server'` file exporting a
  non-async const typechecks, lints, and fails `next build` at page-data
  collection — that happened in round 3. Hand over on `npm run verify:all`.
- Do not add a dependency without an ADR entry.
- Do not introduce a chat/messaging surface. Discussion attaches to cards and
  versions. This is a product decision, recorded in ADR-011.
