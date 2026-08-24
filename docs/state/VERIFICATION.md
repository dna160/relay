# VERIFICATION

> The audit surface. Every one of the ten invariants and every phase EXIT
> condition, mapped to the exact command or test that proves it — or marked
> **UNPROVEN** with the phase that will prove it.
>
> `docs/BUILD-PHASES.md` says every EXIT condition has a command or a test
> behind it. This document is where that claim is either true or visibly not.
> Read the **UNPROVEN** rows first; they are the whole point.

**Generated at:** Phase 1–3 landed, Phases 4–8 outstanding.
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
node .github/scripts/check-env-registry.mjs        # env drift between src, .env.example, runbook
```

---

## 1. The ten invariants

| | Invariant | Status | Proven by |
|---|---|---|---|
| **INV-1** | No client response contains a private lane, private card, or internal field | 🟢 live | `tests/invariants/visibility.spec.ts` — 12 live cases, incl. `INV-1 against the shared fixture board > leaks none of the strings the fixture marks as agency-only`. Extended by `tests/unit/client-projection.spec.ts` (25 cases: ordering, nullability, purity, version attribution). |
| | ↳ at the exported card serialiser | ⬜ skipped | `visibility.spec.ts > INV-1 at the exported card serialiser` — **open defect**, see §4. Phase 2. |
| | ↳ every client-reachable query has a case | ⚠️ **UNPROVEN** | No `src/app/api/client/**` routes exist yet. The projection is covered; the query layer is not. **Phase 4.** |
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
| Every new query in `src/db/queries/` has a case in `visibility.spec.ts` | ⚠️ **UNPROVEN.** Nothing enumerates the query layer and cross-checks it against the spec. `src/db/queries/client-scope.ts` exists and is uncovered. **Recommendation in §5.** |

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
| INV-1 extended with a case for every new client query | ⚠️ **UNPROVEN** until the queries exist. See §5 for the mechanical check that would make this self-enforcing. |
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
| Accessibility sweep against the DESIGN-SYSTEM floor | ⚠️ **UNPROVEN.** Only the 360px no-horizontal-scroll case exists (`board-performance.spec.ts`). Visible focus, `prefers-reduced-motion`, and 4.5:1 on possession hues have nothing behind them. **Phase 8.** |

---

## 3. CI gate map

| Job | Enforces | Blocking now? |
|---|---|---|
| `verify (node 22)` / `verify (node 24)` | `npm run verify` — typecheck, lint, unit, invariants | Yes — green; see §4.6 for a latent lint failure |
| `invariant contract` | All ten specs exist; every skipped suite names its phase; at Phase 8 none are skipped; nothing removed from `tests/invariants` without the `invariant-change` label | Yes |
| `build` | `next build` succeeds | Yes |
| `env registry` | Every `process.env` read in `src/` is in `.env.example`; every `.env.example` variable is in the runbook; no real secret is committed | Yes — **currently red**, see §4 |
| `e2e` | Playwright both projects; migrations idempotent; traces uploaded on failure | Yes — red pending routes |
| `purge --plan smoke test` | A dry run prints a manifest and changes no row counts | Self-skips until Phase 6 |

---

## 4. Open defects blocking a green board

Full detail in the QA report to the Architect. Summarised here because this is
the document that gets audited.

1. **`.env.example` is missing `PGPOOL_MAX` and `NEXT_PUBLIC_APP_URL`**, both
   read by `src/`. Fails the `env registry` job. Two lines, and the file is not
   QA-owned.
2. **`/api/health` does not exist** and `railway.json` health-checks it. The
   first deploy fails its health check.
3. **`toClientCard()` is exported and applies no visibility check of its own.**
   Nothing leaks today because only `toClientBoard` calls it and the filter runs
   first. The moment a second caller appears, a draft card ships with a `state`
   its own return type forbids. `src/domain/projection/client-view.ts`.
4. **The `no-non-null-assertion` ESLint override is a no-op that reads as a
   safeguard.** `eslint.config.mjs` turns the rule *off* for `client-view.ts`
   under a comment explaining why a non-null assertion there is dangerous — and
   the rule is not in `typescript-eslint`'s `recommended` set anyway, so
   CLAUDE.md's "no non-null assertions on database reads" is unenforced
   everywhere in the tree.
5. **Config as Code is deprecated at Railway** and new services cannot use
   `railway.json`. `.railway/railway.ts` is needed and unowned. `docs/RUNBOOK.md`
   §1 carries the file, ready to lift.
6. **`eslint .` fails whenever Next's generated `next-env.d.ts` is present.**
   Observed once during this session and then self-resolved when the file was
   regenerated. It is in `.gitignore`, but ESLint flat config does not read
   `.gitignore`, so `next-env.d.ts` needs adding to the `ignores` list in
   `eslint.config.mjs`. Latent: it will take `npm run verify` — and therefore
   the handover gate and CI — down on whichever machine happens to have run
   `next dev` or `next build` first. One line.
7. **Route paths diverge from `docs/ARCHITECTURE.md`.** The file tree documents
   the agency workspace at `(agency)/e/[id]/`; the implementation ships
   `(agency)/w/[id]/`. The implementation is arguably better — it keeps the
   agency prefix off `/e/`, which is the client's — but the doc and the code
   disagree, and the audience classifier the Phase 4 exit test depends on has to
   be right about which is which. Guarded now by `tests/unit/routes.spec.ts`;
   still needs one of the two to be corrected.
8. **Routes named in `docs/API-CONTRACT.md` that do not exist yet:**
   `GET/POST /api/templates` (Phase 7), `POST /api/engagements/:id/export` and
   `GET /api/client/export` (Phase 6), `GET /api/events` (SSE). Routes that
   exist and are *not* in the contract: `/api/cards/reorder`,
   `/api/onboarding/org`, `/api/reference-files`,
   `/api/engagements/:id/shelf`. The contract says it wins where an
   implementation diverges; someone has to reconcile the four extras into it.
9. **The e2e suite needs three test-only endpoints that do not exist**, and is
   red at the first `beforeEach` until they do. All three are gated on
   `E2E_SEED_TOKEN` and must be absent when it is unset — that gate is what
   makes them safe to ship. Shapes are typed in `tests/e2e/_helpers.ts`:
   - `POST /api/test/seed` — resets to `tests/fixtures` and returns the eight
     ids and tokens in `SeedResult`. Cards seed in `draft` and reach their
     fixture state by replaying `transitionScripts` through the state machine;
     a seed that writes `cards.state` directly breaks INV-2.
   - `GET /api/test/last-code` — the most recent magic-link code for an email on
     an engagement. CI cannot read a real inbox.
   - `POST /api/test/session` — an agency sign-in shortcut.
10. **Deploy and rollback have never been executed.** Phase 8's only EXIT
    condition that a test cannot cover.

---

## 5. Recommendations

Two mechanical checks that would close **UNPROVEN** rows permanently rather than
one phase at a time.

**A. Make "every client-reachable query has a visibility case" self-enforcing.**
Phase 2 and Phase 4 both carry that EXIT condition and neither has a check.
Add to `visibility.spec.ts`: enumerate the exported functions in
`src/db/queries/` that take a client session, and assert each name appears in
this spec file. A new client query then fails the build until someone writes its
case — which is what ADR-006 says the guard is, described as mechanical rather
than procedural. Today it is procedural.

**B. Give the accessibility floor one test each.** Visible focus,
`prefers-reduced-motion`, and 4.5:1 contrast on the possession hues are three
Playwright assertions, not a sweep. The contrast one can be a unit test over the
token file and needs no browser at all.

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
├── invariants/        61 live, 17 skipped, across 10 specs + 2 helpers
├── unit/              194 live, 20 skipped, across 7 specs
└── e2e/               22 tests, 4 specs, 2 projects + routes.ts — red pending seed endpoints
```

Live totals: **255 passing, 37 skipped**. `npm run verify` is green.
Every skipped block names the phase that unskips it; the `invariant contract`
job fails if one does not.
