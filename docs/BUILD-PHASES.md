# Build Phases & Handover Protocol

Nine phases. Each is sized to fit comfortably in one Claude Code session with
room to spare — the constraint is not effort, it is context. A phase that needs
two sessions is a phase that was scoped wrong; split it rather than continuing
past a degraded context window.

## The handover contract

Context is not preserved by prose. Prose gets summarised, and summaries drift.
Context is preserved by **constraints a machine can check**: types, migrations,
and the invariant suite. Documentation says what we meant; `npm run verify` says
what is still true. Every phase therefore ends by leaving behind machine-checked
facts, not just notes.

Each phase file carries the same six sections:

```
ENTRY        what must already be true (verified, not assumed)
SCOPE        the only things this session touches
OUT          adjacent work that belongs to another phase — do not start it
EXIT         checkable conditions; every one has a command or a test
INVARIANTS   which of INV-1..10 this phase introduces or strengthens
HANDOVER     what to write into docs/state/HANDOVER.md before stopping
```

### Session close checklist

1. `npm run verify` passes. If it does not, the phase is not done — do not write
   a handover that says it is.
2. Update `docs/state/PROGRESS.md`: tick the phase, note anything deferred.
3. Overwrite `docs/state/HANDOVER.md` using the template in that file.
4. Commit with `phase(N): <summary>`.

### Rules that keep integrity across sessions

- Never read more than `CLAUDE.md`, the two state files, and the current phase
  file at session start. Everything else is read on demand, when a task in the
  phase names it.
- Never edit a file in `tests/invariants/` to make a build pass. If an invariant
  test fails, the code is wrong.
- Never carry a decision only in a chat message. If it changes behaviour, it goes
  in an ADR or a type.
- If you find yourself unsure why something is the way it is, stop and read the
  ADR before changing it. Most of these decisions have a failure mode behind
  them.

---

## PHASE 0 — Scaffolding & guardrails
Repo, TypeScript strict, Tailwind, Drizzle, Postgres, pg-boss, CI, and the empty
invariant suite with all ten tests present and skipped. `npm run verify` wired
end to end.
**Exit:** clean install boots, migrates, and verifies on a fresh machine.
**Why first:** the invariant harness has to exist before there is anything to
protect, or it never gets built.

## PHASE 1 — Tenancy, identity, engagement lifecycle
Organizations, users, engagements, client contacts. Auth.js magic links for both
sides. Engagement create / wrap / archive. `countActiveEngagements()` and the
plan gate returning `PLAN_LIMIT_REACHED`.
**Exit:** INV-6 and INV-8 unskipped and passing.

## PHASE 2 — Board core
Lanes, cards, positions, and `domain/card/state-machine.ts` as the sole writer of
`cards.state`. `state_transitions` written on every move. Both projections in
`domain/projection/`. Drag reorders position only.
**Exit:** INV-1, INV-2, INV-5, INV-9 unskipped and passing.

## PHASE 3 — Assets, versions, approvals
Presigned upload, sha256 on completion, append-only versions, the internal
publish gate, decisions bound to a version hash, revision notes threaded to
versions, round counting.
**Exit:** INV-3, INV-4, INV-10 unskipped and passing.

## PHASE 4 — Client surface
`(client)/e/[token]` — magic link, verify, published board, decision queue,
decision bar, comments, free export. No agency chrome in this bundle.
**Exit:** a Playwright run completes invite → verify → approve without ever
touching an agency route; INV-1 extended to cover every new client query.

## PHASE 5 — Time intelligence
Possession clock derived from `state_transitions`. Rounds used vs contracted.
The attention model and portfolio `AttentionList`. Nudge jobs on stalled
`awaiting_client` cards.
**Exit:** possession totals recomputed from transitions match a fixture within
1s of tolerance; no denormalised totals anywhere.

## PHASE 6 — Ephemerality
Archive sweep, the four warnings to both sides, export, purge worker, deletion
certificate. Dry-run mode with a printed manifest.
**Exit:** INV-7 unskipped and passing; purge is idempotent under a forced
mid-run failure; no purge path can run without having emitted warnings first.

## PHASE 7 — Templates, white-label, plan gates
`applyTemplate()` as a pure function. Runtime theming from org brand tokens.
Plan gates on active count, retention, and branding.
**Exit:** stamping a template twice produces structurally identical graphs;
theming cannot override `--client` or `--breach`.

## PHASE 8 — Hardening & deploy
Full e2e matrix, load test on the client board, Railway deploy for app +
worker + Postgres, error tracking, structured logs, rollback runbook.
**Exit:** deploy and rollback both executed once against staging.

---

## Sequencing note

Phases 1–3 build the spine and must run in order. Phase 4 depends on 2 and 3.
Phase 5 depends on 2. Phases 6 and 7 depend on 1 and 3 but not on each other —
if you have two agents, that is the only safe parallel seam in the plan.
Everything else has a real dependency and running it in parallel will produce
two half-correct implementations of the projection layer.
