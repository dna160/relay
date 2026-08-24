# PHASE 0 — Scaffolding & guardrails

> The invariant harness has to exist before there is anything to protect, or it
> never gets built. This phase writes no feature code on purpose.

## ENTRY
- A directory containing `CLAUDE.md` and `docs/`. Nothing else is assumed.
- Node >= 22, npm >= 10.

## SCOPE
- `package.json`, TypeScript strict, ESLint flat config, Tailwind, PostCSS.
- `drizzle.config.ts`, `docker-compose.yml` (Postgres 16), `.env.example`.
- `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`.
- `src/` and `tests/` tree per ARCHITECTURE.md, with the three seed files placed:
  `src/domain/card/state-machine.ts`, `src/domain/projection/client-view.ts`,
  `tests/invariants/visibility.spec.ts`.
- The full invariant suite: ten specs present. INV-1, 2, 9, 10 live; the rest
  `describe.skip` with the unskipping phase named in the file header.
- `npm run verify` = typecheck + lint + unit + invariants, wired end to end.
- `docs/phases/PHASE-0..8.md`, `docs/state/PROGRESS.md`, `docs/state/HANDOVER.md`.

## OUT
- Any table, route, component, or worker. No schema. No auth. No UI.
- Do not implement the six skipped invariants. Their phases own them.

## EXIT
```
rm -rf node_modules && npm install && npm run verify   # passes on a clean machine
```
- `npm run verify` exits 0 with INV-1, 2, 9, 10 executing and six suites skipped.
- The three structural invariants pass against an empty `src/` — they must, or
  they are not structural.
- `docs/state/PROGRESS.md` exists and names Phase 1 as next.

## INVARIANTS
Introduces the harness for all ten. Makes **INV-1** (already testable against the
seed projection), **INV-2**, **INV-9**, **INV-10** live and enforcing.

## HANDOVER
Record: the resolved dependency versions, that the DB is not yet provisioned,
and that six invariant suites are skipped by design with their owning phases.
