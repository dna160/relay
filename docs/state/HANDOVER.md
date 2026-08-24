# HANDOVER — written at the end of Phase 0, for the Phase 1 session

> Overwrite this file each session. It is a note to the next session, not a log.
> Template: what is true now / what I changed / what will bite you / start here.

## What is true now

`npm run verify` passes on a clean install. It runs typecheck, lint, unit
(currently empty), and the invariant suite. Four invariant suites execute; six
are `describe.skip` with the unskipping phase named in each file header.

The tree matches `docs/ARCHITECTURE.md`'s file tree. The three seed files from
the delivery package are in place and unmodified:

- `src/domain/card/state-machine.ts` — the sole writer of `cards.state`
- `src/domain/projection/client-view.ts` — the only client serialiser
- `tests/invariants/visibility.spec.ts` — INV-1, already passing against the seed

There is no database, no schema, no route, and no component. That is correct for
Phase 0 and not a gap.

## What I changed from the delivery package

- **Renamed the product to Relay** (working name was "Handoff"; the PRD flagged
  it as a placeholder to rename before launch). Recorded in the PRD rather than
  erased, so the rename is a decision with a date rather than a mystery.
- **Four invariants are live at Phase 0, not one.** INV-2, INV-9, and INV-10 are
  structural — they scan the source tree — so they hold vacuously against an
  empty `src/` and start enforcing the moment code lands. The alternative was
  writing them in Phase 2, 3, and 3 respectively, by which point there would be
  code to grandfather. Helper: `tests/invariants/_source.ts`.
- **ESLint carries INV-9 as a lint rule as well as a test.** The rule catches it
  in the editor; the test catches someone disabling the rule inline. Both exist
  because the fast feedback and the hard gate are different jobs.

## What will bite you

- `exactOptionalPropertyTypes` is **off** in `tsconfig.json`. Turning it on later
  is a large mechanical diff. Decide in Phase 1, while the surface is small.
- The structural invariants strip comments before matching but do not parse
  strings. They are all "must not contain" checks, so a false positive fails
  loudly — never a false negative that passes silently. If one fires on
  something innocent, fix the regex in the spec, do not add an exception.
- `INV-2`'s scan permits exactly two paths: the state machine itself and
  `src/domain/card/transition-card.ts`, which **Phase 2 must create at that
  exact path**. Putting the persister anywhere else fails the build.
- Docker is not running on this machine, so nothing has been migrated. The first
  Phase 1 task is `docker compose up -d db`, not schema design.

## Start here

1. Read `CLAUDE.md`, this file, then `docs/phases/PHASE-1.md`. Nothing else
   until a task names it.
2. `docker compose up -d db`
3. Write `src/lib/types.ts` first — the `Session` union from API-CONTRACT.md.
   Both sides import it and neither redeclares it, so it wants to exist before
   there are two sides.
4. Then the schema for the five Phase 1 tables, then the first migration.
5. Unskip INV-6 and INV-8 as you go, not at the end. An invariant unskipped last
   is an invariant that was designed around.

## Evidence, not assertion

The three structural invariants were negative-tested before this handover was
written: a probe file violating each was planted, the suite was run, and all
three failed with the offending file and line named. The probes were then
removed and `npm run verify` returned to green. An invariant that has never
been observed failing is decoration.
