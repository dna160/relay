# Technical Delivery Package — Platform Layer

Produced by the dev-squad structure: Architect blueprint, four role passes,
integration review, compiled. Conflicts are resolved here rather than listed;
what remains genuinely undecided is in PRD Part D.

Scope: the identity, tenancy, auth, ingestion, and deployment modules layered on
the shipped v1 build.

---

## I. Architect — blueprint

### Module map and seams

```
        ┌──────────────────────────────────────────┐
        │  M1 Identity & Tenancy                   │  accounts, orgs, memberships,
        │     resolveAccess()                      │  teams, resolveAccess
        └───────────┬──────────────────┬───────────┘
                    │                  │
        ┌───────────▼──────┐   ┌───────▼────────────┐
        │  M2 Auth & Invites│   │ M3 Navigation      │  switcher, cross-org
        │  Google, codes,   │   │    & Teams         │  portfolio, team grants
        │  invite redemption│   └────────────────────┘
        └───────────┬───────┘
                    │
        ┌───────────▼──────────────────────────────┐
        │  M4 Ingestion                            │  extract → propose →
        │     → template definition                │  confirm → applyTemplate
        └───────────┬──────────────────────────────┘
                    │
        ┌───────────▼──────────────────────────────┐
        │  M5 Deployment & Retention hardening     │  Railway, backups,
        └──────────────────────────────────────────┘  certificate resolution
```

M1 is the spine and blocks everything. M2 depends on M1. M3 and M4 both depend on
M1 and M2 but not on each other — that is the only safe parallel seam. M5 depends
on all of them and on resolving D1 and D2.

### Governing decisions

1. **`accounts.id` is ours.** Provider subjects are rows in `identities`. Adding
   SAML later touches one table.
2. **Membership is the only grant.** Project membership does not require org
   membership. Teams expand to individual `project_membership` rows on grant, so
   there is exactly one authority table.
3. **`resolveAccess()` is the sole permission authority** (INV-11), deny by
   default, re-evaluated per request per object. The org switcher is UI state.
4. **Invites carry no authority** (INV-12). Redemption requires independent
   verification of the invited address.
5. **Ingestion emits a template definition** (INV-13), never a project graph. One
   creation path, reviewable extraction, free "save as template".
6. **Deterministic before probabilistic.** A model is used only where parsing
   cannot reach: column-to-field mapping, prose-to-card structuring, role
   inference. Emails found literally in a document are never inferred.
7. **Migration runs in shadow before it runs for real.** Old and new checks
   execute together, disagreements are logged, and the old path is removed only
   when disagreements are zero for a week.

### Non-functional requirements

- `resolveAccess()` p99 under 5ms; single indexed query, request-scoped memo.
- Client board FCP under 1.5s on 4G from Singapore region — it is the acquisition
  surface and the reviewer is not motivated.
- Ingestion: XLSX under 10s, 40-page PDF SOW under 60s, both as background jobs
  with progress. Never blocking a request.
- Every destructive job is dry-runnable and prints a manifest first.
- Migrations run as a pre-deploy step, never on app boot.

---

## II. UI/UX

### New surfaces

**Command switcher (⌘K).** The original requirement — jumping between projects —
now spans organizations. A palette, not a dropdown: type three characters, match
across org, project, and card, jump. A dropdown breaks at four orgs; a palette
scales to forty. Recent projects first, then fuzzy match, with the org name as a
secondary line so two clients with a "Website Refresh" are distinguishable.

**Cross-org portfolio.** The home screen becomes "everything awaiting me,"
grouped by actionability, with org as a filter chip rather than a container. A
freelancer sees one flat list and never learns the word "organization."

**Sign-in.** Code field is primary and focused on load; six digits, autocomplete
`one-time-code`, paste-friendly. The emailed link is secondary and lands on a
page with a single confirm button — never auto-consuming.

**Invite redemption.** Shows who invited you, to what, in what role, before
asking for anything. Then verification. If the verified address differs from the
invited one, the screen says so plainly and offers to request a new invite,
rather than failing ambiguously.

**Ingestion review.** A three-pane diff: source document on the left with the
current row highlighted, proposed structure in the middle, edit controls on the
right. Rows sorted by confidence ascending — the ones needing attention are at
the top, not buried. Bulk accept above a confidence threshold, with a count
("accept 12 high-confidence rows"). A "needs review" filter. Kickoff date is
requested once, up front, when any relative date was extracted.

**Assignment suggestions.** A chip reading the inferred role label with a
confidence dot, click to open candidates, never pre-filled. Sending an invite is
a separate, explicitly labelled action — never a side effect of accepting a row.

### Design tokens (extending the shipped system)

Possession hues, mono-for-records, and breach-red-only are unchanged. Additions:

```css
--org-tint:   /* derived per org from name hash, 12% opacity */
--confidence-high:  var(--agency);
--confidence-low:   var(--muted);
--suggestion:   1px dashed var(--rule);   /* never a solid fill */
```

Inferred content is always dashed and never solid. The visual language must make
"the machine guessed this" legible at a glance, because the whole safety model
depends on humans actually reviewing rather than clicking through.

Org tint appears as a 2px left edge on cards in cross-org views only. Inside a
project it is absent — you know where you are.

### Accessibility floor

Palette is fully keyboard-driven with arrow navigation and visible focus. Code
input announces errors via `aria-live`. Confidence is never colour-alone — the
dot carries a numeric label on hover and in the accessible name. Responsive to
360px. `prefers-reduced-motion` respected.

---

## III. Front-end

### Route structure

```
src/app/
├── (auth)/
│   ├── sign-in/            # code-first
│   ├── verify/
│   └── invite/[token]/     # resolves, then requires verification
├── (app)/
│   ├── home/               # cross-org attention list
│   ├── o/[orgSlug]/
│   │   ├── projects/
│   │   ├── team/
│   │   └── settings/
│   └── p/[projectId]/
│       ├── board/
│       ├── shelf/
│       ├── ingest/         # upload → job progress → review → stamp
│       └── settings/
└── (reviewer)/
    └── r/[token]/          # unchanged from v1, separate bundle
```

### State and permission rendering

Session context exposes `accountId`, memberships, and `activeOrgId`. Components
may render *optimistically* from client-side membership data — hiding a button
the user cannot use — but **the server never trusts it**. Every mutation
re-resolves. The client-side copy is a UX affordance and is documented as such at
the top of the context file, because the next person to touch it will assume
otherwise.

Reviewer bundle imports nothing from `(app)`. Enforced by an ESLint boundary rule,
not by convention.

### Ingestion client

Upload is presigned direct to R2. The job id returns immediately; progress
streams over the existing SSE channel. The review screen holds the proposal in
local state and submits one confirmed `TemplateDefinition` — partial saves are
explicitly not supported, because a half-confirmed extraction is a state nobody
can reason about later.

---

## IV. Back-end

### New tables

```
accounts(id, primary_email citext unique, name, created_at)
identities(id, account_id, provider, provider_subject, email, email_verified,
           UNIQUE(provider, provider_subject))
organizations(id, slug unique, name, kind 'personal'|'team', plan, brand_*)
org_memberships(account_id, org_id, role, created_at, PK(account_id, org_id))
teams(id, org_id, name)
team_members(team_id, account_id, PK(team_id, account_id))
project_memberships(account_id, project_id, role, granted_via_team_id null,
                    created_at, PK(account_id, project_id))
invites(id, token_hash, target_kind 'org'|'project', target_id, email citext,
        role, invited_by_account_id, expires_at, consumed_at)
signin_tokens(id, token_hash, email citext, expires_at, consumed_at, attempts)
ingest_jobs(id, project_id, org_id, source_file_key, input_class, status,
            proposal jsonb, confirmed_definition jsonb, error, created_by,
            created_at, completed_at)
```

Indexes that matter: `project_memberships(account_id)`,
`org_memberships(account_id)`, `invites(token_hash)`, `signin_tokens(token_hash)`,
`ingest_jobs(project_id, status)`.

### `resolveAccess()`

One query, request-scoped memo, deny by default:

```sql
SELECT pm.role AS project_role, om.role AS org_role
FROM projects p
LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.account_id = $1
LEFT JOIN org_memberships om     ON om.org_id = p.org_id AND om.account_id = $1
WHERE p.id = $2;
```

Effective role = stronger of `project_role` and the org-derived role (D3 governs
whether `admin` derives project access at all). Null on both means null, not a
default reviewer role — the most common way a permission system leaks is a
fallback that seemed harmless.

### Token service

```ts
issueSignin(email): { code }            // 6 digits, sha256 stored, 15 min
consumeSignin(email, code): AccountId   // atomic, attempt-limited, constant-time
issueInvite(target, email, role, by): { token }
resolveInvite(token): InvitePreview     // reveals target and inviter, grants nothing
redeemInvite(token, verifiedAccountId): Membership   // fails on address mismatch
```

`redeemInvite` takes an account id that has *already* been verified in this
session. There is no code path in which a token alone produces membership
(INV-12).

### Ingestion pipeline

```
1. presign + upload            → reference shelf, private by default
2. classify                    → xlsx | docx | pdf | scanned_pdf
3. deterministic extract       → sheet/section/text + layout, with provenance
4. structure (model, if used)  → constrained JSON, schema-validated, retry once
5. resolve assignee hints      → deterministic email match; role inference second
6. persist proposal            → ingest_jobs.proposal, status = 'awaiting_review'
7. human confirmation          → confirmed_definition
8. applyTemplate(definition)   → project graph
```

Steps 3–6 run in the worker. Step 4 is skipped entirely for clean XLSX where
column mapping is unambiguous. Model output is validated against the schema and
rejected rather than coerced — a coerced hallucination is worse than a failed
job. One retry with the validation error appended, then fail with the partial
deterministic extraction preserved.

**No step in this pipeline sends an email.** (INV-14)

### Purge walk extension

`ingest_jobs` (including `proposal` and `confirmed_definition`, which contain
document content), uploaded source files, `invites`, and `signin_tokens` scoped
to the project all join the purge walk. `project_memberships` rows are deleted;
`accounts` are not — the person outlasts the project.

---

## V. QA & Deployment

### Invariant tests added

| | Test |
|---|---|
| INV-11 | Static: no file outside `domain/access/` compares an account id to a membership row. Runtime: a matrix of (org role × project role × object) against expected resolution, including both-null → deny |
| INV-12 | Redeeming an invite without a verified session yields no membership and no session cookie. Redeeming with a mismatched verified address fails |
| INV-13 | Ingestion job completion writes no rows to `lanes` or `cards`. Only `applyTemplate` does |
| INV-14 | Mail transport is asserted uncalled across the whole ingestion pipeline |
| INV-6 (revised) | A reviewer session presented with a second project id returns 404 |

### Migration shadow harness

Phase 9's core deliverable. Every existing permission check calls both the old
inline logic and `resolveAccess()`, returns the old result, and logs
disagreements with the full input. A dashboard counts disagreements per endpoint
per day. The old path is deleted only after seven consecutive days at zero. This
step is the one people skip, and it is the only step that tells you whether the
new graph agrees with the system already in production.

### Security tests

- Forwarded invite: redeem with a different verified address → denied.
- Mail scanner simulation: GET the sign-in link twice before any human action →
  token still valid; only the explicit POST consumes it.
- Enumeration: response time and body for a known and unknown address are
  indistinguishable.
- Unverified provider email does not auto-link to an existing account.
- Reviewer session cannot widen scope via any parameter on any route.

### Railway topology

| Service | Notes |
|---|---|
| `web` | Next.js, healthcheck `/api/health`, autoscale on CPU |
| `worker` | Same image, `npm run worker`. Purge, warnings, nudges, ingestion |
| `postgres` | Railway managed, private networking only |

Region: **Singapore (`asia-southeast1`)**, not the US default — roughly 200ms per
interaction for the initial user base.

Migrations run as a **pre-deploy command**, never on boot; two instances racing
the same migration is the classic first outage.

Schedules use **pg-boss cron inside the worker**, not Railway cron. Purge and
warning jobs must be idempotent, dry-runnable, and auditable in the same database
that records what they did — a scheduler that invokes a service gives none of
that.

Environments: `production` and `staging` as Railway environments, PR
environments for previews with a seeded ephemeral database.

Portability: everything is Docker plus Postgres plus S3-compatible storage. No
Railway-proprietary feature beyond the deploy layer, so the exit is a weekend.

### Observability

Structured logs carrying `account_id`, `org_id`, `project_id` on every line.
Error tracking with release tagging. Three alerts that page: purge job failure,
`resolveAccess` p99 above 20ms, and any INV test failing in CI on `main`.

### Backup and certificate — blocked

Cannot be completed until D1 and D2 are resolved. The runbook is written both
ways and the correct branch is selected at that point. **Do not ship the deletion
certificate to customers before this is decided** — an inaccurate certificate is
worse than no certificate.

---

## VI. Integration manifest

**Shared types** live in `src/lib/types.ts`, imported by both sides, never
redeclared: `Session`, `AccessResult`, `ExtractedPlan`, `TemplateDefinition`,
`InvitePreview`.

**API contract additions**

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/signin/request` | `{ email }` → always 200 |
| POST | `/api/auth/signin/verify` | `{ email, code }` → session |
| GET | `/api/invites/:token` | `InvitePreview`. Grants nothing |
| POST | `/api/invites/:token/redeem` | Requires a verified session |
| GET | `/api/orgs` | Orgs for the session account |
| POST | `/api/orgs/:id/teams/:teamId/grant` | Expands to membership rows |
| POST | `/api/ingest` | `{ projectId, fileKey }` → `{ jobId }` |
| GET | `/api/ingest/:jobId` | Status + proposal |
| POST | `/api/ingest/:jobId/confirm` | `TemplateDefinition` → project graph |

**Environment registry**

`DATABASE_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`RESEND_API_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET`, `ANTHROPIC_API_KEY`, `INGEST_MODEL`, `PUBLIC_URL`,
`SIGNIN_CODE_TTL_SECONDS`, `INVITE_TTL_DAYS`, `PURGE_DRY_RUN`.

**Events** added to the SSE stream: `ingest.progress`, `ingest.ready`,
`membership.granted`, `invite.redeemed`.

**Auth flow, end to end**

```
email → POST signin/request → code emailed → POST signin/verify
  → account session (accountId, activeOrgId = last used or personal org)
  → every request: resolveAccess(accountId, objectId) → allow | 404

invite link → GET /api/invites/:token → preview (no session)
  → sign in or Google (independent verification)
  → POST redeem (address must match) → membership row → session widened by graph
```

---

## VII. Inter-agent resolutions

Front-end proposed caching resolved permissions in the session cookie to avoid a
per-request query; back-end objected that a cached grant survives revocation.
Resolved in back-end's favour — permission is re-resolved per request, memoised
per request only, and the query is a single indexed lookup. The front-end keeps a
membership copy for rendering only, documented in-file as non-authoritative.

UI/UX proposed auto-accepting ingestion rows above 0.9 confidence to reduce
review friction. Rejected: the confirmation step is the entire safety model of
M4, and an auto-accept threshold is the mechanism by which it quietly stops
existing. Compromise adopted — bulk accept remains one deliberate click with a
visible count.

QA proposed running the migration shadow harness for 48 hours. Extended to seven
days: agency usage is weekly-cyclical, and a Tuesday sample does not contain the
Friday approval rush where most permission edge cases live.

Back-end proposed teams as a first-class grant resolved at query time. Rejected
in favour of expansion to individual membership rows — two authority paths means
two places to get revocation wrong, and revocation is the operation that must
never fail.

---

## VIII. Open tensions

Escalated to the product owner. Each blocks the phase named in PRD Part D: D1 and
D2 (backups and tombstone, Phase 13), D3 (org admin project access, Phase 9), D4
(model sub-processor default, Phase 12), D5 (low-confidence ingestion behaviour,
Phase 12).

D1 and D2 are the urgent pair. They are the only ones where shipping the current
specification would put an inaccurate statement in front of a customer's legal
team.
