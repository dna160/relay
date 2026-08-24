# HANDOVER — written after phases 0–4, for the Phase 5/6 session

> Overwrite this file each session. It is a note to the next session, not a log.
> What is true now / what I changed / what will bite you / start here.

## What is true now

`npm run verify:all` is green: typecheck, lint, `next build`, 341 unit tests and
113 invariant assertions across 9 of 10 enforcing suites. Phases 0–4 are
complete, 5 and 7 are partial by deliberate choice (see PROGRESS.md).

Both surfaces exist and build. The client board and queue ship **178 B** of
route JS on a 103 kB shared baseline — server components end to end, which is
how the 1.5s-on-4G budget is met. The agency and client bundles are provably
separate: the audit is negative-controlled, and reintroducing the leak produces
12 hits including the entire agency route map inlined into a client chunk.

## What will bite you

Read these before you touch anything.

1. **No Postgres has ever run this code.** Docker Hub was unreachable on the
   build machine. The three migrations, the seed's insert ordering, the
   `LISTEN`/`NOTIFY` reconnect path, the Auth.js session cookie name,
   `FOR UPDATE` locking, and both `approvals` CHECK constraints are compile- and
   SQL-compile verified and **never executed**. Your first task is
   `docker compose up -d db && npm run db:migrate`, and you should expect to find
   something. The likeliest single point of failure is the Auth.js cookie name —
   `authjs.session-token` versus the `__Secure-` prefix. Both are set.

2. **The handover gate is `npm run verify:all`, not `npm run verify`.** Plain
   `verify` does not run the build. A `'use server'` file exporting a non-async
   const passes typecheck and lint and fails page-data collection — that shipped
   in round 3 and only the build caught it. `verify:all` needs dummy env:
   `DATABASE_URL`, `AUTH_SECRET`, `CLIENT_LINK_SECRET`, `NEXT_PUBLIC_APP_URL`.

3. **`docs/API-CONTRACT.md` has an Amendments section, A1–A12, and it
   supersedes the body of that document.** A1 in particular corrects a
   contract-level INV-6 violation: the frozen contract specified one SSE stream
   taking `?engagementId=`, which for a client session is precisely what INV-6
   forbids. Do not implement from the body alone.

4. **The visibility guard enumerates by reachability, not signature.** Any query
   transitively reachable from `src/app/api/client/**` needs a case in
   `visibility.spec.ts`. It was originally signature-based ("takes a
   `ClientScope`") and that turned out to be escapable by composing a read out of
   already-registered pieces. Do not "fix" a failure by removing the
   `ClientScope` parameter — that is the hole it was rebuilt to close.

5. **Never edit `tests/invariants/` to make a build pass.** There is a CI gate,
   `check-invariant-weakening`, that diffs against the PR base and fails on any
   removed assertion or newly-added `.skip`. Adding and tightening pass silently.
   A new `.skip` in that directory trips it even legitimately — put phase-gated
   skips in `tests/unit/` instead, as `comment-writer.spec.ts` does.

6. **`src/domain/card/transition-card.ts` is hardcoded into the INV-2 scan.**
   Moving the persister fails the build. That is intentional.

7. **Colour encodes possession, never urgency.** `--breach` is exhaustively one
   thing: `roundsUsed > contractedRounds`. Not overdue dates, not validation
   errors, not server errors — all of those are bold `--ink` with a leading rule
   and `role="alert"`. A reservation is only worth something if it is absolute.

8. **A contrast assertion cannot catch a wrong-but-legible colour.** This bit
   twice. `UNTENANTED_AGENCY` in `src/styles/a11y-contract.ts` asserts exact
   painted values per mode; keep it, and add to it rather than relying on ratios.

## What changed from the frozen delivery package

- Product renamed **Handoff → Relay**, recorded in the PRD with its date.
- Agency engagement routes are `/w/[id]`, not `/e/[id]` — a real Next.js route
  collision with the client's `/e/[token]`, which could not move because it is
  the link printed in emails. ARCHITECTURE.md corrected.
- Round counting increments in `transitionCard`, not `record-decision.ts` where
  PHASE-3 put it. An agency member can take the same edge via the transition
  route; two sites would disagree and that number ends up in an invoice dispute.
- **One npm dependency added** in the whole build: `railway`, under ADR-019,
  because Railway deprecated Config as Code with a hard 2026-12-01 cutoff and
  new services cannot opt in. `.railway/**` is now in tsconfig and eslint —
  dot-directories are skipped by both by default, and it was the only TypeScript
  here that nothing checked.
- Eight ADRs (012–019) were produced by the build itself, on top of the original
  eleven.

## Start here

1. `CLAUDE.md`, this file, `docs/state/PROGRESS.md`, then
   `docs/phases/PHASE-6.md`. Nothing else until a task names it.
2. `docker compose up -d db && npm run db:migrate`. Fix what that finds before
   writing anything new — every phase after this one inherits it.
3. Run the e2e suite. 22 tests exist and have never executed. They are the real
   check on phases 1–4, and until they run those phases are complete only in the
   sense that a compiler agrees with them.
4. **Then** Phase 6. It is the one with the largest blast radius: purge is
   irreversible by design, so build `purge:plan` and the four warnings before
   anything that deletes. INV-7 is the last skipped suite.
5. Before Phase 6 writes the certificate, get PRD §9's tombstone-vs-certified-
   destruction decision resolved. The certificate's legal wording depends on it
   and it is cheaper to answer now than to reword a compliance artifact that has
   already been emitted to a client's legal team.
