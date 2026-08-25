# HANDOVER — after Phase 9's build, for the session that closes the shadow window

> What is true now / what changed / what will bite you / start here.

## What is true now

`npm run verify` green — **632 assertions** (487 unit, 145 invariant).
`npm run test:db` 40 passed. `next build` clean. e2e **86/86** with object
storage present; two tests refuse to conclude without it rather than passing
vacuously.

Phases 0–6 are complete, 5 and 7 partial, 8 not started. **Phase 9 is built but
not done** — see below. Phases 10–13 are specified with phase files.

## Phase 9 is not finished, and it is not supposed to look finished

The schema, backfill, `resolveAccess()` and the shadow harness are all in and
measured. `resolveAccess()` p99 is **1.024 ms** against a 5 ms NFR, on 275,000
project memberships, with no sequential scan. The backfill is idempotent and
reversible, proven by an md5 census of all 26 tables being byte-identical
before a run and after its rollback.

**None of that is the exit condition.** The exit condition is seven consecutive
days at zero shadow disagreements, then deleting the old path, then unskipping
INV-11's behavioural half. `npm run access:shadow` is the gate and it says
`NOT YET`.

Do not shorten this. The v1.1 handover named it as the trap, and the reason is
that everything about the new code looks right — which is exactly the state in
which people delete the thing that would have told them otherwise.

## What will bite you

1. **The harness has no flag that returns the new answer.** That is deliberate:
   a wrapper with one is a wrapper someone flips during an incident. If you want
   the new answer in production, you have finished the window.
2. **`daysLive` is 0 until a row exists.** An empty table cannot distinguish a
   clean week from an unwired harness, so the dashboard refuses to unlock on
   emptiness alone. Do not "fix" this.
3. **Explicit `project_memberships` were written only for v1 `member`s.** Admins
   derive under D3. A row for everybody was simpler and would have made the
   harness agree trivially — with the org-derived branch never executing, so
   seven clean days would prove only that the backfill ran.
4. **Reviewers are not shadowed**, deliberately: `resolveAccess()` answers for
   accounts, and a reviewer is a `client_contacts` row with no account. Stated
   in the file so the gap is a decision rather than an omission.
5. **The deprecated positional overloads** on `countActiveEngagements` /
   `evaluatePlanGate` / `assertCanOpenEngagement` are dated to the same step 4.
   The shim throws if its rows span more than one organization, so it cannot
   become the silent cross-tenant count it is being retired for.
6. **`engagement` in code is `project` in the PRD.** Still the same object.
   Phase 11 at the earliest, and only if free.

## Start here

1. `npm run access:shadow`. If it says `NOT YET`, Phase 9 is not done and the
   answer is to leave it running, not to work around it.
2. While it runs, Phase 10 (auth and invites) is unblocked and independent —
   `docs/phases/PHASE-10.md`. Its trap is the mail scanner: a GET on the sign-in
   link twice, before any human acts, must leave the token valid.
3. D4 and D5 still block Phase 12. D1/D2/D3 are answered in ADR-022.
4. **Deploy and rollback have still never been executed.** Carried since Phase
   8, and the largest open risk in the build.
