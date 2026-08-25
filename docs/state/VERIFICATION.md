# VERIFICATION

> The audit surface. Every one of the ten invariants and every phase EXIT
> condition, mapped to the exact command or test that proves it — or marked
> **UNPROVEN** with the phase that will prove it.
>
> `docs/BUILD-PHASES.md` says every EXIT condition has a command or a test
> behind it. This document is where that claim is either true or visibly not.
> Read the **UNPROVEN** rows first; they are the whole point.

**Generated at:** end of round 2. Phases 1–4 landed and parts of 5 pulled forward; Phases 6–8 outstanding.
**Owner:** QA. Update it in the same commit that changes what is provable.

## How to read a row

- **Command** — paste it and it runs.
- **Test id** — the file, then `describe > it`. Run one with
  `npx vitest run <file> -t "<partial name>"` or
  `npx playwright test <file> -g "<partial name>"`.
- **UNPROVEN** — nothing currently proves it. The phase named is the one that
  must. A row that has been UNPROVEN across two phases is a row to argue about.

## The four commands

```bash
npm run verify:all    # verify + next build. THE HANDOVER GATE.
npm run verify        # typecheck + lint + unit + invariants
npm run test:e2e      # Playwright, both projects. Needs a running app and a database.
node .github/scripts/check-invariant-skips.mjs     # the ten specs exist; skips name their phase
node .github/scripts/check-env-registry.mjs        # env drift: src -> .env.example -> runbook -> .railway/railway.ts
```

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
| **INV-2** | `cards.state` changes only via the state machine | 🟢 live | `tests/invariants/inv-02-state-machine-sole-writer.spec.ts` — 3 structural scans over the whole tree. Behaviour: `tests/unit/state-machine.spec.ts` (15 cases). |
| **INV-3** | An approval binds one immutable version and stores its sha256 | 🟢 live (structural + schema) | `tests/invariants/inv-03-approval-binds-version.spec.ts` — 9 live cases: the copy, the sole writer, no re-derivation at read time, no `card_id` column, both CHECK constraints in the migration. |
| | ↳ under a live database | ⬜ skipped | Same file, `INV-3 under a live database` — 4 cases. **Phase 3** (needs Postgres). |
| **INV-4** | `asset_versions` is append-only | 🟢 live (structural + schema) | `tests/invariants/inv-04-versions-append-only.spec.ts` — 7 live cases: no delete outside the purge worker, only the two set-once columns updatable, hash/size/key never rewritten, `UNIQUE (card_id, version_no)`. |
| | ↳ under a live database | ⬜ skipped | Same file, `INV-4 under a live database` — 3 cases. **Phase 3 / Phase 6.** |
| **INV-5** | Every transition writes a possession row; the clock derives from it alone | 🟢 live | `tests/invariants/inv-05-possession-from-transitions.spec.ts` — 7 live cases: one insert in the sole persister, nothing else writes the table, no denormalised column in schema *or* migrations, totals recompute within 1s, sign-off stops the clock, the clock never reads `Date.now()`. |
| **INV-6** | A client session is scoped to exactly one engagement | 🟢 live (type + structural + schema) | `tests/invariants/inv-06-client-session-single-engagement.spec.ts` — 8 live cases: the `Session` union shape, no engagement list anywhere, no client route reading an engagement id, `UNIQUE (engagement_id, email)` present and no global unique on email. |
| | ↳ at the session boundary | ⬜ skipped | Same file, `INV-6 at the session boundary` — 3 cases. **Phase 4.** |
| **INV-7** | Purge is total and leaves exactly one certificate | ⬜ skipped | `tests/invariants/inv-07-purge-leaves-certificate.spec.ts` — all 6 cases. **Phase 6.** The only invariant with nothing live. |
| **INV-8** | Active count is one function; billing and expiry never diverge | 🟢 live | `tests/invariants/inv-08-single-active-count.spec.ts` — 9 live cases, incl. `the two callers move together when the clock does` (counted + swept always equals running, at five clock offsets). |
| **INV-9** | Business logic lives in `src/domain/` | 🟢 live | `tests/invariants/inv-09-domain-purity.spec.ts` — 3 structural scans. Also an ESLint rule; the test is what catches someone disabling the rule inline. |
| **INV-10** | File bytes never traverse the app server | 🟢 live | `tests/invariants/inv-10-no-bytes-through-app.spec.ts` — 3 structural scans. End to end: `tests/e2e/agency/engagement-flow.spec.ts > a download redirects rather than streaming bytes` and the PUT-origin assertion in `create -> stamp -> upload -> publish`. Both **red** until routes exist. |

**Command for the whole column:** `npm run test:invariants`
**Skip audit:** `node .github/scripts/check-invariant-skips.mjs`

Nine of ten suites now execute. At Phase 0 handover it was four.

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
| A client session for engagement A returns 404 `NOT_VISIBLE` for B | ⚠️ **UNPROVEN.** `tests/e2e/client/invite-verify-approve.spec.ts > a client session for one engagement cannot reach another (INV-6)` is written, and the routes and seed endpoints it needs now both exist. It has **never been run** — no Postgres in this environment (§4). The fixture holds one email on two engagements ready for it. First execution is CI's `e2e` job. |

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
| A 200 MB upload completes without the app process RSS moving | ⚠️ **UNPROVEN.** INV-10's structural scans prove no route *reads* bytes, which is the mechanism; nothing measures RSS. **Phase 3 owner** — the honest cheap version is asserting the PUT went to the R2 origin, which `engagement-flow.spec.ts` already does. |
| A decision recorded, then the version re-read: stored hash still matches | Structural: `inv-03 > a recorded decision copies the version sha256 rather than referencing it` and `> never recomputes the stored hash from the version at read time`. Behavioural: `inv-03 > INV-3 under a live database` — **skipped, Phase 3**. |
| `changes_requested` with no note returns 400 and writes nothing | Domain-first check: `inv-03 > the domain rejects a note-less changes_requested before the constraint does`. Constraint: `inv-03 > the database refuses changes_requested without a note`. End to end: **skipped, Phase 3**. |

### PHASE 4 — Client surface

| EXIT condition | Proven by |
|---|---|
| A Playwright run completes invite → verify → approve without touching an agency route | `tests/e2e/client/invite-verify-approve.spec.ts > invite -> verify -> approve, touching no agency route`. The seed endpoints now exist (B7); **not executed — see §4**. The route claim is asserted at the request level by `RouteRecorder`, not inferred from the flow completing. The classifier it depends on is itself tested: `tests/unit/routes.spec.ts` (57 live cases) in `npm run verify` — and it was **wrong** until round 2: `/api/events` sat in `CLIENT_ROUTE_PATTERNS`, so a client page fetching the agency stream would have been classified as staying on its own side. Amendment A1 makes that the agency stream. Fixed, with five cases pinning the split. |
| INV-1 extended with a case for every new client query | 🟢 **PROVEN.** Same guard as Phase 2's row above. Eight client-reachable queries are enumerated and each has a compiled-SQL case; two more are excused in writing with a reason (the pre-session reads). A ninth appearing fails the build until someone writes its case — which it has done twice this round, catching `loadClientEngagementStatus` and `loadClientRevisionNotes` within minutes of them landing. |
| Client board FCP under 1.5s on a throttled 4G profile | `tests/e2e/client/board-performance.spec.ts > first contentful paint stays under 1.5s on a throttled 4G profile` — CDP `Network.emulateNetworkConditions`, cache disabled, reads the `first-contentful-paint` entry. **Red**, no board. |
| The client bundle contains no agency route code | `board-performance.spec.ts > the client bundle carries no agency route code` — inspects downloaded JS, not the import graph. **Red.** |

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
| INV-7 unskipped and passing, including idempotency | ⬜ **skipped.** `tests/invariants/inv-07-purge-leaves-certificate.spec.ts`, 6 cases. **Phase 6.** |
| A purge killed at each step and rerun yields exactly one certificate | ⬜ skipped — `tests/unit/retention-dates.spec.ts > purge idempotency and resumability`, 5 cases naming each checkpoint. Operational procedure: `docs/RUNBOOK.md` §6. |
| No purge path runs without four warning rows already recorded | ⬜ skipped — `retention-dates.spec.ts > the retention worker > refuses to purge an engagement that has not been warned four times`. |
| `purge:plan` leaves every row count and object count unchanged | **CI job `purge --plan smoke test`** — snapshots `pg_stat_user_tables` before and after, requires the manifest to be non-empty, and diffs the counts. Self-skips with a note until `src/workers/purge-cli.ts` exists, then becomes a real gate with no further edit. |
| The 30/60 timeline and the four warning offsets | 🟢 live now — `tests/unit/retention-dates.spec.ts`, 19 live cases: 30/60 arithmetic, offsets `[0,14,23,29]`, gaps `[14,9,6]` closing as the deadline approaches, a full day before the purge, retaining plans null rather than distant, days-to-purge rounding and clamping. |

### PHASE 7 — Templates, white-label, plan gates

| EXIT condition | Proven by |
|---|---|
| Stamping a template twice produces structurally identical graphs | ⚠️ **UNPROVEN.** No suite exists; `applyTemplate()` does not exist. **Phase 7.** Recommended: a unit spec asserting deep equality of two stamps modulo ids, against a fixture template. |
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
| `verify (node 22)` / `verify (node 24)` | `npm run verify:all` — typecheck, lint, unit, invariants, **and `next build`**. The build is in the gate because a `'use server'` file exporting a non-async const passes typecheck and lint and fails page-data collection; only the build caught it. | Yes — **green**. 463 live assertions (350 unit, 113 invariant), up from 321 at the end of round 1. |
| `invariant contract` | All ten specs exist; every skipped suite names its phase; at Phase 8 none are skipped; nothing removed from `tests/invariants` without the `invariant-change` label | Yes — green |
| `build` | `next build` succeeds | Yes |
| `env registry` | Every `process.env` read in `src/` is in `.env.example`; every `.env.example` variable is in the runbook **and is set by `.railway/railway.ts`**; no `E2E_` variable reaches a deployed environment; no real secret is committed | Yes — **red on one line**: `NEXT_PUBLIC_APP_URL` (F7). `PGPOOL_MAX` was fixed by B8. |
| `e2e` | Playwright both projects; migrations idempotent; traces uploaded on failure | Yes — see §4 for the run status |
| `purge --plan smoke test` | A dry run prints a manifest and changes no row counts | Self-skips until Phase 6 |

The env-registry gate gained a fourth link this round: `.env.example` →
`.railway/railway.ts`. The failure it now catches is a variable that is read by
the code, documented in `.env.example`, described in the runbook, and *still*
never reaches the running container because nothing in the deploy topology sets
it — a failure that survived all three of the previous checks.

---

## 4. What has never met a live Postgres

The e2e suite is no longer blocked on missing endpoints — B7 shipped
`POST /api/test/seed`, `GET /api/test/last-code` and `POST /api/test/session`,
gated on `E2E_SEED_TOKEN` **and** refusing to mount when
`NODE_ENV === 'production'`. It is blocked on a database: **Docker Hub is
unreachable from this environment**, so no Postgres exists here and the 22
data-driven e2e tests could not be run. CI's `e2e` job will be their first real
execution. Stated plainly, because "the endpoints exist" reads like "the tests
pass" and it is not the same claim.

The accessibility suite was deliberately written against a route that needs no
database, which is why 33 of its 37 tests **did** execute. Everything below did
not, and none of it is provable without a running Postgres:

| Unverified | Why it can only fail against a real database |
|---|---|
| The three migrations, applied to an empty database | Nothing has ever run `db:migrate` here. CI runs it twice (the second run asserts idempotency, PHASE-1 EXIT). A migration that is not idempotent passes every test in `npm run verify`. |
| Seed ordering | `tests/fixtures/seed.ts` drives cards to their fixture state by replaying `transitionScripts` through the state machine, because a seed that writes `cards.state` breaks INV-2. Whether the insertion graph satisfies every foreign key in order is a claim only Postgres can settle. |
| The `LISTEN`/`NOTIFY` reconnect path | B2's SSE streams. A dropped connection that never re-subscribes looks identical to a quiet engagement, and the client surface would show a stale board indefinitely. |
| The Auth.js session cookie name | The client flow depends on it, and it changes with `AUTH_URL`'s scheme (`__Secure-` prefix on https). A staging deploy is the first place that difference appears. |
| `FOR UPDATE` row locking | `transitionCard` and `recordDecision` both take it. Two people approving the same card at the same moment must produce one transition and one 409. Unprovable without concurrent transactions. |
| Both CHECK constraints on `approvals` | INV-3's database half — 4 cases, skipped and named. |
| `UNIQUE (card_id, version_no)` and the append-only triggers | INV-4's database half — 3 cases, skipped and named. |
| Every 402/409/410/423 status code end to end | Asserted in unit tests at the domain layer; the route-to-status mapping is not. |

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

### Open

1. **`src/components/agency/card-tile.tsx` animates outside the motion budget.**
   `transition-opacity` on hover, silenced with `motion-reduce:transition-none`
   at the call site. ACCESSIBILITY.md §7 reduces motion at the token precisely
   so no component has to remember the variant — and the next one will not. Not
   an accessibility failure (reduced motion is honoured and `focus-within:`
   keeps the controls keyboard-reachable), so it is recorded rather than
   suppressed: `a11y-source.spec.ts` allows this one file by name and fails on
   any second. **Owner: front-end.**
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

Four rows, down from nine at the end of round 1:

- **PHASE-1** — a client session for engagement A returns 404 for B. Written and
  ready (`invite-verify-approve.spec.ts`); needs a database.
- **PHASE-3** — a 200 MB upload completes without the app process RSS moving.
  INV-10's structural scans prove no route reads bytes, which is the mechanism;
  nothing measures RSS.
- **PHASE-7** — stamping a template twice produces structurally identical
  graphs. `applyTemplate()` does not exist.
- **PHASE-8** — deploy and rollback executed once against staging. Not provable
  by a test. No longer blocked on tooling: `railway@^3.11.0` is a devDependency
  under ADR-019 and `.railway/**` is inside tsc and ESLint.

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
├── invariants/        113 live, 16 skipped, across 10 specs + 3 helpers
│   ├── _source.ts         source scanning; client-route import-graph reachability
│   ├── _query-capture.ts  runs a query or a write against a fake driver; compiled
│   │                      SQL, bound insert parameters, and empty-result 404 paths
│   └── _sql.ts
├── unit/              350 live, 20 skipped, across 12 specs
│   ├── a11y-contract.spec.ts     78 — the contrast floor, and globals.css against it
│   ├── a11y-source.spec.ts       11 — focus ring, motion budget, app shell
│   ├── railway-topology.spec.ts  14 — the deploy topology nothing else checks
│   ├── round-counter.spec.ts     12 — ADR-014 as behaviour, never as a location
│   └── comment-writer.spec.ts    24 — the agency writer, driven end to end
│                                   with no database: order of operations, the
│                                   423 gate, and the events an internal
│                                   comment must not publish
└── e2e/               83 tests, 6 specs, 2 projects + routes.ts + _a11y.ts
                    61 accessibility (all pass, executed); 22 data-driven (never run, §4)
```

Live totals: **463 passing, 36 skipped**. `npm run verify` is green.
Every skipped block names the phase that unskips it; the `invariant contract`
job fails if one does not. At the end of round 1 the same line read 255.
