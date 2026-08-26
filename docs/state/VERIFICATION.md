# VERIFICATION

> The audit surface. Every one of the ten invariants and every phase EXIT
> condition, mapped to the exact command or test that proves it — or marked
> **UNPROVEN** with the phase that will prove it.
>
> `docs/BUILD-PHASES.md` says every EXIT condition has a command or a test
> behind it. This document is where that claim is either true or visibly not.
> Read the **UNPROVEN** rows first; they are the whole point.

**Generated at:** the Phase 7 round. Phases 1–6 landed; **PHASE-7's exit condition closed** — it had been UNPROVEN since round 1 and closed the hour `applyTemplate()` existed (§4F); 8 outstanding; 9 awaiting its shadow window.
**Live Postgres:** yes, at last. Most of what §4 listed as never-executed has now executed, and the rows that have not are named individually rather than as a category.
**Owner:** QA. Update it in the same commit that changes what is provable.

## How to read a row

- **Command** — paste it and it runs.
- **Test id** — the file, then `describe > it`. Run one with
  `npx vitest run <file> -t "<partial name>"` or
  `npx playwright test <file> -g "<partial name>"`.
- **UNPROVEN** — nothing currently proves it. The phase named is the one that
  must. A row that has been UNPROVEN across two phases is a row to argue about.

## The commands

```bash
npm run verify:all    # verify + next build. THE HANDOVER GATE.
npm run verify        # typecheck + lint + unit + invariants. Portable: no infrastructure.
npm run test:db       # INV-7 and the failure-mode matrix. Needs Postgres; makes its own database.
npm run verify:db     # verify + test:db
npm run test:e2e      # Playwright, both projects. Needs a running app and a database.
node .github/scripts/check-invariant-skips.mjs     # the ten specs exist; skips name their phase
node .github/scripts/check-env-registry.mjs        # env drift: src -> .env.example -> runbook -> .railway/railway.ts
node .github/scripts/check-fcp-budget.mjs          # client board FCP on a throttled profile. Needs a production server.
node .github/scripts/check-chunk-purity.mjs --negative-control   # no agency code in the client bundle. Same requirements.
node .github/scripts/ensure-object-storage.mjs     # creates the bucket and round-trips an object. Run before the e2e suite.
node .github/scripts/check-upload-rss.mjs          # 200 MB upload vs the app's resident set. Needs a production server.
node .github/scripts/check-e2e-skips.mjs           # nothing skipped silently in CI. Reads playwright-report/junit.xml.
node .github/scripts/check-template-determinism-control.mjs   # PHASE-7's exit condition can be made to fail. 11 planted defects. Portable.
```

**Why `verify` no longer runs everything.** Two suites genuinely need a
database and are written to fail loudly rather than skip when one is absent —
a failure-mode matrix nobody interrupted proves nothing. Phase 0's exit
condition is that `npm run verify` works on a fresh machine with nothing
installed, so those two live in `vitest.db.config.ts` and run under
`npm run test:db`. The skip is a named config rather than a silent branch
inside a test that would have passed either way.

---

## 1. The ten invariants

| | Invariant | Status | Proven by |
|---|---|---|---|
| **INV-1** | No client response contains a private lane, private card, or internal field | 🟢 live | `tests/invariants/visibility.spec.ts` — **64 live cases**, up from 12. Incl. `INV-1 against the shared fixture board > leaks none of the strings the fixture marks as agency-only`. Extended by `tests/unit/client-projection.spec.ts` (25 cases: ordering, nullability, purity, version attribution). |
| | ↳ at the exported card serialiser | 🟢 live | `visibility.spec.ts > INV-1 at the exported card serialiser` — 5 cases incl. a negative control. The round-1 defect (`toClientCard` exported with no visibility check of its own) was fixed by the Architect; this suite asserts the fix. |
| | ↳ every client-reachable query has a case | 🟢 **live, and mechanical** | `visibility.spec.ts > INV-1 the query layer is enumerated, not remembered` — 10 cases. The layer is enumerated **by transitive reachability** from every client entry point, not by signature. See §6A. |
| | ↳ card-level discussion, on the write | 🟢 live | `visibility.spec.ts > INV-1 a reply cannot be grafted onto a thread it does not belong to` — 9 cases. `parent_id` is a bare self-reference, so before the back-end hardened `postComment()` a reply could be grafted onto another card, another engagement, or an internal root. Driven against a programmable fake driver, asserting on the **bound insert parameters** rather than the returned row — what the code decided to write, not what a fixture said. |
| | ↳ the untenanted default is the published colour | 🟢 live | `a11y-shell.spec.ts > the untenanted default is the published colour` — 4 browser cases (both modes, `--agency` and `--tint-agency`), plus 5 static cases in `a11y-contract.spec.ts`. **The case that proves a ratio assertion is not enough**: the drifted colour measured 5.690:1 and the published one 5.571:1, so every contrast check passed against a colour the product did not paint. |
| | ↳ an explicit theme choice reaches the body | 🟢 live | Same file — 8 browser cases across both system preferences and both choices, plus `<html>`/`<body>` agreement at three theme states, plus 5 static selector cases. Both palettes were internally valid, so only asking *which palette `<body>` received* could see this. |
| | ↳ card-level discussion, at the route | 🟢 live | `tests/unit/comment-writer.spec.ts` — 24 cases against the shipped `POST /api/comments`. `@/db/client` and `requireAgency()` are replaced; everything between them is the real handler taking its real branches in its real order. Covers the 404 for another org's card, the engagement/card mismatch that stops a valid card being smuggled under someone else's engagement, and `assertWritable` running **before** the insert (amendment A9). |
| | ↳ an internal comment announces nothing | 🟢 live | Same file, 4 cases. `publishEvent()` emits `pg_notify` through the same executor, so whether a frame was published is visible in the captured statements — the one assertion that looked like it needed a live bus does not. Includes the case the route cannot decide from its input: a reply forced internal by its root, where the publish gate must read the written row rather than the request. |
| | ↳ the client revision thread | 🟢 live | `visibility.spec.ts > INV-1 the client revision thread` — 8 cases; the comment thread gets its own, including the parent self-join that stops a public reply under an internal root from leaking. The three 404 paths (unpublished version, private lane, another engagement's version), their indistinguishability from each other, and the internal-note filter. |
| | ↳ at the query layer, in compiled SQL | 🟢 live | `visibility.spec.ts > INV-1 at the query layer, against compiled SQL` — 11 cases. Runs each client-reachable read against a fake driver and asserts the emitted predicate, so a read that forgets `clientScope()` fails on the SQL rather than on a projection shape. |
| | ↳ the two pre-session reads | 🟢 live | `visibility.spec.ts > INV-1 the two reads that happen before a session exists` — 6 cases. `loadLinkableEngagement` and `findContact` reach exactly one table each and return three thin columns between them. |
| **INV-2** | `cards.state` changes only via the state machine | 🟢 live, **and no longer escapable by line-wrapping** | `tests/invariants/inv-02-state-machine-sole-writer.spec.ts` — 3 structural scans, now reading **statements** rather than physical lines. The scan wanted `.set({` and `state:` on one line; the house style puts them on two, so a wrapped write was invisible. Negative-tested in `tests/unit/invariant-scans-are-not-escapable.spec.ts` (4 planted shapes, plus the proof the old line-based scan missed them). Behaviour: `tests/unit/state-machine.spec.ts` (15 cases). Concurrency: `tests/unit/failure-modes.spec.ts > two agency members transitioning one card cannot both win`. |
| **INV-3** | An approval binds one immutable version and stores its sha256 | 🟢 live (structural) **+ live database** | `inv-03-approval-binds-version.spec.ts` — 11 portable cases, and `inv-03-approval-binds-version.db.spec.ts` — 10 cases against a running Postgres (`npm run test:db`). The decider rule was being asserted by reading frozen migration text; it is now asserted with hostile inserts and `pg_constraint`. See DEFECT-10. |
| | ↳ under a live database | ⬜ skipped | Same file, `INV-3 under a live database` — 4 cases. **Phase 3** (needs Postgres). |
| **INV-4** | `asset_versions` is append-only | 🟢 live (structural + schema) | `tests/invariants/inv-04-versions-append-only.spec.ts` — 7 live cases: no delete outside the purge worker, only the two set-once columns updatable, hash/size/key never rewritten, `UNIQUE (card_id, version_no)`. |
| | ↳ under a live database | ⬜ skipped | Same file, `INV-4 under a live database` — 3 cases. **Phase 3 / Phase 6.** |
| **INV-5** | Every transition writes a possession row; the clock derives from it alone | 🟢 live | `tests/invariants/inv-05-possession-from-transitions.spec.ts` — 7 live cases: one insert in the sole persister, nothing else writes the table, no denormalised column in schema *or* migrations, totals recompute within 1s, sign-off stops the clock, the clock never reads `Date.now()`. |
| **INV-6** | A client session is scoped to exactly one engagement | 🟢 live (type + structural + schema) | `tests/invariants/inv-06-client-session-single-engagement.spec.ts` — 11 live cases. The retention sweeps are excluded from the list scan; the exclusion is paid for by three tests, not one. **Audited this round and strengthened** — see §5, *the exclusion was running unbacked*. |
| | ↳ at the session boundary | ⬜ skipped | Same file, `INV-6 at the session boundary` — 3 cases. **Phase 4.** |
| **INV-7** | Purge is total and leaves exactly one certificate | 🟢 **live — all six conditions, none by reasoning** | `tests/invariants/inv-07-purge-leaves-certificate.spec.ts` — 16 cases (5 structural, 11 against a live Postgres with real bytes on a real filesystem). **Five real SIGKILLs**, each parked deterministically rather than raced. See §4A. Run: `npm run test:db`. |
| **INV-8** | Active count is one function; billing and expiry never diverge | 🟢 live, **and the scan no longer reads one eighth of the tree** | `tests/invariants/inv-08-single-active-count.spec.ts` — 13 live cases, incl. `the two callers move together when the clock does` (counted + swept always equals running, at five clock offsets). Both scans read `sourceFiles('domain')` and nothing else until this round, so `src/db/queries/`, `src/workers/` and `src/app/api/` were invisible — and a definition of active that matters to billing is far likelier to be a `WHERE` clause than a comparison in the domain. Widening it found DEFECT-16. Negative-tested against 8 planted shapes in `invariant-scans-are-not-escapable.spec.ts`. |
| | ↳ on the stamping path | 🟢 live | Same file, `every plan-gate call site names the organisation` — a burn-down list asserted by equality, so a **new** caller on the deprecated positional form fails the build. Phase 7 added a caller. Behaviour: `template-stamping.db.spec.ts > a create refused by the plan gate stamps nothing and consumes no slot`. |
| **INV-9** | Business logic lives in `src/domain/` | 🟢 live, **and the surface is no longer just `route.ts`** | `tests/invariants/inv-09-domain-purity.spec.ts` — 5 scans. The write scan covered `route.ts` only; a server action in `actions.ts` or a server component in `page.tsx` reaches the database on identical terms and was invisible. Now `route|actions|page|layout`, read as statements. A raw-SQL scan was added; the health probe is excluded and that exclusion is paid for by a test pinning it to a table-free `select 1`. Also an ESLint rule; the test is what catches someone disabling the rule inline. |
| **INV-10** | File bytes never traverse the app server | 🟢 live, **and no longer a rule about a variable name** | `tests/invariants/inv-10-no-bytes-through-app.spec.ts` — 4 scans. Intake was pinned to a receiver called `req`/`request`: renaming the handler parameter to `r` let a 5 GB upload through a 512 MB container with the guard green. Egress scanned `src/app/` only, so the same stream in `src/lib/storage.ts` was invisible — it now covers `app`, `lib` and `workers`, and `storage.ts` is asserted to presign rather than fetch. Negative-tested against 6 planted intake shapes. |

### The v1.1 platform layer — specified, and one of the four now has a suite

| | Invariant | Status | Proven by |
|---|---|---|---|
| **INV-11** | All access decisions come from `resolveAccess()`. Deny by default | 🟢 **structural half live** / ⬜ behavioural half skipped | Two files, split for the reason INV-3 was split. **Structural:** `inv-11-access-resolution-is-one-function.spec.ts` — 24 live cases. **Behavioural:** `inv-11-access-resolution-is-one-function.db.spec.ts` — 74 cases, `describe.skip`, **UNSKIP IN: Phase 9 at EXIT**. See §6D. |
| | ↳ where a decision may be made | 🟢 live, and vacuous-by-design today | Structural file: nothing outside `src/domain/access/` may import a membership table, reach one in raw SQL, compare an account id, or branch on a role literal — and **nothing anywhere** may default a role. Negative-tested against 20 planted violations in `tests/unit/invariant-scans-are-not-escapable.spec.ts`, which is what stops "vacuous" meaning "blind". |
| | ↳ the resolution table itself | 🟢 live, portable | Same file — the 64-cell cube is asserted to *be* a cube: full cross-product of org role × project role × org scoping × the Studio-tier switch, both-null → deny in all four scopings, and the whole effect of ADR-022 D3 confined to six cells. Runs without a database. |
| | ↳ (org role × project role × object) against expected resolution | ⬜ **skipped, Phase 9 EXIT** | `…db.spec.ts` — 64 matrix cells plus 10 edge cases, against a real Postgres. Skipped because the Phase 9 shadow harness **returns the old result**: a green matrix over it would be asserting the answers of the system being replaced. |
| **INV-12** | An invite token never establishes a session | ⬜ not written | **Phase 10.** `check-invariant-skips.mjs` now requires the spec to exist from Phase 10 and to be unskipped from Phase 11. |
| **INV-13** | Ingestion never writes a project graph | ⬜ not written | **Phase 12**, live from 13. |
| **INV-14** | No inferred assignment triggers an outbound email | ⬜ not written | **Phase 12**, live from 13. |

**Command for the whole column:** `npm run test:invariants`
**Skip audit:** `node .github/scripts/check-invariant-skips.mjs`

Nine of ten v1 suites now execute, and INV-11's structural half joins them. At
Phase 0 handover it was four.

**The skip gate learned about the v1.1 four.** `check-invariant-skips.mjs` held a
flat list of ten and one rule — nothing skipped from Phase 8. The first v1.1
invariant to be written would have failed that gate the moment `PROGRESS.md`
reached Phase 8: a correct, deliberately-deferred suite failing the check that
exists to catch *undeclared* skips. It now carries a per-invariant `existsFrom`
and `liveFrom`, taken from `CLAUDE.md`'s own phase markings. The v1 ten are
unchanged at Phase 8; INV-11 must exist from Phase 9 and be live from Phase 10,
because PHASE-9 EXIT puts the unskip *after* the old path is deleted. Verified
in both directions: `--phase 8` still fails on INV-3, INV-4 and INV-6 and does
**not** fail on INV-11.

---

## 2. Phase EXIT conditions

### PHASE 0 — Scaffolding & guardrails

| EXIT condition | Proven by |
|---|---|
| Clean install boots, migrates, and verifies on a fresh machine | `npm ci && npm run verify` — CI job `verify`, matrix node 22 and 24. Migration half: CI job `e2e`, step `npm run db:migrate`. |

### PHASE 1 — Tenancy, identity, engagement lifecycle

| EXIT condition | Proven by |
|---|---|
| INV-6 and INV-8 unskipped and passing | `npx vitest run tests/invariants/inv-06-client-session-single-engagement.spec.ts tests/invariants/inv-08-single-active-count.spec.ts` — 16 live cases. ✅ **done as of this session** (both were still fully skipped). |
| `db:migrate` on an empty database succeeds; rerunning is a no-op | CI job `e2e`, steps `npm run db:migrate` then `migrations are idempotent`. Locally: `npm run db:up && npm run db:migrate && npm run db:migrate`. |
| Creating past the plan limit returns 402 `PLAN_LIMIT_REACHED` | Unit: `tests/unit/plan-limits.spec.ts > the plan gate > throws 402 PLAN_LIMIT_REACHED at the limit, not one past it`. E2E: `tests/e2e/agency/plan-and-lifecycle.spec.ts > the plan gate > creating past the limit returns 402 PLAN_LIMIT_REACHED` — **red**, no route. |
| A client session for engagement A returns 404 `NOT_VISIBLE` for B | 🟢 **PROVEN, executed.** `invite-verify-approve.spec.ts > a client session for one engagement cannot reach another (INV-6)` — green in a full 86/86 run. *Previously:* ⚠️ UNPROVEN — `tests/e2e/client/invite-verify-approve.spec.ts > a client session for one engagement cannot reach another (INV-6)` is written, and the routes and seed endpoints it needs now both exist. It has **never been run** — no Postgres in this environment (§4). The fixture holds one email on two engagements ready for it. First execution is CI's `e2e` job. |

### PHASE 2 — Board core

| EXIT condition | Proven by |
|---|---|
| INV-1, INV-2, INV-5 (transition-row half), INV-9 unskipped and passing | `npm run test:invariants` — all four live. INV-5's transition-row half: `inv-05 > every persisted transition appends exactly one state_transitions row`. |
| A PATCH carrying `state` returns 400 and does not write | Structural: `inv-02 > the API rejects state on the card patch route`. E2E: `tests/e2e/agency/engagement-flow.spec.ts > PATCH /api/cards/:id rejects a state field (INV-2)` — **red**, no route. |
| An illegal edge returns 409 `INVALID_TRANSITION` | Unit: `tests/unit/state-machine.spec.ts > error shape > carries the INVALID_TRANSITION code`. E2E: `engagement-flow.spec.ts > an illegal transition returns 409` — **red**, no route. |
| Every new query in `src/db/queries/` has a case in `visibility.spec.ts` | 🟢 **PROVEN, mechanically, by reachability.** `visibility.spec.ts > the query layer is enumerated, not remembered`. The guard walks the import graph out from every client entry point (`src/app/api/client/**`, `src/app/api/auth/client/**`, `src/app/(client)/**`) — 82 modules, 5 levels deep — and any query symbol travelling along it needs a case, whatever its parameter types say. See §6A for why the two earlier definitions were both escaped in practice. The traversal is itself tested: it must reach modules at depth ≥3, resolve both alias and relative specifiers, and never find an agency-only read on a client path. |

### PHASE 3 — Assets, versions, approvals

| EXIT condition | Proven by |
|---|---|
| INV-3, INV-4, INV-10 unskipped and passing | `npm run test:invariants` — INV-10 fully live; INV-3 and INV-4 live for everything checkable without a database, DB halves skipped and named. |
| A 200 MB upload completes without the app process RSS moving | 🟢 **PROVEN, and measured.** `node .github/scripts/check-upload-rss.mjs`, CI job `client board FCP budget and bundle purity`. **200 MB uploaded in 3.8s; the app process moved 0.0 MB** against a 48 MB budget. Open since round 1 and unmeasurable until object storage existed. Positive-controlled: pointed at a process that grows 300 MB inside the upload window it reports +299.1 MB and exits 1. See §4D. |
| A decision recorded, then the version re-read: stored hash still matches | Structural: `inv-03 > a recorded decision copies the version sha256 rather than referencing it` and `> never recomputes the stored hash from the version at read time`. Behavioural: `inv-03 > INV-3 under a live database` — **skipped, Phase 3**. |
| `changes_requested` with no note returns 400 and writes nothing | Domain-first check: `inv-03 > the domain rejects a note-less changes_requested before the constraint does`. Constraint: `inv-03 > the database refuses changes_requested without a note`. End to end: **skipped, Phase 3**. |

### PHASE 4 — Client surface

| EXIT condition | Proven by |
|---|---|
| A Playwright run completes invite → verify → approve without touching an agency route | `tests/e2e/client/invite-verify-approve.spec.ts > invite -> verify -> approve, touching no agency route`. The seed endpoints now exist (B7); **not executed — see §4**. The route claim is asserted at the request level by `RouteRecorder`, not inferred from the flow completing. The classifier it depends on is itself tested: `tests/unit/routes.spec.ts` (57 live cases) in `npm run verify` — and it was **wrong** until round 2: `/api/events` sat in `CLIENT_ROUTE_PATTERNS`, so a client page fetching the agency stream would have been classified as staying on its own side. Amendment A1 makes that the agency stream. Fixed, with five cases pinning the split. |
| INV-1 extended with a case for every new client query | 🟢 **PROVEN.** Same guard as Phase 2's row above. Eight client-reachable queries are enumerated and each has a compiled-SQL case; two more are excused in writing with a reason (the pre-session reads). A ninth appearing fails the build until someone writes its case — which it has done twice this round, catching `loadClientEngagementStatus` and `loadClientRevisionNotes` within minutes of them landing. |
| Client board FCP under 1.5s on a throttled 4G profile | 🟢 **PROVEN, and there is now exactly one budget.** `node .github/scripts/check-fcp-budget.mjs`, CI job `client board FCP budget and bundle purity`. **524 ms median against 1500 ms.** The e2e test this row used to name was **retired, not repaired** (DEFECT-7): it measured the sign-in page, and repairing it would have left two budgets for one NFR disagreeing about which build they measured — the dev server's number is not the number. See §4B. |
| The client bundle contains no agency route code | 🟢 **PROVEN, and now in CI.** `node .github/scripts/check-chunk-purity.mjs --negative-control`, same job. Reads the bytes the browser downloaded from a production build under a real client session — not the import graph. Detector covered portably by `tests/unit/chunk-purity-detector.spec.ts` (12 cases) inside `npm run verify`. Browser-level companion: `tests/e2e/client/board-performance.spec.ts > carries no agency route code in its bundle`, which now signs in first. See §4C. |

### PHASE 5 — Time intelligence

| EXIT condition | Proven by |
|---|---|
| Possession totals recomputed from a transitions fixture match within 1s | `tests/invariants/inv-05 > possession totals recompute from the transition fixture within 1s tolerance` and `tests/unit/possession.spec.ts > computePossession against the fixture` (6 cases + an exactness check). Fixture: `tests/fixtures/possession.json`. ✅ **passing today** — the implementation landed early. |
| A grep of `src/db/schema/` finds no denormalised possession column | `inv-05 > no table stores a running possession total` — scans `src/db/schema` **and** every committed migration. |
| INV-5 fully unskipped, including the "no running total" case | `npx vitest run tests/invariants/inv-05-possession-from-transitions.spec.ts` — 7 live, 0 skipped. ✅ |
| *(scope)* the attention model | ⬜ skipped — `tests/unit/possession.spec.ts > the attention model`, 4 cases. `src/domain/card/attention.ts` does not exist. |

### PHASE 6 — Ephemerality

| EXIT condition | Proven by |
|---|---|
| INV-7 unskipped and passing, including idempotency | 🟢 **PROVEN.** `inv-07-purge-leaves-certificate.spec.ts` — 16 cases, `npm run test:db`. Content census across all ten content tables goes to zero; the tombstone survives marked `purged`; the four warnings, the archive record and `purge.completed` survive; an ordinary audit row does not. |
| A purge killed at each step and rerun yields exactly one certificate | 🟢 **PROVEN, by killing it.** Five SIGKILLs, each rerun: `manifest`, `objects`, mid-`objects` (half the bytes gone), **inside the content transaction**, and after the certificate but before the tombstone. Every rerun ends at exactly one certificate, zero content rows, zero objects, four `done` checkpoints. See §4A for how each kill is made deterministic. |
| No purge path runs without four warning rows already recorded | 🟢 **PROVEN twice.** Three warnings on record → refuses, destroys nothing, writes no checkpoint. And the *inner* guard proved load-bearing: the purge is parked between the outer check and the transaction, the warnings are deleted while it waits, and the content transaction refuses and rolls back. Removing the inner check as redundant would destroy an engagement nobody warned. |
| `purge:plan` leaves every row count and object count unchanged | 🟢 **PROVEN two ways.** CI job `purge --plan smoke test` diffs `pg_stat_user_tables` around a real run. And `inv-07 > --plan prints a manifest and destroys nothing` spawns the real CLI and asserts the content census, the bucket listing, the certificate count *and* that no checkpoint row was written — a dry run writes nothing at all, not even bookkeeping. |
| The 30/60 timeline and the four warning offsets | 🟢 live now — `tests/unit/retention-dates.spec.ts`, 19 live cases: 30/60 arithmetic, offsets `[0,14,23,29]`, gaps `[14,9,6]` closing as the deadline approaches, a full day before the purge, retaining plans null rather than distant, days-to-purge rounding and clamping. |

### PHASE 7 — Templates, white-label, plan gates

| EXIT condition | Proven by |
|---|---|
| Stamping a template twice produces structurally identical graphs | 🟢 **PROVEN, and the proof has a negative control.** Portable: `tests/unit/template-determinism.spec.ts` — **73 live cases** against the real `applyTemplate()`. Database: `tests/unit/template-stamping.db.spec.ts` — 12 cases under `npm run test:db`, comparing two boards read back out of Postgres. Split for the reason INV-3 was split; see §4F. |
| ↳ and the comparison can fail | 🟢 live | `node .github/scripts/check-template-determinism-control.mjs` — 11 defects planted in a copy of `applyTemplate()`, the real spec required to go red against each. CI job `verify (node 22)`. **Three of the eleven survived its first run**, and the assertions that close them are named in §4F. |
| ↳ what the normalisation strips | 🟢 live, and enumerated | `template-determinism.spec.ts > the normalisation, stated` — the stripped-path ledger and the **kept**-path ledger are both asserted against literal lists, so widening the strip list is a diff a reviewer sees. Ids are *interned*, not blanked. §4F. |
| Theming cannot override `--client` or `--breach` | ⬜ skipped — `tests/unit/plan-limits.spec.ts > the branding gate > cannot theme away a breach warning`, plus two neighbours. **Phase 7.** |
| Plan gates read from one limits table and one active counter | 🟢 live — `inv-08 > the plan gate imports the counter rather than re-querying`, `> is the only file that spells the active-status predicate`, and `tests/unit/plan-limits.spec.ts > the limits table matches PRD §5.8 > agrees with the fixture table`. |

### PHASE 8 — Hardening & deploy

| EXIT condition | Proven by |
|---|---|
| Deploy and rollback both executed once against staging | ⚠️ **UNPROVEN, and not provable by a test.** Procedure written: `docs/RUNBOOK.md` §3 and §4. It has never been run. **This is the largest open risk in the build** — see §5. The topology it depends on is now typechecked and gated. |
| All ten invariant suites unskipped and green in CI | **CI job `invariant contract`** → `node .github/scripts/check-invariant-skips.mjs`, which fails at Phase ≥ 8 if any `.skip` remains. Verified to fail correctly: `node .github/scripts/check-invariant-skips.mjs --phase 8` exits 1 today and names all five. |
| Every destructive job is dry-runnable and logs its manifest before acting | CI job `purge --plan smoke test` (see Phase 6). Currently self-skipping. |
| Full e2e matrix, agency desktop and client mobile | `playwright.config.ts` — two projects, split by directory so a test cannot be written for the wrong audience. 22 tests across 4 files, all **red** pending routes. |
| Accessibility sweep against the DESIGN-SYSTEM floor | 🟢 **PROVEN, executed, and green.** Node: `tests/unit/a11y-contract.spec.ts` (87 cases) and `tests/unit/a11y-source.spec.ts` (11 cases) run inside `npm run verify`. Browser: `tests/e2e/{agency,client}/a11y-shell.spec.ts`, **61 tests, all passing** against a live server — visible keyboard focus and `prefers-reduced-motion` at both viewports, the white-label OKLCH clamp against seven hostile brand values, the locked-token wall, exact untenanted token values, and the theme selector. The three defects this suite found in round 2 are all fixed and the suite is green on them. |

---

## 3. CI gate map

| Job | Enforces | Blocking now? |
|---|---|---|
| `verify (node 22)` / `verify (node 24)` | `npm run verify:all` — typecheck, lint, unit, invariants, **and `next build`**. The build is in the gate because a `'use server'` file exporting a non-async const passes typecheck and lint and fails page-data collection; only the build caught it. Node 22 also runs `check-template-determinism-control.mjs`, which needs `node_modules` and therefore cannot live in the `invariant contract` job. | Yes — **green**. 731 live assertions (582 unit, 149 invariant), plus 52 under `test:db` — 783 in total, up from 672. The additions this round: PHASE-7's determinism suite (73) and its 11 planted defects, the stamping path under `test:db` (12), INV-8's widened reach (4) with 8 more planted shapes, and the deprecated counter's cross-org guard. Previously: INV-11's structural half (24) and its 20 planted violations, the bundle-purity detector and vocabulary liveness (16), the Code 39 decoder and barcode polarity (13), first paint (17), the JUnit skip parser (6), and the a11y stale-allowlist case. |
| `invariant contract` | All ten specs exist; every skipped suite names its phase; at Phase 8 none are skipped; nothing removed from `tests/invariants` without the `invariant-change` label | Yes — green |
| `build` | `next build` succeeds | Yes |
| `env registry` | Every `process.env` read in `src/` is in `.env.example`; every `.env.example` variable is in the runbook **and is set by `.railway/railway.ts`**; no `E2E_` variable reaches a deployed environment; no real secret is committed | Yes — **red on one line**: `NEXT_PUBLIC_APP_URL` (F7). `PGPOOL_MAX` was fixed by B8. |
| `e2e` | Playwright both projects; migrations idempotent; traces uploaded on failure | Yes — see §4 for the run status |
| `purge --plan smoke test` | A dry run prints a manifest and changes no row counts | Yes — Phase 6 landed the CLI, so this is now a real gate |
| `database-backed suites` | `npm run test:db` — INV-7's five SIGKILLs, INV-3's hostile inserts, the failure-mode matrix, PHASE-7's stamping path, and (skipped until Phase 9 EXIT) INV-11's 74-case matrix, against the job's Postgres. Creates and drops a database **of this run's own**, named with an epoch, a pid and a random tail, so neither another suite nor another *run* can truncate a table mid-assertion | Yes — **green**, 52 assertions, 74 skipped. DEFECT-12 fixed by the back-end |
| `client board FCP budget and bundle purity` | Two checks that need the same three expensive things — a production build, a database to seed, a real client session. (1) The ARCHITECTURE NFR over throttled Slow 4G with 4× CPU, failing over 1500 ms. (2) PHASE-4 EXIT: no agency route code in the client bundle, run with `--negative-control` so every push proves the detector can fail before believing that it passed | Yes — FCP **green at 524 ms median**, 976 ms headroom. Bundle purity newly adopted from a scratchpad script; first CI execution is the next push |

The env-registry gate gained a fourth link this round: `.env.example` →
`.railway/railway.ts`. The failure it now catches is a variable that is read by
the code, documented in `.env.example`, described in the runbook, and *still*
never reaches the running container because nothing in the deploy topology sets
it — a failure that survived all three of the previous checks.

---

## 4. What has never met a live Postgres

**There is a live Postgres now, and most of this section has collapsed.** What
follows is what it collapsed *to*: the rows that executed, and the rows that
still have not. The second list is short and specific, which is the point — a
category called "never met a database" is no longer an honest way to describe
the risk.

### Now executed

| Was unverified | Now proven by |
|---|---|
| The four migrations, applied to an empty database | 🟢 Executed on every `npm run test:db`: `tests/db-isolation.ts` creates a database from nothing and migrates it. Idempotency still comes from CI's `e2e` job running `db:migrate` twice. |
| Seed ordering | 🟢 `resetToFixtures()` runs on every FCP measurement and every e2e run. The insertion graph satisfies its foreign keys, in order, against a real Postgres. |
| Both CHECK constraints on `approvals` | 🟢 Executed. And `approvals_one_decider` **fires in production-shaped situations it should not** — see DEFECT-1 in §5. This is the row that most repays having been executed rather than read. |
| `FOR UPDATE` row locking | 🟢 `failure-modes > two agency members transitioning one card cannot both win` — two concurrent transactions, asserting no lost update. |
| The purge, end to end | 🟢 INV-7, 16 cases, five SIGKILLs. §4A. |
| The upload byte path | 🟢 **Executed for the first time.** MinIO in `docker-compose.yml` and in both CI jobs. `engagement-flow.spec.ts > upload -> publish -> awaiting client, with the bytes going direct (INV-10)` ran in 11.6s — a real 4-part multipart PUT — where it had previously skipped itself. See §4E. |
| The client session cookie, end to end | 🟢 The FCP gate signs a session with the product's own `signClientSession()` and the production build accepts it on `/e/<token>/board`. |
| The 30/60 retention arithmetic against real rows | 🟢 The INV-7 harness seeds `archive_at`/`purge_at` and the worker's own `isDue()` acts on them. |

### Still unverified

| Unverified | Why it can only fail somewhere this build has not been |
|---|---|
| The `LISTEN`/`NOTIFY` reconnect path | A dropped connection that never re-subscribes looks identical to a quiet engagement, and the client would show a stale board indefinitely. Nothing kills a `LISTEN` connection and watches for re-subscription. **Recommended:** the INV-7 harness already terminates backends on purpose — the same `pg_terminate_backend` aimed at the listener would settle this. Owner: back-end. |
| The Auth.js session cookie name under https | It changes with `AUTH_URL`'s scheme (`__Secure-` prefix). Everything here runs on http. First visible on a staging deploy. |
| `UNIQUE (card_id, version_no)` under a real race | The constraint exists and is asserted in the migration. Two genuinely concurrent uploads on one card have never run. INV-4's database half remains skipped and named. |
| Every 402/409/410/423 status code end to end | Asserted at the domain layer; the route-to-status mapping is exercised by the e2e suite, which has open defects of its own (§5). |

---

## 4A. The failure-mode matrix

Six ways this system can be interrupted, what happens, and what does the
interrupting. Everything here executes; nothing is a disposition arrived at by
reading the worker.

Run: `npm run test:db` (`tests/unit/failure-modes.spec.ts` and
`tests/invariants/inv-07-purge-leaves-certificate.spec.ts`).

| Failure | What happens now | Disposition | Proven by |
|---|---|---|---|
| **Database unreachable mid-request** | The backend is terminated mid-transaction. The driver rejects on the next statement, the whole transaction rolls back, and the pool serves the next caller. No half-written row survives. | ✅ Correct. | `failure-modes > a connection lost mid-transaction leaves no half-written row` — `pg_terminate_backend` against a live transaction that has already written two rows; both are gone afterwards. Plus `> the pool survives losing a connection`. |
| **Object storage unreachable mid-upload** | Bytes never touch the app (INV-10), so a failed upload is *silence*, not a broken stream: the browser's PUT fails and the confirm call never arrives. Presigning writes no row, so nothing is orphaned. On the purge side, a bucket that cannot be reached makes `remove()` **throw** rather than degrade. | ✅ Correct. The asymmetry is deliberate — listing may degrade, deleting may not. | `failure-modes > object storage unreachable mid-upload` — 3 cases: the presign route writes nothing, the version row is written by a separate step, and the storage adapter's `remove()` throws. |
| **Worker dies between purge checkpoints** | Resumable from the last completed step. The stored manifest is reused rather than rebuilt, so the certificate describes what was destroyed rather than the empty set a post-deletion rebuild would find. | ✅ Correct, at all five kill points. | INV-7, five SIGKILLs. The certificate is asserted to still say `objectCount = 4` after a kill inside the deleting transaction — a `0` there is the bug the stored manifest exists to prevent. |
| **Two agency members transitioning one card** | `transitionCard` reads the card `FOR UPDATE`, so the second writer blocks until the first commits and then branches off the *new* state. No lost update. | ✅ Correct. | `failure-modes > two agency members transitioning one card cannot both win` — two concurrent connections; asserts the two `state_transitions` rows do not share a `from_state`, which is what a lost update looks like. Plus a scan that the `FOR UPDATE` is still in the persister. |
| **A client verifying twice** | `verified_at` is set once, under an `IS NULL` guard. A second verification is a no-op; the first sign-in instant — the attribution every approval leans on — never moves. | ✅ Correct, including under a race. | `failure-modes > a contact verifying twice keeps its first verified_at`, and `> two verifications arriving at the same instant still produce one verified_at` (concurrent, exactly one row updated). |
| **Clock skew between app and database** | The app clock decides and is always passed in; no query asks Postgres what time it is, and `archive_at`/`purge_at` carry no column default. Both sides of every comparison move together, so drift shifts nothing. | ✅ Correct. The margin is days, not seconds. | `failure-modes > clock skew` — a scan proving no decision query uses SQL `now()`, a scan proving the retention domain never reads the clock itself, and a live check that an engagement ten days from purge does not read as due. |

### How the purge kills are made deterministic

A `setTimeout` racing a purge would pass on the runs where it fired too late
and prove nothing. Each checkpoint is parked instead:

- **Steps 1 and 2** are parked from inside the injected `ObjectStore` — it drops
  a sentinel file and then returns a promise that can never settle. The parent
  polls for the sentinel and kills. The store is a dependency the worker already
  takes; nothing about the worker changed to be testable.
- **Steps 3 and 4** have no injected seam, so they are parked from the database:
  the parent holds a `SELECT … FOR UPDATE` row lock on a row the step must
  write. Row locks leave the earlier steps' plain reads alone, so the child
  reaches exactly the statement we mean to interrupt. The parent watches
  `pg_stat_activity` for that backend to enter `wait_event_type = 'Lock'` and
  only then kills. That is an observation, not a delay.

The kill is `SIGKILL` to a child process, never a thrown exception. An exception
unwinds the stack, runs every `finally`, and lets drizzle send its `ROLLBACK`
politely. The failure RUNBOOK §6 is written for is a container that stops
existing.

**One thing this surfaced that is worth knowing at 3am:** the last statement of
a killed purge can still land *after* the kill. `UPDATE engagements SET status =
'purged'` is a statement of its own, and a backend blocked on a lock has not yet
noticed its client is gone — when the lock frees it runs the update, commits,
and only then discovers there is nobody to answer. Harmless, because step 4 is
idempotent. Not harmless if a future step 4 does something that is not.

---

## 4B. Performance budget — measured

ARCHITECTURE's NFR — *client board FCP under 1.5s on 4G* — had nothing behind
it. It now has a number and a gate that fails.

```
client board — First Contentful Paint
  profile   Slow 4G (1.6 Mbit/s down, 750 kbit/s up, 150 ms RTT), CPU 4x, Pixel 7 viewport
  samples   528ms, 528ms, 520ms, 532ms, 524ms
  median    528ms
  worst     532ms
  budget    1500ms
  OK — 972ms of headroom.
```

| | |
|---|---|
| **Command** | `node .github/scripts/check-fcp-budget.mjs` |
| **CI job** | `client board FCP budget` — required, fails the build over budget |
| **Measured against** | A **production build** (`next build && next start`). A dev server is unminified, unbundled and compiled on demand; its number would not be the number. |
| **Profile** | Chrome DevTools' *Slow 4G*, spelled out numerically in the script so a preset rename cannot silently move the budget. 4× CPU throttling, because the client is on a phone. |
| **Statistic** | Median of 5 navigations, each with a cleared cache. One throttled navigation is noisy enough to flake a gate, and a flaky gate gets deleted. |
| **Negative-tested** | `FCP_BUDGET_MS=400` → exits 1 with the overage. It is a gate, not a print statement. |

**It asserts it measured the right page.** An unauthenticated request to
`/e/<token>/board` renders the sign-in form, which paints faster than the board.
The script requires the final URL to still be the board and a published lane
from the fixtures to be in the DOM. This is not hypothetical — see the e2e
defect in §5.

**Headroom, in context.** 528 ms is measured against a local server, so it
excludes real network distance to the origin. The 150 ms RTT emulation covers
the round trips but not the geography. Treat 972 ms as the budget for
*everything the deploy adds*, and re-measure against staging once one exists.

---

## 4C. Bundle purity — adopted into CI

PHASE-4 EXIT: *the client bundle contains no agency route code.* The front-end
had been running this audit from a scratchpad script for three rounds and
negative-controlling it every time. It was correct every time. It was also not a
check: nothing failed when it stopped being run, and the first sign that the
leak had returned would have been a client downloading the agency board's
vocabulary.

It is now `.github/scripts/check-chunk-purity.mjs`, and CI runs it.

| | |
|---|---|
| **Command** | `node .github/scripts/check-chunk-purity.mjs --negative-control` |
| **CI job** | `client board FCP budget and bundle purity` — shares the job with the FCP gate, because both need a production build, a seedable database and a real client session, and standing up a second job for them would double the slowest part of the workflow |
| **Measured against** | The bytes the browser actually downloaded, across `/board`, `/queue` and a card page, on a **production build**, with a **real client session** |
| **Not measured against** | The import graph — a tree-shaken import is not a leak and a string folded into a shared chunk is one. Not a dev server. Not the sign-in page, which was DEFECT-7 in its bundle form: unauthenticated, `/e/<token>/board` renders a form with almost no JavaScript and therefore almost no way to leak, and the audit passed by measuring nothing |
| **Positive probe** | The two client decision-bar strings. If neither is found the run is reported **inconclusive and exits non-zero**, because "I read nothing and found no leak" is not a pass |
| **Negative control** | `--negative-control`, passed in CI. Re-runs the detector over the same downloaded bytes with the probe strings moved into the offender list and requires it to fail. A detector that cannot be made to fail on demand has not been shown to work |
| **Portable half** | `tests/unit/chunk-purity-detector.spec.ts` — 12 cases in `npm run verify`. The detector is pure and exported; its vocabulary, its per-marker and per-route coverage, its false-positive behaviour on `/api/client/*`, and the negative control's own shape are asserted in two seconds rather than after a six-minute build |

**Why the portable half exists as well.** The CI job can only report pass or
fail, once, after the expensive part. The thing that can silently break without
a browser is the *matcher* — an emptied vocabulary list returns no hits for
every input, forever. That failure has bitten every other guard in this
repository in a different costume, so it gets a test that runs on every commit.
What only the CI job can establish is that the audit read a production bundle
under a real session rather than an empty set, and the positive probe is what
makes that difference visible instead of silent.

**One thing tightened during adoption.** The scratchpad version dropped
`tests/e2e/routes.ts`'s bare `/w/` pattern when re-anchoring for a bundle, and
that judgement is now enforced rather than remembered: a portable case requires
every route pattern to be longer than five characters and every marker longer
than eight. Two characters of punctuation match constantly inside minified code,
and a false positive is how an audit gets ignored rather than fixed.

---

## 4D. Upload RSS — measured

PHASE-3's last EXIT condition, and the oldest UNPROVEN row on the board: open
since round 1. It was not neglected — it was **unmeasurable**, because neither
`docker-compose.yml` nor any CI job provided an S3 endpoint, so the presign
route 500'd and there was never an upload whose cost could be observed.

```
200 MB upload — app process resident set
  server    production build (next build && next start), pid discovered from the listening socket
  presign   multipart, 4 parts of up to 64 MB — the product's own route, real agency session
  baseline  182.1 MB (median of 10 samples, taken after the presign)
  peak      182.1 MB over 42 samples
  delta     +0.0 MB   (budget 48 MB)
  elapsed   3.8s
```

| | |
|---|---|
| **Command** | `node .github/scripts/check-upload-rss.mjs` |
| **CI job** | `client board FCP budget and bundle purity` — it already has the production build and the database; storage was added for it |
| **What it proves** | The app **serves the presign** — a real request, real route, real session — and then 200 MB crosses to storage without the app being in the path. The presign is fetched over HTTP rather than by importing `presignUpload()` on purpose: importing it would measure a library and say nothing about the server, and the question is whether the process that answered the request also carried the payload. |
| **Why a delta rather than equality** | A Node server's resident set breathes — JIT tiering, the pool, a GC that has not run. 48 MB is generous against that and two orders of magnitude below what buffering the body would cost. A regression that streams the upload through the app cannot hide inside 48 MB while moving 200. |
| **Positive control** | Pointed at a process that allocates 300 MB **inside the upload window**, it reports `+299.1 MB` and exits 1. |

**The control's first two attempts failed, and the reason is worth keeping.**
The grower allocated at 0.3s and then at 1.5s, and the check reported `+0.0 MB`
both times — not because the apparatus was blind, but because the growth had
already happened before the baseline was taken, so it was *in* the baseline.
A control that fires too early is indistinguishable from a measurement that
works. It now allocates at 6s, inside the window the upload actually occupies,
and the timing is stated in the control itself so the next person does not have
to rediscover it.

**Why the session is established out of band.** `/api/test/seed` and
`/api/test/session` refuse to mount when `NODE_ENV === 'production'` — that is
half of DEFECT-5's fix, and the half that makes those endpoints safe to ship at
all. Measuring a production build therefore cannot use them, and the answer is
not to relax the gate: `tests/agency-session.ts` calls the same
`resetToFixtures()` and `createTestSession()` those routes call, from the other
side of the process boundary, exactly as `tests/fcp-session.ts` already does for
the FCP gate. `createTestSession()` still signs in an existing user only, so it
cannot provision an admin. The presign — the part under measurement — still goes
over HTTP to the real route.

---

## 4E. The byte path, executed

INV-10 has been green since Phase 3 on four structural scans, and until this
round **the byte path had never run**. Neither `docker-compose.yml` nor the e2e
job provided an S3 endpoint; without one the presign route 500s, so no PUT was
ever made — and the e2e assertion *"no PUT reached the app server"* was being
made against a run containing no PUT in it.

That is a green light for an absent byte path, and it is the same shape as every
other escape this build has found: the guard reads something narrower than the
invariant claims.

Three things landed together, and all three were needed:

1. **MinIO** in `docker-compose.yml` — so `npm run db:up` brings up the whole
   spine — and in both CI jobs that need it.
2. **`ensure-object-storage.mjs`** — creates the bucket and proves the path with
   a put/get/compare/delete round trip through the same path-style client
   `src/lib/storage.ts` uses. Not a health check: *the port is open* is the same
   standard as *the URL answered*, which is what let a 500-ing stale dev server
   be adopted for a whole Playwright run (DEFECT-9). Negative-tested — wrong
   credentials fail immediately with a 403 rather than burning the timeout.
3. **`check-e2e-skips.mjs`** — the gate that stops this recurring. The two
   INV-10 tests skip themselves when storage is absent, which is *correct*; what
   was wrong was the job accepting it. Playwright exits 0 on a run where
   everything skipped, because the exit code answers "did anything fail" and the
   question here is "did everything run". This reads the JUnit report instead.
   There is deliberately no `--allow N`: the moment a skip budget exists, the
   budget is what gets edited. A test that genuinely cannot run in CI goes in
   `SANCTIONED` with a reason, where a reviewer sees it in a diff.

**Result: 86/86 e2e passing, zero skipped** — agency 42/42, client 44/44. The
INV-10 upload test ran for 11.6 seconds, a real 4-part multipart PUT, where it
had previously skipped in silence.

The skip gate is negative-tested end to end against real Playwright JUnit
shapes: a report with one skip exits 1 and names the test; the same report with
the skip removed exits 0; a missing report exits 1, because a suite that did not
run is the strongest form of the thing being checked for. Its parser has six
more cases in `tests/unit/e2e-skip-report.spec.ts`, including the self-closing
`<testcase/>` that a naive pattern misses — a parser that cannot see passing
tests reports `0 of 0` and calls it clean.

---

## 4F. PHASE-7's exit condition — and the three defects it did not catch

> **EXIT:** stamping a template twice produces structurally identical graphs.

Open since round 1, and not for want of anyone getting to it: `applyTemplate()`
did not exist. It landed this round and the row closed the same hour.

### Where the two halves live, and why

`applyTemplate()` is **pure by contract** — no executor, no `new Date()`, no
`uuidv7()`. The clock and the id factory are parameters. That is what makes
determinism assertable by *calling the function twice with counters* rather than
by inspecting a transaction, and a version that read the clock itself would make
this test a race. A race in a determinism test is the worst available
combination: it fails one run in fifty and gets deleted.

| | Where | What |
|---|---|---|
| **Determinism** | `tests/unit/template-determinism.spec.ts`, `npm run verify` | 73 cases, incl. the round trip through `deriveTemplateDefinition()`. Portable, on every commit, on a machine with nothing installed. |
| **The stamping path** | `tests/unit/template-stamping.db.spec.ts`, `npm run test:db` | 12 cases. The transaction, the column defaults, the plan gate on create, the jsonb column, org scoping. |

The same split INV-3 got, for the same reason: an invariant that can only be
checked where the infrastructure is is an invariant that goes unchecked on most
commits.

### What the comparison strips — the whole list

*Identical modulo ids and timestamps* is where a test like this quietly stops
testing anything, so the normalisation is not written inline. It is
`normaliseStamp()` in `tests/fixtures/template.ts`, and it reports **every path
it touched and every path it did not**. Both ledgers are asserted against
literal lists.

| Rule | Keys | Reaches, on a real stamp |
|---|---|---|
| **id** | `id`, `*Id`, `*_id` | `lanes[].id`, `lanes[].engagementId`, `cards[].id`, `cards[].laneId`, `cards[].engagementId` |
| **timestamp** | `createdAt`, `updatedAt`, `created_at`, `updated_at` | `lanes[].createdAt`, `cards[].createdAt`, `cards[].updatedAt` |

That is the entire list. Eight paths, two rules.

**`dueAt` is deliberately not stripped.** It looks like a timestamp and it is
not one of these: it is *derived* from `dueAfterDays` and the engagement's
start, both of which are inputs. Stripping it would erase a result, and it would
make the property the relative field exists for unassertable.

**Ids are interned, not blanked.** Each distinct id string becomes an ordinal
assigned on first appearance. A single `<id>` placeholder would erase the
graph's *wiring* along with its values, and `applyTemplate()` returns a **flat**
card list joined by `laneId` — precisely where a re-parented card could hide.
Interning is strictly more discriminating than blanking and still compares equal
across two runs that minted entirely different uuids.

**The kept ledger is the more important half.** If `title` or `visibility` ever
migrates into the strip list, it disappears from the kept list and the suite
fails — which is the exact shape "normalise until it goes green" takes. There is
also a value-shaped net: after normalisation, any surviving uuid- or
ISO-shaped string must be on a sanctioned list. That list is one entry long
(`cards[].dueAt`), so "did we enumerate every key?" is a mechanical question
rather than a hopeful one.

### Proving it can fail

Three batteries in the spec — 15 templates differing from the fixture in exactly
one field, 17 surgical mutations of a real stamped graph, and the inverse pair
(a fresh set of ids and a year of clock drift must **still** compare equal,
without which a normaliser returning `null` would pass everything else).

A sixth block asserts the **inverse function**: `deriveTemplateDefinition()` —
"save this board as a template" — must round-trip. `derive(stamp(def))` returns
the definition that stamped it, re-stamping the derived definition gives an
identical board, and the pair is a fixed point at an awkward 14:07:33 start,
which is where a rounded day count would be off by one and would be off by one
silently. Nothing tested that function before.

And then the one that mattered:
`node .github/scripts/check-template-determinism-control.mjs` plants eleven
defects in a copy of `applyTemplate()` and requires the real spec to go red
against each.

**Eight were caught. Three were not** — and all three were one shape:

> A stamp that is wrong the **same way twice** satisfies a comparison between
> two stamps perfectly.

| Planted | Why determinism could not see it |
|---|---|
| `card.contractedRounds \|\| default` | A card's own `contractedRounds: 0` swallowed by the template default. Both stamps swallow it identically. |
| every card re-parented onto `lanes[0]` | Every id still real, every count unchanged — and one of the lanes cards were moved *off* is private. |
| `createdAt: new Date()` | Purity broken; invisible because the comparison correctly strips timestamps. |

The fix was not to widen anything. It was to add the half a two-stamp comparison
structurally cannot make: `the stamped graph is what the definition described` —
five cases that read the graph **against the definition**, including a literal
table of every card's title, lane, position, resolved due date and resolved
contracted rounds, and a purity case asserting every row timestamp is the
injected `now` and every id came out of the injected factory exactly once. All
eleven are caught now, and the control runs in CI on every push.

### The four supplementary properties

| Property | Proven by |
|---|---|
| A private lane stamps a private lane | Portable: 4 cases, incl. that visibility is *stated* rather than left to the column default and that a definition may not omit it. Database: read back off `lanes.visibility` — `Internal QA` is `private` in the row. |
| A stamped card's state is the column default | Portable: `Object.hasOwn(card, 'state')` is **false** — not `state === 'draft'`, because a stamp writing `'draft'` would be a second writer of `cards.state` (INV-2) and would pass an equality check. Also: the definition parse is `.strict()`, so a template carrying `state` is a 400 rather than a silently stripped key. Database: every stamped row reads `draft`, and no `state_transitions` row exists. |
| `dueAfterDays` resolves against the engagement's start | Two engagements eleven days apart produce due dates eleven days apart, and their normalised graphs must **not** compare equal — the one place this suite's own equality is required to fail. Plus: day 0 is the start instant and not "no due date", and the due date does not move with `now`. Database: measured against the `started_at` that was actually written. |
| A definition round-trips through jsonb unchanged | Portable: a fixed point under three round trips, and a `version: 2` row fails loudly rather than being read by v1 rules. Database: through the real jsonb column, read back by the real parse, stamping a board that normalises equal to the in-memory one. |

---

## 5. Open defects

Full detail and ownership in the QA report to the Architect. Summarised here
because this is the document that gets audited.

### Closed since round 1

| # | Was | Closed by |
|---|---|---|
| 1 | `toClientCard()` exported with no visibility check of its own | Architect. 5 cases, incl. a negative control. |
| 2 | The `no-non-null-assertion` override was a no-op that read as a safeguard | Architect. Enforced, scoped to `src/`. |
| 3 | `eslint .` fails whenever `next-env.d.ts` is present | Architect. |
| 4 | `/api/health` does not exist while `railway.json` health-checks it | B4. Checks database connectivity, not just liveness. |
| 5 | The e2e suite needs three test-only endpoints that do not exist | B7. Gated on `E2E_SEED_TOKEN` **and** refusing to mount in production. |
| 6 | `PGPOOL_MAX` read by `src/` and absent from `.env.example` | B8. |
| 7 | `computePossession`'s optional third argument softened ADR-010 | B5. |
| 8 | Docs diverge from the code | Architect. Amendments A1–A7. |
| 9 | `.railway/railway.ts` does not exist and is unowned | QA (Q1). Written and gated by 14 assertions. |
| 10 | `POST /api/comments` did not exist, so `internal` could only ever be false and every defence around internal threads guarded an empty set | Back-end. Now covered live by `tests/unit/comment-writer.spec.ts` — 24 cases against the shipped handler. |
| 11 | Dark `--agency` painted rgb(0, 163, 144) while every document published `#499D8F` | UI/UX. `var(--brand-agency, #1f4e46)` routed the *default* through the tenant clamp, and in dark mode the chroma lift re-lifted an already-lifted colour. The hook is now undeclared and the clamp is a tenant-only branch. |
| 12 | `data-theme="light"` on `<html>` did not reach `<body>`: a reader on a dark system who chose light still got dark | UI/UX. `[data-relay-root]:not([data-theme='light'])` was satisfied by any `<body>`, which never carries the attribute. All four dark selectors are now descendant-scoped to the root's state. |
| 13 | The client magic-link fields were 38px tall at 14px, below both the 44px target floor and the 16px iOS-zoom floor | Front-end. `access-form.tsx` now uses the `Field` and `Button` primitives instead of the second vocabulary in `style-tokens.ts`. |
| 14 | `railway/iac` was not a dependency and `.railway/**` was outside tsc and ESLint | Architect, ADR-019. `railway@^3.11.0` added; the topology file is typechecked and linted, verified by planting an error and confirming `tsc` caught it. |
| 15 | The audience classifier put `/api/events` on the client side | QA (round 2). Amendment A1 makes it the agency stream; a client page fetching it would not have tripped the Phase 4 exit assertion. Five cases pin the split. |

### Open — found by the adversarial sweep

**DEFECT-1 — `ON DELETE SET NULL` and `approvals_one_decider` cannot both hold.
An organization cannot be deleted.** *Owner: back-end — `src/db/schema/assets.ts`,
migration `0002`.* **Severity: high.**

`approvals.decided_by_contact_id` and `decided_by_user_id` are both
`ON DELETE SET NULL`, and the table carries
`CHECK (num_nonnulls(decided_by_contact_id, decided_by_user_id) = 1)`. Nulling
either one on a row where the other is already null violates the CHECK, so the
delete fails. Reproduced against the live database — all three fail:

```
DELETE FROM client_contacts WHERE id = …   -- FAILS
DELETE FROM engagements     WHERE id = …   -- FAILS (cascade reaches contacts)
DELETE FROM organizations   WHERE id = …   -- FAILS (cascade reaches contacts)
```

Consequences, in increasing order of seriousness: a client contact who has ever
approved or requested changes cannot be removed; an engagement row cannot be
deleted, which blocks the ADR-007 30-day tombstone reaper that Phase 6
deliberately deferred; and **account deletion / GDPR erasure fails outright**,
because deleting an organization cascades to its contacts.

It is latent today only because nothing in the product deletes any of these —
the purge is careful to leave the engagement row standing, and `resetToFixtures`
uses `TRUNCATE`, which does not check constraints. The first feature that
deletes an account meets this on its first run.

Not fixed here: this is `src/**` and a schema decision, not a test fix. The two
plausible directions are `ON DELETE RESTRICT` on the decider columns — an
approval is evidence, so blocking the delete loudly is defensible — or relaxing
the CHECK to allow a "decider was removed" state. That is a product call.

**DEFECT-2 — a purge killed in one narrow window logs `purge.completed` twice.**
*Owner: back-end — `src/workers/purge.ts`, step 4.* **Severity: low.**

Step 4 writes the audit row and *then* marks the `finalize` checkpoint done. A
kill between the two leaves the audit row committed and the checkpoint
unfinished, so a rerun writes a second `purge.completed`. Reproduced by
recreating that exact state and rerunning: `purge.completed` went from 1 to 2.

INV-7 still holds — the certificate count stays 1, guaranteed by the unique
index. But `audit_log` is the evidence RUNBOOK §6 triages against, and evidence
that says the purge completed twice is evidence someone has to stop and explain.
The fix is the same shape as the certificate's: make the insert conditional on
the checkpoint, or move it inside a transaction with the checkpoint write.

**DEFECT-3 — every structural invariant was escapable by line-wrapping.**
*Owner: QA. **Fixed this round.*** Recorded because the shape will recur.

Every scan in `tests/invariants/` was built on `linesMatching`, which reads one
physical line. The escape needed no cleverness — it is what a formatter does to
a long drizzle chain:

```ts
await db
  .insert(cards)      // INV-9 wanted `db` and `.insert(` on one line
  .values(row);
```

Same for `.set({` / `state:` in INV-2. This is the same shape as the
signature-based escape found in round 2: **the guard reads something narrower
than the invariant claims.** Closed by `statements()` in
`tests/invariants/_source.ts`, and negative-tested against planted violations in
`tests/unit/invariant-scans-are-not-escapable.spec.ts` — which caught a bug in
the splitter itself on its first run.

**DEFECT-4 — INV-9 scanned only `route.ts`.** *Owner: QA. **Fixed this round.***
A server action in `actions.ts` or a server component in `page.tsx` reaches the
database on identical terms. `src/app/(agency)/signin/actions.ts` exists and was
never scanned. Nothing was hiding there; the hole was.

**DEFECT-5 — INV-10's intake scan was a rule about a variable name.**
*Owner: QA. **Fixed this round.*** The pattern required a receiver literally
called `req` or `request`. `export async function POST(r: Request)` followed by
`r.formData()` passed the guard. Egress scanned `src/app/` only, so the same
stream written in `src/lib/storage.ts` was invisible — and `storage.ts` is
exactly where someone would put it.

**DEFECT-6 — the INV-6 exclusion was running unbacked.** *Owner: QA (the
exclusion was the Architect's; the audit is mine). **Fixed this round.***

The verdict asked for: **the change was right, and its payment did not work.**
Excluding the retention sweeps from the list scan was correct — they are
definitionally multi-engagement and hold no session — and pairing the exclusion
with a compensating assertion was the right instinct. But the compensating
assertion looked for `clientScope`, lowercase, and the thing it needs to forbid
is the type `ClientScope`. Every one of these escaped it:

```ts
function sweepFor(scope: ClientScope, now: Date)          // escaped
import type { ClientScope } from '@/db/queries/client-scope';  // escaped
const scope: ClientScope = build();                        // escaped
```

Second weakness: the exclusion list and the payment list were the same array, so
a renamed sweep would silently make *both* vacuous — the scan would go on
excluding a path that no longer exists while the payment iterated an empty set
and passed. Now: the type is matched with its capital, the list is asserted to
name files that exist, and a third test checks the sweeps are unreachable by
import from any client route — reachability, not spelling, because spelling is
the half that can be renamed.

Net: no engagement was ever actually widened, and the invariant is stronger than
before the change. But for one round INV-6 was green on a guard that could not
see its own subject.

**DEFECT-7 — the client board FCP test measured the sign-in page.**
*Owner: front-end. **CLOSED this round, by retirement rather than repair.***

The spec navigated to the board URL without a session. That renders the sign-in
form, which paints faster than the board, so the budget passed for the wrong
reason — worse than having no budget, because a green gate is read as evidence.

The front-end **retired** the FCP test rather than fixing it, and that was the
right call for a reason beyond the missing session: it ran against a dev server,
which is unminified, unbundled and compiled on demand. Two budgets for one NFR,
disagreeing about the build they measure, is how a budget gets quietly relaxed —
the looser one is the one that never fires. `check-fcp-budget.mjs` is now the
single budget: production build, Slow 4G with 4× CPU, median of five cold
navigations, and it refuses to record a sample unless the final URL is still
`/board` and a published fixture lane is in the DOM. **524 ms against 1500 ms.**

The two tests that remained in that file are the ones that belong in an e2e
suite — what the browser *did*, not how long it took — and both now sign in
first. VERIFICATION's Phase 4 rows were still pointing at the retired test and
now point at the script.

**DEFECT-8 — two suites shared one database; a seed truncated a table
mid-assertion.** *Owner: QA. **Fixed this round.***

`POST /api/test/seed` TRUNCATEs every content table. Run alongside INV-7, it can
land between the `content` and `finalize` checkpoints, and the purge then
asserts against a row that no longer exists. The failure does not look like a
race — it looks like the purge wrote a wrong status, and it produced a wrong bug
report against a worker that was behaving correctly.

Two fixes, both landed. `tests/db-isolation.ts` gives `npm run test:db` a
database it creates and drops, so the question cannot arise. And the assertion
that misreported now checks the row exists first, with its own message: a
`toContain(rows[0]?.status)` cannot tell "wrong value" from "no row", and should
not have been asked to.

**DEFECT-9 — Playwright adopted a stale dev server answering 500 to
everything.** *Owner: QA. **Fixed this round.*** `reuseExistingServer` adopts
whatever is listening, and Playwright's readiness standard is "the URL
answered". A whole run was lost to it, and it did not look like a broken server
— it looked like forty broken tests. `tests/e2e-preflight.ts` now gates the run
on `/api/health` reporting `db: ok`, and the `webServer.url` probe points at the
health endpoint rather than the root.

**DEFECT-10 — INV-3 asserted the decider rule against frozen migration text.**
*Owner: QA. **Fixed this round.*** The fourth instance of one shape.

`createTableBody('approvals')` reads `CREATE TABLE` out of migration `0002`. A
migration is history — its text cannot change — so the assertion pinned what the
schema *was*, not what rows are checked against. When migration `0004` replaced
`num_nonnulls(contact, user) = 1`, the assertion went on passing while describing
a rule the product had deliberately abandoned. It would also have passed with the
live constraint dropped entirely.

Negative-tested on a throwaway database:

| | constraint present | constraint dropped |
|---|---|---|
| side disagrees with decider | refused by `approvals_one_decider` | **ACCEPTED** |
| two deciders named | refused by `approvals_one_decider` | **ACCEPTED** |
| `pg_constraint` enumeration | both CHECKs | one CHECK |
| **the old migration-text assertion** | passes | **passes** |

Now split by who actually owns each half. The **database** owns *at most one
decider, agreeing with its side* — asserted by handing Postgres eight rows it
must refuse and one it must accept, plus a `pg_constraint` enumeration that
notices a drop. `recordDecision()` owns *exactly one at write time*, which the
database cannot own: after an erasure it genuinely cannot distinguish "never had
a decider" from "had one, and they were erased". That half stays in the portable
suite as a scan that all three columns derive from one discriminated actor.

An invariant that claims the database refuses something the database does not
refuse is worse than no invariant, because it is believed.

**DEFECT-11 — the seed infers `decided_by_side` instead of reading it.**
*Owner: back-end — `src/db/test-support.ts:287`.* **Severity: low.**

```ts
decidedBySide: a.decidedByContactId !== null ? 'client' : 'agency',
```

Deriving the side from which FK is populated is precisely the derivation
migration `0004` exists to stop depending on. It is correct today only because
no fixture approval is anonymous. `tests/fixtures/board.ts` now carries
`decidedBySide` explicitly, so this should read `a.decidedBySide`. Until it
does, the fixture's stated side is written and then ignored. INV-3's portable
half asserts the fixture's side agrees with its ids, so the two cannot drift
into disagreement silently.

**DEFECT-15 — two concurrent `test:db` runs shared one database, and the
collision presented as 27 failures in someone else's work.** *Owner: QA.*
**Fixed this round.**

`tests/db-isolation.ts` was itself the fix for DEFECT-8 — two *suites* sharing a
database — and it left two *runs* sharing one. It created a single
`<database>_dbsuite` and opened with `DROP DATABASE ... WITH (FORCE)`.
`fileParallelism: false` serialises files within a run and says nothing about
two runs, and this repository has several agents working at once.

The back-end lost a run to it: a second `test:db` reached that `DROP` mid-suite
and every open connection died with `57P01 terminating connection due to
administrator command`. Twenty-seven failures, clean on retry.

**The evidence is the interesting part.** It does not present as a collision. It
presents as twenty-seven unrelated-looking failures in code that was never
wrong, and the retry that clears them is indistinguishable from flake — so a
whole investigation was spent establishing that the back-end's work was fine.
That is the same cost DEFECT-8 imposed, one level up.

The name now carries an epoch, a pid and a random tail, and the opening `DROP`
is gone: there is nothing of anyone else's to drop. **Proved by running two
`test:db` runs concurrently — both green, 40 assertions each.** Both landed in
the same millisecond, so the epoch alone would still have collided and the pid
is what separated them.

Unique names trade a collision for a leak: a SIGKILLed run — and this suite
kills processes for a living — never reaches teardown, and under a fixed name
that was self-correcting. So the epoch is *in* the name, and setup sweeps any
database matching the prefix older than two hours. No catalogue timestamp
needed, and no privilege beyond what creating the database already required.

**DEFECT-12 — the Phase 9 schema landed seven tables the purge worker did not
classify.** *Owner: back-end — `src/workers/purge.ts`, `TABLE_DISPOSITION`.*
**FIXED at `4fd6d6a`.** `access_shadow_disagreements` was classified **content**,
not diagnostics-exempt, because it holds per-project records of who tried to
reach what — the right call, and not the obvious one. `npm run test:db` is green
at 40. Kept below because the *shape* recurs: nothing about the purge changed;
the surface it had to cover grew underneath it.

```
inv-07 > every table in the schema has a disposition, so a new one cannot escape a purge
  access_shadow_disagreements, accounts, identities, org_memberships,
  project_memberships, team_members, teams
```

This is the guard working, not the guard breaking. INV-7's completeness case
exists precisely so that a table added by one phase cannot silently escape the
purge written in another, and Phase 9 added seven at once.

The dispositions are already specified and do not need a product decision —
DELIVERY-PLAN §IV: *"`project_memberships` rows are deleted; `accounts` are not
— the person outlasts the project."* ADR-021's consequences say the same thing
and add that the purge must now walk memberships rather than one engagement's
contact list. So the shape is: `project_memberships` is content;
`accounts`, `identities`, `organizations`, `teams` and `team_members` are not;
`access_shadow_disagreements` is a migration instrument that outlives the
project it names and should be classified deliberately rather than by default.

Not fixed here: `src/workers/purge.ts` is `src/**`. **This blocks PHASE-6's
"INV-7 unskipped and passing" from staying proven** — it was green last round
and is red now, which is exactly the transition this row exists to make visible.

**DEFECT-13 — the portfolio does not render plan usage.** **FIXED** — the
front-end mounted `plan-usage-record.tsx`; the agency suite is 42/42.

*Original report:*
*Owner: front-end / back-end (product gap, not a test bug). Reported by the
front-end; `tests/e2e/**` is not mine to edit.* **Severity: medium.**

`tests/e2e/agency/plan-and-lifecycle.spec.ts > the plan gate > the portfolio
shows the limit rather than only failing at the button` fails because the
surface does not exist. `src/components/agency/plan-usage-record.tsx` is
written and renders "3 of 3"; nothing on the portfolio mounts it.

The test is asserting the right thing and the right way round: a plan limit a
user only discovers by being refused at the button is a plan limit that reads as
a bug. **Blocks PHASE-7 EXIT** — the plan-gate row is proven for
*"read from one limits table and one active counter"* and unproven for the
surface that shows it — and **PHASE-8 EXIT "full e2e matrix, agency desktop"**.

**DEFECT-14 — a client download route reached with an agency session.**
**RESOLVED as a contract question**, not a code fix: the agency gets no download
route at all, and the redirect assertion moved to the client project where a
client session actually exists. A test asserting a route that should not exist
was the defect.

*Original report:*
*Owner: back-end (route behaviour) — reported by the front-end.*
**Severity: medium.**

`tests/e2e/agency/engagement-flow.spec.ts > a client download route is closed to
an agency session` fails. The test is an INV-10/INV-6 boundary case and it is a
good one: the two session kinds are separate namespaces, so a client route
handed an agency session must refuse *as though the object were not there* —
404, never 403, and never a redirect that confirms the object exists.

Worth stating plainly because the failure looks cosmetic and is not: an agency
session reaching a client download path is the one direction in which INV-6's
narrowing (ADR-021 §4, reviewer sessions stay scoped) could be read as
permission to be relaxed about the other kind. **Blocks PHASE-8 EXIT "full e2e
matrix"**, and it is the row PHASE-4's "touching no agency route" assertion has
no mirror for.

The remaining three of the five agency e2e failures the front-end reported are
test-level and belong to them; these two are the ones that need product work.

**DEFECT-16 — INV-8's scan read one eighth of the tree, and there is a second
`status = 'active'` predicate in the query layer.** *Owner: back-end —
`src/db/queries/attention.ts`. QA owns the guard hole.* **Severity: low as
behaviour, medium as a hole.**

Both of INV-8's predicate scans read `sourceFiles('domain')` and nothing else,
so `src/db/queries/`, `src/workers/` and `src/app/api/` were invisible to an
invariant whose stated claim is *one definition of active in this codebase*.
That is the fifth instance of one shape this build has found: **the guard reads
something narrower than the invariant claims.**

Widening the scan to the whole tree — the SQL form only, so the nine UI files
asking `status !== 'active'` ("is this archived") are not swept up — found
three predicates in one file:

```
src/db/queries/attention.ts   eq(engagements.status, 'active')   ×3
```

**The behaviour is defensible and the spelling is not.** What `attention.ts`
means is `isRunning()` — not archived, not purged — which is a genuinely
different question from PRD §5.6's *active*, and an attention list scoped the
other way would hide exactly the engagement that has gone quiet. But
`src/db/queries/retention.ts` asks the same question and deliberately writes no
such predicate: it loads the rows and asks the counter. `attention.ts` should do
the same, or import `isRunning` and filter in JavaScript.

Quarantined rather than ignored: the path is a **named** exclusion in the spec
with the reason written next to it, paid for by two tests that do not iterate
the same array (DEFECT-6's lesson) — the excluded path must exist, and it must
be **unreachable by import** from `domain/plan` or `domain/retention`, so
whatever it means by active can never become the number the plan limit is
checked against. A *new* offender anywhere in `src/` now fails the build.

Phase 7 is why this became urgent rather than theoretical: stamping creates an
engagement, so it passes through `assertCanOpenEngagement()`, and the templates
surface added a query file and two routes to a layer no scan was reading.

**DEFECT-17 — two agents running `next build` in one working tree corrupt each
other's `.next`, and it presents as missing pages.** *Owner: the build
convention, not any one file.* **Severity: low, and expensive to diagnose.**

`npm run verify:build` failed twice with `PageNotFoundError: Cannot find module
for page`, and **the set of missing pages changed between runs** — `/signin` and
`/w/[id]/c/[cardId]` the first time, `/_not-found`, `/templates` and
`/w/[id]/board` the second. `/_not-found` is the tell: it is generated, it has
no source of its own, and it cannot be missing for a reason that lives in `src/`.

`ps` found a second `next build` from another agent and a long-running
`next dev`, both writing the same `.next`. The build succeeded on the first
attempt after the other one exited.

Recorded because of the shape rather than the severity. It does not present as a
collision; it presents as **a handful of unrelated-looking page failures in
someone else's work**, and the retry that clears them is indistinguishable from
flake. That is exactly DEFECT-8 and DEFECT-15 one level up, in a third costume,
and the cost is the same each time: an investigation establishing that code
which was never wrong was not wrong.

The fix is the same shape as `db-isolation.ts`'s: give a run an output directory
of its own. `next.config.ts` would need to read `NEXT_DIST_DIR`, which is
`src`-adjacent and not QA's to change — hence a report rather than a patch. Until
then, `verify:all` is not safe to run concurrently in one tree, and that is
worth knowing before it is blamed on a page.

### Open — carried from earlier rounds

1. ~~**`src/components/agency/card-tile.tsx` animates outside the motion
   budget.**~~ **CLOSED this round.** The front-end replaced the hand-rolled
   `transition-opacity` / `motion-reduce:transition-none` pair with the
   `crossfade` token, whose duration resolves through `--dur-beat` — which
   `globals.css` sets to `0ms` under `prefers-reduced-motion`, so one
   declaration silences every duration in the codebase arithmetically. The
   allowlist entry in `a11y-source.spec.ts` is **deleted**: a subset check
   cannot tell a live exception from a spent one, and an allowlist that
   outlives its offender is a standing permission for whatever lands in that
   file next. A new case now fails on exactly that — every name on the list
   must still be an offender.
2. **`loadClientShelf()` is exported, covered, and reachable from nothing.** The
   reachability walk finds every other client query from a route; this one has
   no caller anywhere in `src/`. Either the client shelf surface was never wired
   or the function is dead. It has a visibility case either way, so this is a
   product gap rather than a safety one. **Owner: back-end / front-end.**
3. **The 22 data-driven e2e tests have never run.** Not for want of endpoints —
   B7 shipped them and they are correctly gated. Docker Hub is unreachable from
   this environment, so no Postgres exists here. See §4 for the full list of
   what that leaves unproven. **Owner: CI, on the next push.**
4. **The e2e suite runs against `next dev`, which is not the product.** The dev
   server injects a Dev Tools launcher — a 32px button, below every target floor
   this suite asserts — and it cost one false "the client surface misses its
   44px floor" before it was traced. The sweeps now exclude injected chrome by
   ancestry (`INJECTED_CHROME` in `tests/e2e/_a11y.ts`), so a genuinely
   undersized control still fails. The faithful fix is a `webServer` of
   `next build && next start`, which is slower and is a call for the next round.
   Worth stating because an accessibility suite that cries wolf gets its floor
   lowered rather than its bug fixed. **Owner: QA, next round.**
5. **Deploy and rollback have never been executed.** Phase 8's only EXIT
   condition a test cannot cover, and the largest open risk in the build. No
   longer blocked on tooling: `railway@^3.11.0` is a devDependency under
   ADR-019 and `.railway/**` is inside tsc and ESLint. **Owner: Architect.**
6. **Backups are Railway's defaults and no restore has ever been tested.**
   RUNBOOK §4c depends on one. **Owner: Architect.**

### Still UNPROVEN in this document

Two rows, and one of them is a deliberate deferral rather than a hole.

**PHASE-7's row is closed.** It had been UNPROVEN since round 1 for the honest
reason — `applyTemplate()` did not exist — and it closed the hour it did. See
§4F, and in particular what the negative control found: the eight defects the
determinism comparison caught are the easy half.

**PHASE-3's RSS row is closed** — 200 MB uploaded, the app process moved 0.0 MB
(§4D). It had been open since round 1, and it was never a matter of nobody
getting to it: with no S3 endpoint anywhere there was no upload to measure. It
closed the hour storage existed. **PHASE-6's INV-7 regression is closed too** —
the back-end classified the seven Phase 9 tables, and `access_shadow_disagreements`
went in as **content** rather than diagnostics-exempt, which is the right call:
it holds per-project records of who tried to reach what.

**And PHASE-1's row is closed by execution.** *A client session for engagement A
returns 404 for B* has been written and unrun since round 1 for want of a
database and then a full e2e pass. It ran:
`invite-verify-approve.spec.ts > a client session for one engagement cannot
reach another (INV-6)`, 3.1s, green. INV-6 is the invariant ADR-021 narrows
rather than retires, so having it executed rather than reasoned about matters
more now than it did when it was written.

- **PHASE-8** — deploy and rollback executed once against staging. Not provable
  by a test. No longer blocked on tooling: `railway@^3.11.0` is a devDependency
  under ADR-019 and `.railway/**` is inside tsc and ESLint.
- **PHASE-9** — the resolution matrix against the real graph. Deliberately
  deferred rather than missing: written, skipped, and gated to unskip at
  Phase 10 (§6D). Distinct from the two above in that the test exists and the
  condition for running it is written down; it becomes a genuine hole only if
  Phase 9 exits without the shadow-disagreement count reaching zero.

**The two exit conditions the agency e2e failures were blocking are unblocked.**
PHASE-7's plan surface renders (DEFECT-13) and PHASE-8's full e2e matrix is
**86/86 with zero skips** — agency 42/42, client 44/44. Recording them here was
worth it: `tests/e2e/**` is not QA's to edit, and a defect reported only into a
handover note is a defect nobody audits.

---

## 6. Recommendations from round 1 — both now built

**A. "Every client-reachable query has a visibility case" is mechanical.**
Built, and rebuilt twice after each earlier definition was escaped in practice.

- **By signature** — every exported function in `src/db/queries/` taking a
  `ClientScope`. Escaped by `loadClientVisibleNotes`, which takes a plain
  `engagementId` because its caller resolves visibility first. That is good
  composition, and it means a parameter type is not the boundary.
- **By direct import** — every query symbol a client route imports. Closes that
  hole and opens one exactly one module deep.
- **By transitive reachability** — the Architect's ruling, and what ships. The
  guard walks the import graph out from every client entry point
  (`src/app/api/client/**`, `src/app/api/auth/client/**`, `src/app/(client)/**`),
  resolving both `@/` aliases and relative specifiers, and collects every query
  symbol that travels along it. Currently 82 modules, 5 levels deep.

Symbol-level for `src/db/queries/**`, module-level everywhere else. That
asymmetry is deliberate: `revision-notes.ts` exports an agency-only read beside
a client-visible one, and flagging the whole file would demand cases for
functions no client contact can call.

**The traversal is itself tested**, because a reachability guard that silently
stops at depth one is indistinguishable from one that works. It must find
modules at depth ≥3, resolve both specifier forms, contain every direct import
as a subset, and — the assertion that would be an incident rather than a
coverage gap — never reach an agency-only read from a client entry point.

Each covered query then gets a case running it against a fake driver, asserting
the **compiled SQL**: the predicate, the bound parameters, the tables joined and
the columns selected. The 404 paths are asserted by running the same reads
against an empty result set and checking they refuse identically, since
distinguishable refusals confirm what exists.

Verified by mutation in all four directions: removing a registry entry, adding a
stale one, renaming a case title, and dropping a runner each fail and each names
the cause. The guard has caught three real gaps since it landed —
`loadClientVisibleNotes`, `loadClientEngagementStatus` and
`loadClientRevisionNotes` — two of them within minutes of the code landing.

**B. The accessibility floor has tests.** Built, in two halves.
`tests/unit/a11y-contract.spec.ts` and `tests/unit/a11y-source.spec.ts` run in
`npm run verify` with no browser (89 cases). `tests/e2e/{agency,client}/a11y-shell.spec.ts`
covers what only a browser can resolve (37 tests), against `/e/<token>/verify` —
the one route that renders the full shell while touching no database, so the
accessibility floor does not wait on the seed endpoints.

Both halves import their numbers from `src/styles/a11y-contract.ts`, which the
design layer owns. Nobody retypes a hex value, and `globals.css` is diffed
against that module so the two cannot drift apart silently.

### D. INV-11's resolution table, written twice on purpose

The DELIVERY-PLAN assigns INV-11 two tests: a static one for where a decision
may be made, and a runtime matrix of *(org role × project role × object)*
against expected resolution, including both-null → deny. Both exist. The split
between them is INV-3's, for INV-3's reason.

**The table was transcribed independently, and it agreed.** QA wrote
`tests/fixtures/access-matrix.ts` from ADR-021 §6 and ADR-022 D3 without seeing
`src/domain/access/resolve-access.ts`; the back-end wrote `resolveAccessFrom()`
from the same two documents without seeing the fixture. Every cell agrees,
including the two ADR-022 implies rather than states:

| Value | ADR-022 says | Both transcriptions read it as | Why |
|---|---|---|---|
| What `owner`/`admin` derive | "access to every project" — not *as what* | `lead` | `resolveAccess()` returns one of three project roles, and it is the only one that serves the case the ADR was decided for: "the founder of a six-person studio expecting to see their own company's work". An owner resolving to `contributor` could not do the lead-only things on their own org's project. |
| `via` when both paths tie | silent | `project` | The direct grant is the more specific authority and the one that survives the org switch being turned off. Attributing a tie to the org would make an audit row read as though revoking the project membership changed nothing. |

Agreement is worth stating because disagreement was the outcome worth paying
for, and it was looked for. **The cross-check did find one thing:**
`organizations.org_roles_derive_project_access`. ADR-022 names per-org
configuration as the escape hatch and the column ships `NOT NULL DEFAULT true`,
but a matrix over roles alone would have asserted only the half of the product
where derivation is on. It is now a real axis, and the cube is 4 org roles × 4
project roles × 2 org scopings × 2 switch states = **64 cells**.

**The cell most worth arguing about**, recorded so nobody has to rediscover it:
an org `admin` explicitly added to a project as a `reviewer` still resolves to
`lead via org`. `strongest()` means the org grant wins, so an explicit narrow
grant does not narrow. Someone will eventually try exactly that to wall off one
project and it will not work — ADR-022 puts the escape hatch in the per-org
switch, not in a downgrade-by-explicit-grant. Both transcriptions mirror the
decision rather than quietly improving on it. If the product wants the other
behaviour that is an ADR, not a test edit.

Three properties fall out and are asserted rather than described:

- **Deny is confined.** Both-null resolves to `{ role: null, via: null }` in all
  four scopings, and a denial never carries provenance.
- **D3's blast radius is six cells of sixty-four.** Derivation *happens* in
  eight — owner and admin across all four project roles, own org, switch on —
  but in the two where the account is already a project `lead` the direct grant
  ties and takes the `via` label. A seventh cell deciding by org means a role
  started deriving that should not.
- **Teams are not an authority.** `src/db/schema/access.ts` expands a team grant
  into individual `project_memberships` rows, so `resolveAccess()` never reads
  `team_members`. The structural half enforces that inside the access domain;
  the matrix has the behavioural row.

**Why the behavioural half stays skipped through Phase 9.** For the length of
the phase every permission check calls both the old inline logic and
`resolveAccess()` and **returns the old result**. A matrix asserted against that
would go green while measuring the system being replaced — and a green invariant
is read as evidence. PHASE-9 EXIT puts the unskip after the old path is deleted,
which happens after seven consecutive days at zero shadow-harness
disagreements. `check-invariant-skips.mjs` now encodes that as `liveFrom: 10`,
so the deferral is mechanical rather than remembered.

**What the structural half buys in the meantime.** It is live today and vacuous
today — `resolveAccess()` has just landed and nothing outside it names a
membership table — which is the most dangerous state a guard can occupy, because
a scan that finds nothing and a scan that cannot find anything are
indistinguishable. So the twenty planted violations in
`invariant-scans-are-not-escapable.spec.ts` are not optional decoration; they
are what makes the green meaningful. **They earned their place immediately:**
they caught three defects in the scans on first run —

- `statements()` joined a line that *starts* like a continuation but not one
  that *ends* dangling, so prettier's `const x =` / newline / value shape split
  one statement into three and any bounded pattern spanning the break saw
  neither half. That is DEFECT-3's hole approached from the other side, in
  shared infrastructure every structural invariant uses. Now closed, with the
  JSX false-positive case pinned alongside it.
- The account-id pattern's null-exclusion lookahead sat after a `\s*` that could
  match zero width, so it inspected the space rather than the word.
- And with that fixed, the engine settled for `==` as a prefix of `===`,
  sidestepping the exclusion anyway. Either mistake turns every presence check
  in the codebase into a permission violation.

None of the three would have been visible by reading the regexes.

### New recommendation

**C. `.railway/**` needs to be inside the toolchain.** It is the only
TypeScript in the repository that nothing typechecks, and it is the file a new
production environment is built from. See open defect 3.

---

## 7. Test inventory

```
tests/
├── fixtures/          deterministic; every suite shares them
│   ├── clock.ts       frozen T0, no Date.now() anywhere in the directory
│   ├── ids.ts         stable uuid-v7-shaped ids, fake sha256s
│   ├── orgs.ts        one org per plan + PLAN_LIMITS from PRD §5.8
│   ├── engagements.ts one engagement per lifecycle stage; retention arithmetic
│   ├── board.ts       private lane, private-override card, 3 versions / 2 published, approvals
│   ├── possession.json 6 transition sequences with hand-computed totals
│   ├── possession.ts  typed loader, validates the file at import
│   ├── seed.ts        insertion graph + transition scripts (seeds never write cards.state)
│   └── index.ts
├── fixtures/
│   └── access-matrix.ts   INV-11's 64-cell resolution cube + 9 edge cases, every
│                          expectation a hand-written literal from ADR-021/022
├── invariants/        145 live, 84 skipped, across 11 specs + 3 helpers
│   ├── _source.ts         source scanning; client-route import-graph reachability;
│   │                      `statements()`, which now joins a dangling line as well
│   │                      as a leading one
│   ├── _query-capture.ts  runs a query or a write against a fake driver; compiled
│   │                      SQL, bound insert parameters, and empty-result 404 paths
│   └── _sql.ts
├── unit/              447 live, 20 skipped, across 14 specs
│   ├── a11y-contract.spec.ts     78 — the contrast floor, and globals.css against it
│   ├── a11y-source.spec.ts       12 — focus ring, motion budget, app shell, and
│   │                                  the stale-allowlist case
│   ├── railway-topology.spec.ts  14 — the deploy topology nothing else checks
│   ├── round-counter.spec.ts     12 — ADR-014 as behaviour, never as a location
│   ├── chunk-purity-detector.spec.ts
│   │                             12 — the bundle audit's matcher, where it costs
│   │                                  two seconds instead of a six-minute build
│   ├── invariant-scans-are-not-escapable.spec.ts
│   │                             72 — planted violations for every structural
│   │                                  scan, incl. INV-11's twenty
│   └── comment-writer.spec.ts    24 — the agency writer, driven end to end
│                                   with no database: order of operations, the
│                                   423 gate, and the events an internal
│                                   comment must not publish
└── e2e/               83 tests, 6 specs, 2 projects + routes.ts + _a11y.ts
                    61 accessibility (all pass, executed); 22 data-driven (never run, §4)
```

Live totals: **592 passing, 104 skipped**. `npm run verify` is green;
`npm run test:db` is **red on DEFECT-12**, which is INV-7 correctly reporting
that the Phase 9 schema outgrew the purge worker.

The skipped count jumped by 68 in one round and that is the intended shape, not
drift: 74 of the 104 are INV-11's behavioural matrix, deliberately deferred to
Phase 9's EXIT and mechanically gated there. Every skipped block names the phase
that unskips it, and the `invariant contract` job fails if one does not — and
now also fails if an invariant is still skipped past its own `liveFrom`, which
is per-invariant rather than a single Phase 8 rule. At the end of round 1 the
live line read 255.
