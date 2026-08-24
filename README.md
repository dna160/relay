# Relay — Technical Delivery Package

A per-engagement collaboration workspace for agencies and their clients. One
contract, one workspace, one link — board, files, approvals, and sign-off in a
single object that expires when the work is done.

This repository is the **plan**, not yet the product. It contains the PRD, the
architecture and its decision records, the data model, the API contract, the
design system, a phased build plan with a handover protocol, and the three code
files that encode the system's core invariants.

## Read in this order

| Doc | What it settles |
|---|---|
| `docs/PRD.md` | Problem, thesis, scope, what was cut and why |
| `docs/ARCHITECTURE.md` | Stack, eleven ADRs, system shape, file tree |
| `docs/DATA-MODEL.md` | Tables, enums, indexes, retention timeline |
| `docs/API-CONTRACT.md` | Endpoints, shared types, error codes |
| `docs/DESIGN-SYSTEM.md` | Tokens, type, the possession bar, copy rules |
| `docs/BUILD-PHASES.md` | Nine phases and the session handover contract |
| `CLAUDE.md` | What Claude Code reads at the start of every session |

## Starting the build

Open this directory in Claude Code and say:

> Read CLAUDE.md, then docs/state/PROGRESS.md, then the current phase file.
> Execute that phase only.

Claude Code will start at Phase 0, which builds the scaffolding and the invariant
harness before any feature code exists. Each session ends by running
`npm run verify`, updating `docs/state/PROGRESS.md`, and writing
`docs/state/HANDOVER.md` for the next one.

## The idea behind the scaffolding

Long builds lose context because prose gets summarised and summaries drift. The
ten invariants in `CLAUDE.md` are therefore written as tests, not as guidance —
`tests/invariants/` fails the build when the system stops being what it was
designed to be. Documentation records what was meant; the test suite records
what is still true. When those disagree, the suite wins.
