# ADR-020 — the invariant-weakening gate is overridden once, with evidence

**Status:** accepted, by the architect
**Scope:** the hardening sweep, `7a98782` → `HEAD`

## Context

`.github/scripts/check-invariant-weakening.mjs` fails a change that removes an
`it(`, an `expect(`, or a `describe(` from `tests/invariants/`, unless the
change is explicitly labelled. It reports **10 removals** across this sweep and
one more for INV-3.

The gate exists because "never edit an invariant test to make a build pass" is
unenforceable as prose. It deliberately **cannot** tell a rename from a
deletion, and it should not try — a checker clever enough to approve a
"harmless" rewrite is a checker that can be argued with, and this one cannot.

So the override is the designed path, not a defeat. What matters is that it is
paid for in evidence rather than in assertion. QA asked me explicitly not to
wave it through on its say-so. I did not.

## What I verified, myself

| Suite | Before | After | Verdict |
|---|---|---|---|
| INV-7 | 6 `it(` blocks, every one an `expect.fail('Phase 6: …')` stub inside `describe.skip` | 16 cases, 11 against live Postgres, five real SIGKILLs to a child process, every rerun yielding exactly one certificate | Coverage created, not removed |
| INV-9 | 3 cases; the removed one scanned **only** `route.ts` and matched a single physical line | 5 cases; the whole app layer, plus a raw-SQL bypass check and a stated reason for the one exclusion | Strictly broader |
| INV-10 | 3 cases; "no **route** streams object storage bytes" | 4 cases; "nothing **on the server** streams", plus a presign-not-fetch check on the storage helper | Strictly broader |
| INV-3 | migration text scan asserting `num_nonnulls(...) = 1` | 10 cases against a live database, including the anonymous row an erasure leaves | See below |

INV-3 is the one that would have been a genuine loss if taken on trust, and it
is the reason this ADR exists rather than a commit message.

Its old assertion **still passes with the constraint dropped from the live
database.** It scanned migration `0002`'s `CREATE TABLE` text, and a committed
migration cannot change — so it pinned history while claiming to describe
behaviour. QA proved it on a throwaway database: constraint present, hostile
insert refused; constraint dropped, hostile insert **accepted**; migration-text
assertion passing in both columns.

The claim is now split by who can actually enforce each half. The database owns
*at most one decider, agreeing with its side* — a CHECK, tested by insert. The
domain owns *exactly one at write time* — because after an erasure Postgres
genuinely cannot distinguish "never had a decider" from "had one, and they were
erased" (ADR-019's sibling, migration `0004`).

## Decision

Approved for this sweep only. The gate stays exactly as strict.

## The pattern worth recording

Four times in this build, a guard read something narrower than the invariant it
claimed to enforce:

1. A **signature**-based scan — escaped by composing a client-reachable read out of already-registered pieces.
2. A **lowercase** match, mine — `clientScope` where the subject was the type `ClientScope`.
3. A **line**-based scan — escaped by a newline, because the house style wraps chains.
4. A **frozen file** standing in for a live database — INV-3, above.

Each was green while defeated. The lesson is not "write better regexes": it is
that **an invariant asserting something it cannot observe is worse than no
invariant, because it is believed.** When a guard cannot reach its subject,
move the guard to where the subject is — which is why INV-3 and INV-7 now run
against Postgres, and why `npm run test:db` exists as a separate, auditable gate
rather than a silent skip inside the portable one.
