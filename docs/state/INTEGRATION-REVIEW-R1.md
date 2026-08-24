# Integration Review — after Round 1

Written by the Lead Architect. Every sub-agent reads this file in full at the
start of Round 2, including the sections addressed to the other three — that is
the point of it.

`npm run verify` is **green** at the end of Round 1: typecheck, lint, 255 unit
tests, 66 invariant assertions, 9 of 10 invariant suites live. 170 source files.
Round 1 is committed as `eca7d56`.

---

## What each agent shipped

**Back-end** — Phases 1–3. Drizzle schema for all fourteen tables, three
forward-only migrations, the domain layer, 25 API routes, `clientScope()`, and
ADR-012..015. No dependencies added.

**Front-end** — Phases 2 and 4. Agency portfolio/board/card/shelf/settings and
the client magic-link surface, every named component from the design system,
agency and client component trees kept entirely separate. No dependencies added.

**UI/UX** — tokens with a clamped, three-layer white-label lock, nine primitives,
component specs, flows, and a measured accessibility audit. No dependencies.

**QA** — deterministic fixtures with hand-computed possession totals, 255 live
tests, three new CI gates, Railway topology, a runbook, and `VERIFICATION.md`.
Took the invariant suite from 4 live to 9 of 10. No dependencies.

Four agents, zero dependencies added, zero ownership collisions. The disjoint
file ownership held.

---

## Architect rulings on what you escalated

**Ratified as shipped** — these are now the design, not deviations:

1. **ADR-014, the round counter lives in `transitionCard`,** not in
   `record-decision.ts` where PHASE-3 put it. An agency member can take the same
   `awaiting_client → changes_requested` edge through the transition route; two
   increment sites would disagree, and that number ends up in an invoice
   dispute. The phase file was wrong. **QA: assert the behaviour, never the
   location.**
2. **ADR-013, `users.org_id` is nullable** and the Auth.js tables exist. The
   adapter's `createUser` necessarily precedes org membership. A null org reads
   as "not onboarded" and can only deny access, never widen it.
3. **`state_transitions.possession` is nullable.** `POSSESSION.signed_off` is
   `null` and null is the correct encoding of "accrues to neither party".
   INV-5 is about the row existing and carrying what the state machine decided.
4. **`createEngagement` sets `status = 'active'`.** A draft that does not count
   against the plan is how thirty workspaces appear on a three-workspace plan.
   `'draft'` stays in the enum, unused in v1.
5. **Agency routes at `/w/[id]`** (amendment A4). A genuine Next.js route
   collision, not a preference.
6. **`--breach` removed from validation and server errors.** DESIGN-SYSTEM.md
   says the colour is reserved for a breached commitment and *nothing else*, and
   a reservation is only worth something if it is absolute. Bold `--ink` plus a
   leading rule plus `role="alert"` is also better for colour-blind users.
   Upheld — UI/UX was right to ask rather than assume.
7. **No `@dnd-kit`.** The keyboard path has to exist regardless and is what sets
   the accessibility floor; the library would be additive polish. Revisit as an
   ADR if pointer feel becomes a complaint, not before.

**Overruled / corrected by the Architect, already done:**

8. **Defect 4 — `toClientCard` is fixed.** It was exported, client-reachable,
   applied no visibility check of its own, and cast a draft state into a type
   that excludes draft. The back-end had already tripped it once in
   `loadClientQueue`, which is proof the gun fires. It now takes the lane, checks
   visibility itself, and throws `ClientVisibilityError`. The non-null assertion
   is gone, replaced by an `isPublished` type narrowing. QA's skipped suite has
   been unskipped and now asserts the guard in five cases including a negative
   control. **This was the most serious finding of the round.**
9. **Defect 5 — `no-non-null-assertion` is now enforced, scoped to `src/`.**
   All 53 occurrences were in `tests/`; `src/` was already clean. The hazard the
   rule protects against is a production row that turns out to be null, so
   forcing 53 cosmetic edits on fixtures would have bought nothing.
10. **Defect 6 — `next-env.d.ts` is in eslint's `ignores`.** Flat config does
    not read `.gitignore`. `npm run verify` no longer goes red after a build.
11. **`INTERNAL: 500` added to `ERROR_CODES`** (amendment A2). It carries no
    `details` — an internal failure explaining itself to a client contact is an
    information leak with a stack trace attached.
12. **Defect 8 and 9 — the docs now match the code.** `docs/ARCHITECTURE.md`
    corrected, and `docs/API-CONTRACT.md` has an **Amendments** section (A1–A7)
    recording every divergence with its reason.

**The one contract defect neither side could fix alone:**

13. **Amendment A1 — `GET /api/events?engagementId=` was an INV-6 violation.**
    The frozen contract had one stream taking the engagement from a query
    parameter. For a client session that is precisely what INV-6 forbids. Now
    split: agency keeps `GET /api/events?engagementId=`; client gets
    `GET /api/client/events`, which takes no parameter at all. Excellent catch.

---

## Round 2 directives

### BACK-END
- **B1** `GET /api/attention` — Phase 5's endpoint, pulled forward. The agency
  portfolio is the home screen and its primary content currently renders an
  error panel. Returns `{ items: AttentionItem[] }`; the type is already in
  `src/lib/types.ts`. Rank by actionability, not deadline proximity.
- **B2** SSE per amendment A1: `GET /api/events?engagementId=` (agency, authorise
  the id against the org) and `GET /api/client/events` (no parameter, engagement
  from the session). Filter both through the same projection as REST.
- **B3** Revision notes are half-built — the table exists and `record-decision`
  writes to it, but nothing reads it, so PRD §5.3's "notes thread to the version
  they were written against and never float forward" is unenforceable in the UI.
  Ship the read/write routes. This also resolves the front-end's removed
  "on v4" label.
- **B4** `GET /api/health` — `railway.json` health-checks it and it does not
  exist, so the **first deploy fails its health check**. Check DB connectivity,
  not just process liveness.
- **B5** Remove the optional third argument from
  `computePossession(transitions, now, currentState?)`. It lets a caller derive
  current possession from `cards.state`, which softens "derived from
  `state_transitions` and nowhere else" (ADR-010). QA found it.
- **B6** Add `status` to the client board header so the client card page can
  pre-compute read-only instead of discovering 423 on submit.
- **B7** Test-only endpoints `POST /api/test/seed`, `GET /api/test/last-code`,
  `POST /api/test/session`, shapes already typed in `tests/e2e/_helpers.ts`.
  22 e2e tests are red at their first `beforeEach` without them. **Gate them on
  `E2E_SEED_TOKEN` AND refuse to mount when `NODE_ENV === 'production'` — both,
  not either.** A seed endpoint reachable in production is a total compromise of
  every engagement in the database.
- **B8** `PGPOOL_MAX` is read but absent from `.env.example`. QA's env-registry
  CI gate is red on it.

### FRONT-END
- **F1** `GET /api/engagements/:id/shelf` **does exist** — I verified it at
  `src/app/api/engagements/[id]/shelf/route.ts`. You marked it `NOT BUILT` and
  left the shelf on a stub. Wire it.
- **F2** Split the endpoint maps into `src/lib/api-client.agency.ts` and
  `src/lib/api-client.client.ts`, with `api-client.ts` re-exporting. **You now
  own those filenames.** Phase 4's exit condition is that the client bundle
  contains no agency route code, and `agencyApi`'s strings are currently in a
  shared chunk. Your audit found it; finish it.
- **F3** `src/app/layout.tsx` needs `<body data-relay-root>` — the white-label
  lock's second mechanism anchors to that element and is weakened without it —
  and a `preconnect` to `fonts.gstatic.com` until the faces are self-hosted.
- **F4** Reconcile `src/components/style-tokens.ts` with the UI/UX primitives.
  `buttonPrimary` is `bg-ink text-paper` where the `Button` primitive uses
  possession fills, and `hover:opacity-90` does not work on `var()` colours in
  Tailwind 3 — there are `--*-hover` tokens for this. Two button vocabularies is
  one too many.
- **F5** Consume B1–B3 and B6 as they land: real `AttentionList`, live SSE
  against the corrected client stream, version-threaded revision notes (restore
  the "on v4" binding), and pre-computed read-only from the header `status`.
- **F6** Build the upload UI: presign → direct PUT → sha256 in the browser →
  `POST /api/versions`. Multipart is the browser's job per ADR-015 and the app
  never sees a byte. Without this the shelf and versions are read-only and
  Phase 3 is not actually usable.
- **F7** `NEXT_PUBLIC_APP_URL` is read but absent from `.env.example`.
- **F8** An onboarding screen for `POST /api/onboarding/org`. A freshly
  magic-linked user has no org and every agency route 401s until it runs.

### UI/UX
- **U1** Your `--muted` and `--rule-strong` corrections are ratified. Fold them
  back into `docs/DESIGN-SYSTEM.md` itself with the measured ratios beside them,
  so the next reader of that file does not re-derive the failing value. The
  frozen doc currently still publishes `#6B7168`, which measures 4.14:1 and
  fails AA.
- **U2** Same for the dark-mode lightening: the doc says a flat +18%, which you
  measured as failing on `--paper-2`. Publish the real per-token deltas.
- **U3** Specify the **upload** component (F6) — drop zone, per-file progress,
  hashing state, multipart resume, and every failure mode. It is the one flow
  with no spec and the one most likely to be met at 3am on a deadline.
- **U4** Specify the **onboarding** screen (F8) and the **error/empty states for
  a stream that has dropped** — SSE reconnect is now real and has no visual
  language.
- **U5** Give QA what it needs for the accessibility floor: exact assertions for
  visible focus, `prefers-reduced-motion`, and the contrast pairs, in a form a
  Playwright test can execute. Two EXIT conditions are UNPROVEN because the spec
  is prose.

### QA
- **Q1** `.railway/railway.ts` — you flagged Railway Config as Code as deprecated
  with a hard 2026-12-01 cutoff and no opt-in for new services. **You now own
  `.railway/**`.** It is written out in your runbook; lift it in. This is
  blocking for Phase 8.
- **Q2** Unskip and assert against B1–B7 as they land. In particular the e2e
  suite should go green once B7 exists — report exactly which of the 22 pass.
- **Q3** The "every client-reachable query has a case in `visibility.spec.ts`"
  guard is **procedural, and ADR-006 says it must be mechanical.** Write the
  check: enumerate exported functions in `src/db/queries/` that take a
  `ClientScope`, diff against the cases in the suite, fail on any not covered.
  This is the single highest-value thing you can build in Round 2.
- **Q4** The two pre-session reads in `client-auth.ts` — `loadLinkableEngagement`
  and `findContact` — take no scope by necessity. Give them their own cases
  asserting they cannot reach a lane, card, or file.
- **Q5** Accessibility assertions from U5, against the real components.
- **Q6** Re-run the env-registry gate after B8 and F7; it should go green.
- **Q7** Do **not** assert the round counter's location (see ruling 1).

---

## Standing rules, unchanged

- No dependency without an ADR and the Architect's approval. Round 1 added zero.
  Hold that line.
- Never edit a test in `tests/invariants/` to make a build pass. Strengthening
  is welcome; weakening fails CI on QA's own `check-invariant-weakening` gate.
- Do not touch a file you do not own. Report it instead — that worked in Round 1
  and is why there were no collisions.
- `npm run verify` must be green before you report done.
