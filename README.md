# Relay

A per-engagement collaboration workspace for agencies and their clients. One
contract, one workspace, one link — board, files, approvals, and sign-off in a
single object that expires when the work is done.

Not a Trello clone. The board is a *rendering of an approval state machine*, and
the client is a first-class user of it.

## State of the build

Phases 0–4 are built; 5–8 are not. `npm run verify:all` is green.

| | |
|---|---|
| Live test assertions | 454 (341 unit, 113 invariant) |
| Invariant suites enforcing | 9 of 10 — INV-7 waits on Phase 6 |
| npm dependencies added during the build | 1, under [ADR-019](docs/adr/ADR-019-railway-iac-is-the-one-dependency.md) |
| Never executed against Postgres | migrations, seeds, `LISTEN`/`NOTIFY`, Auth.js cookie |

Read `docs/state/VERIFICATION.md` before trusting any of the above. It maps every
invariant and every phase exit condition to the exact command that proves it, and
names the four that nothing proves yet.

## Getting it running

```bash
npm install
cp .env.example .env      # fill in S3, Resend, and the two secrets
docker compose up -d db
npm run db:migrate
npm run dev
```

Migrations have **never been run against a real database** — Docker Hub was
unreachable on the machine that built this. The first person to run the command
above is doing the first real execution, and should expect to find something.

## Commands

```
npm run dev            # app + worker
npm run verify         # typecheck + lint + unit + invariants. Fast; run constantly.
npm run verify:all     # the above plus `next build`. This is the handover gate.
npm run db:generate    # drizzle migration from schema
npm run db:migrate
npm run test:e2e
npm run purge:plan     # dry-run the purge and print its manifest
```

## Where things are

| Doc | What it settles |
|---|---|
| `CLAUDE.md` | The ten invariants. Read first, every session. |
| `docs/PRD.md` | Problem, thesis, scope, what was cut and why |
| `docs/ARCHITECTURE.md` | Stack and the eleven original ADRs |
| `docs/adr/` | The eight further decisions the build itself produced |
| `docs/DATA-MODEL.md` | Tables, enums, indexes, retention timeline |
| `docs/API-CONTRACT.md` | Endpoints — **read the Amendments section**, it supersedes the body |
| `docs/DESIGN-SYSTEM.md` | Tokens, type, the possession bar, copy rules |
| `docs/design/` | Component specs, flows, accessibility working |
| `docs/BUILD-PHASES.md` | Nine phases and the session handover contract |
| `docs/state/` | Progress, handover, and the verification matrix |
| `docs/RUNBOOK.md` | Deploy, rollback, and how to resume a half-finished purge |

## The idea behind the scaffolding

Long builds lose context because prose gets summarised and summaries drift. The
ten invariants in `CLAUDE.md` are therefore written as tests, not as guidance —
`tests/invariants/` fails the build when the system stops being what it was
designed to be. Documentation records what was meant; the suite records what is
still true. When those disagree, the suite wins.

That held up. Across the build the suite caught a client serialiser that would
emit a draft card, four client-reachable queries that escaped visibility review,
a reply that could be grafted onto another engagement, and a public reply under
an internal comment that would have confirmed a hidden thread exists. None of
those were found by reading the code.

Two things it did *not* catch, both now closed: `npm run verify` did not prove
the build (a `'use server'` file exporting a non-async const passes typecheck
and lint and fails page-data collection), and the visibility guard originally
enumerated client-reachable queries by *signature*, which turned out to be
escapable by composing one out of already-registered pieces. It now enumerates
by reachability from the client routes.
