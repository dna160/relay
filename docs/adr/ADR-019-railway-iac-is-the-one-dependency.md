# ADR-019 — `railway` is added as a devDependency, and `.railway/**` joins the toolchain

**Status:** accepted, by the architect, round 3
**Supersedes:** nothing. **Related:** QA round-2 defects 5 and 6, which are one decision.

## Context

Four agents built this over four rounds and added **zero** npm dependencies —
including declining `@dnd-kit` (the keyboard path sets the accessibility floor,
so the library would have been additive polish) and hand-writing an incremental
SHA-256 rather than pulling one in (`crypto.subtle.digest` takes a whole buffer
and the ceiling is 5 GB). CLAUDE.md's standing rule is that no dependency is
added without an ADR. This is that ADR, and it is the first.

Railway **deprecated Config as Code**. `railway.json` and `railway.toml` keep
working for services that already use them until **2026-12-01**, and new
services *cannot opt into them at all*. A fresh Relay project therefore cannot
be stood up from the `railway.json` in this repository. QA wrote the replacement
at `.railway/railway.ts`, which imports from `railway/iac`.

Two problems followed:

1. `railway/iac` is not installed, so the file that a new production environment
   is built from does not compile.
2. `.railway/**` is a dot-directory, and both `tsc` and `eslint` skip those by
   default — so it was **the only TypeScript in the repository that nothing
   typechecked**. A topology unit test guarded its *values*; nothing guarded
   that it was valid TypeScript at all.

## Decision

Add `railway@^3.11.0` as a **devDependency**, and bring `.railway/**` into both
`tsconfig.json`'s `include` and the ESLint flat config.

Verified before adopting: `railway@3.11.0` exists and its `exports` map does
publish a `./iac` subpath. That check is recorded here because "the package the
config imports does not exist" is a failure mode that surfaces at deploy time,
in the middle of an incident, on the one file nobody can test locally.

## Why this and not the alternatives

**Keep `railway.json`.** Not available. New services cannot opt in, so the first
person to stand up a fresh environment — which is *by definition* someone
without a working one to copy — is blocked. The deprecation is also dated, so
this is a bill that arrives whether or not we open it now.

**Hand-write the config as untyped JSON/YAML.** This is what `railway.json`
already is, and it is what produced the defect: the runbook snippet it was
lifted from omitted `preDeployCommand`, so the first IaC deploy would have
served traffic against an un-migrated database. A typed config makes that class
of omission a compile error rather than an outage.

**Leave `.railway/**` outside the toolchain.** Rejected on the same grounds the
whole build rests on: a constraint a machine cannot check is not a constraint.
`docs/BUILD-PHASES.md` says context is preserved by types, migrations and the
invariant suite — a file excluded from all three is outside that guarantee, and
it is the file with the largest blast radius in the repository.

## Consequences

- It is a **devDependency**. It is never imported by `src/`, never bundled, and
  never reaches the app runtime. An invariant-style check would be cheap if it
  ever needs enforcing.
- `npm run verify` now typechecks and lints the deploy topology, so the
  topology test in `tests/unit/railway-topology.spec.ts` becomes a floor rather
  than the only thing standing between us and a malformed config.
- The "zero dependencies" property is now "one devDependency, under an ADR,
  because a vendor deprecated the alternative". That is the rule working, not
  the rule breaking.
- **Still unexecuted.** Nothing here has run against a real Railway project.
  Deploy and rollback remain the largest open risk in the build (PHASE-8, and
  `docs/state/VERIFICATION.md` §5).
