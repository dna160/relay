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
npm run verify        # typecheck + lint + unit + invariants. The handover gate.
npm run test:e2e      # Playwright, both projects. Needs a running app and a database.
node .github/scripts/check-invariant-skips.mjs     # the ten specs exist; skips name their phase
node .github/scripts/check-env-registry.mjs        # env drift: src -> .env.example -> runbook -> .railway/railway.ts
```

---

## 1. The ten invariants

| | Invariant | Status | Proven by |
|---|---|---|---|
| **INV-1** | No client response contains a private lane, private card, or internal field | 🟢 live | `tests/invariants/visibility.spec.ts` — **40 live cases**, up from 12. Incl. `INV-1 against the shared fixture board > leaks none of the strings the fixture marks as agency-only`. Extended by `tests/unit/client-projection.spec.ts` (25 cases: ordering, nullability, purity, version attribution). |
| | ↳ at the exported card serialiser | 🟢 live | `visibility.spec.ts > INV-1 at the exported card serialiser` — 5 cases incl. a negative control. The round-1 defect (`toClientCard` exported with no visibility check of its own) was fixed by the Architect; this suite asserts the fix. |
| | ↳ every client-reachable query has a case | 🟢 **live, and mechanical** | `visibility.spec.ts > INV-1 the query layer is enumerated, not remembered` — 6 cases. The layer is enumerated from source two ways and diffed against a registry that must name a real `it()`. See §5A. |
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
| A client session for engagement A returns 404 `NOT_VISIBLE` for B | ⚠️ **UNPROVEN.** `tests/e2e/client/invite-verify-approve.spec.ts > a client session for one engagement cannot reach another (INV-6)` is written and **red** — no client routes. The fixture holds one email on two engagements ready for it. **Phase 4.** |

### PHASE 2 — Board core

| EXIT condition | Proven by |
|---|---|
| INV-1, INV-2, INV-5 (transition-row half), INV-9 unskipped and passing | `npm run test:invariants` — all four live. INV-5's transition-row half: `inv-05 > every persisted transition appends exactly one state_transitions row`. |
| A PATCH carrying `state` returns 400 and does not write | Structural: `inv-02 > the API rejects state on the card patch route`. E2E: `tests/e2e/agency/engagement-flow.spec.ts > PATCH /api/cards/:id rejects a state field (INV-2)` — **red**, no route. |
| An illegal edge returns 409 `INVALID_TRANSITION` | Unit: `tests/unit/state-machine.spec.ts > error shape > carries the INVALID_TRANSITION code`. E2E: `engagement-flow.spec.ts > an illegal transition returns 409` — **red**, no route. |
| Every new query in `src/db/queries/` has a case in `visibility.spec.ts` | 🟢 **PROVEN, mechanically.** `visibility.spec.ts > the query layer is enumerated, not remembered`. Two enumerations, deliberately overlapping: every exported function taking a `ClientScope`, **and** every query symbol the client route handlers import. The second exists because the first has a hole — `loadClientVisibleNotes` takes a plain `engagementId` and was invisible to it. Both diff against a registry whose every entry must name an `it()` that exists. Verified to fail in all four directions by mutation. |

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
| A Playwright run completes invite → verify → approve without touching an agency route | `tests/e2e/client/invite-verify-approve.spec.ts > invite -> verify -> approve, touching no agency route` — **red**, pending the seed endpoints in §4. The route claim is asserted at the request level by `RouteRecorder`, not inferred from the flow completing. The classifier it depends on is itself tested: `tests/unit/routes.spec.ts` (49 live cases), which runs in `npm run verify`. |
| INV-1 extended with a case for every new client query | 🟢 **PROVEN.** Same guard as Phase 2's row above; eight client-reachable queries are enumerated and each has a compiled-SQL case. A ninth appearing fails the build until someone writes its case. |
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
| Deploy and rollback both executed once against staging | ⚠️ **UNPROVEN, and not provable by a test.** Procedure written: `docs/RUNBOOK.md` §3 and §4. It has never been run. **This is the largest open risk in the build** — see §4. |
| All ten invariant suites unskipped and green in CI | **CI job `invariant contract`** → `node .github/scripts/check-invariant-skips.mjs`, which fails at Phase ≥ 8 if any `.skip` remains. Verified to fail correctly: `node .github/scripts/check-invariant-skips.mjs --phase 8` exits 1 today and names all five. |
| Every destructive job is dry-runnable and logs its manifest before acting | CI job `purge --plan smoke test` (see Phase 6). Currently self-skipping. |
| Full e2e matrix, agency desktop and client mobile | `playwright.config.ts` — two projects, split by directory so a test cannot be written for the wrong audience. 22 tests across 4 files, all **red** pending routes. |
| Accessibility sweep against the DESIGN-SYSTEM floor | 🟡 **mostly proven.** `tests/unit/a11y-contract.spec.ts` (78 cases) and `tests/unit/a11y-source.spec.ts` (11 cases) run inside `npm run verify` with no browser: all 44 contrast pairs on both grounds in both modes, `globals.css` diffed against the contract module so neither can drift, the global `:focus-visible` rule and its 2px/2px geometry, the reduced-motion token collapse, `<html lang>`, the `data-relay-root` anchor, and the absence of `outline:none`. The browser half — that the *rendered* page resolves to those tokens, that the white-label OKLCH clamp holds against seven hostile brand values, and that focus is never obscured — is `tests/e2e/{agency,client}/a11y-shell.spec.ts`, 37 tests, written against a shell route that needs no seed. **Not yet executed against a running app.** |

---

## 3. CI gate map

| Job | Enforces | Blocking now? |
|---|---|---|
| `verify (node 22)` / `verify (node 24)` | `npm run verify` — typecheck, lint, unit, invariants | Yes — **green**. 398 live assertions (309 unit, 89 invariant), up from 321 at the end of round 1. |
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

## 4. Open defects

Full detail and ownership in the QA report to the Architect. Summarised here
because this is the document that gets audited.

### Closed since round 1

| # | Was | Closed by |
|---|---|---|
| 1 | `toClientCard()` exported with no visibility check of its own | Architect. `visibility.spec.ts > INV-1 at the exported card serialiser`, 5 cases. |
| 2 | The `no-non-null-assertion` override was a no-op that read as a safeguard | Architect. Rule now enforced, scoped to `src/`. |
| 3 | `eslint .` fails whenever `next-env.d.ts` is present | Architect. Added to `ignores`. |
| 4 | `/api/health` does not exist while `railway.json` health-checks it | B4. Checks database connectivity, not just liveness. |
| 5 | The e2e suite needs three test-only endpoints that do not exist | B7. Gated on `E2E_SEED_TOKEN` **and** refusing to mount in production. |
| 6 | `PGPOOL_MAX` read by `src/` and absent from `.env.example` | B8. |
| 7 | `computePossession`'s optional third argument softened ADR-010 | B5. Two parameters now. |
| 8 | Docs diverge from the code (routes, contract) | Architect. Amendments A1–A7. |
| 9 | `.railway/railway.ts` does not exist and is unowned | QA (Q1). `.railway/**` is now QA-owned; the file is written and gated by 14 assertions. |

### Open

1. **`NEXT_PUBLIC_APP_URL` is read by `src/lib/api-client.core.ts` and is not in
   `.env.example`.** One line. Fails the `env registry` job. **Owner: front-end
   (F7).** This is the only thing standing between that gate and green.
2. **`railway/iac` is not a dependency**, so `.railway/railway.ts` describes the
   topology correctly and cannot be executed by anything. Adding the `railway`
   package needs an ADR. **Owner: Architect.** The Config-as-Code cutoff is
   2026-12-01.
3. **`.railway/**` is outside the toolchain.** `tsc` and `eslint` both skip
   dot-directories, so nothing in `npm run verify` would catch a syntax error in
   the deploy topology. `tests/unit/railway-topology.spec.ts` reads it as text
   and asserts the properties whose violation is an incident, which is a floor
   rather than a substitute. Fixing it properly means adding `.railway` to
   `tsconfig.json`'s `include`, which is blocked on defect 2. **Owner:
   Architect.**
4. **`src/components/agency/card-tile.tsx` animates outside the motion budget.**
   `transition-opacity` on hover, silenced with `motion-reduce:transition-none`
   at the call site. ACCESSIBILITY.md §7 says reduction happens at the token
   precisely so that no component has to remember the variant — and the next one
   will not. Not an accessibility failure (reduced motion is honoured, and
   `focus-within:` keeps the controls keyboard-reachable), so it is recorded
   rather than suppressed: `a11y-source.spec.ts` allows this one file by name
   and fails on any second. **Owner: front-end.**
5. **Deploy and rollback have never been executed.** Phase 8's only EXIT
   condition a test cannot cover, and the largest open risk in the build.
   Now also gated on defect 2 — the topology file cannot run without the
   dependency. **Owner: Architect.**
6. **Backups are Railway's defaults and no restore has ever been tested.**
   RUNBOOK §4c depends on one. **Owner: Architect.**

---

## 5. Recommendations from round 1 — both now built

**A. "Every client-reachable query has a visibility case" is mechanical.**
Built. `visibility.spec.ts` enumerates the query layer from source in two
independent ways and diffs both against a registry:

- *by signature* — every exported function in `src/db/queries/` taking a
  `ClientScope`, since a scope can only be built from a session (INV-6) and
  therefore accepting one is what "client-reachable" means at that layer;
- *by import graph* — every query symbol the handlers under
  `src/app/api/client/**` and `src/app/api/auth/client/**` actually import.

The second was added after the first reported full coverage while
`loadClientVisibleNotes` — client-reachable, but taking a plain `engagementId`
because its caller resolves visibility first — had no case at all. A guard that
only reads signatures can be stepped around by choosing a parameter type, which
is not a hypothetical: it had already happened.

Each registry entry must name an `it()` that exists in the file, so the map
cannot be satisfied by editing the map. Each covered query then gets a case that
runs it against a fake driver and asserts the **compiled SQL** — the predicate,
the bound parameters, the tables joined, and the columns selected. Verified by
mutation: removing an entry, adding a stale one, renaming a case title, and
dropping a runner each fail, and each names the cause.

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

## 6. Test inventory

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
├── invariants/        89 live, 16 skipped, across 10 specs + 3 helpers
│   ├── _source.ts         source-tree scanning; query-layer enumeration
│   ├── _query-capture.ts  runs a query against a fake driver, returns the compiled SQL
│   └── _sql.ts
├── unit/              309 live, 20 skipped, across 11 specs
│   ├── a11y-contract.spec.ts     78 — the contrast floor, and globals.css against it
│   ├── a11y-source.spec.ts       11 — focus ring, motion budget, app shell
│   ├── railway-topology.spec.ts  14 — the deploy topology nothing else checks
│   └── round-counter.spec.ts     12 — ADR-014 as behaviour, never as a location
└── e2e/               59 tests, 6 specs, 2 projects + routes.ts + _a11y.ts
```

Live totals: **398 passing, 36 skipped**. `npm run verify` is green.
Every skipped block names the phase that unskips it; the `invariant contract`
job fails if one does not. At the end of round 1 the same line read 255.
