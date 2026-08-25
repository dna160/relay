# HANDOFF — Product Requirements Document

**Version:** 2.0 — comprehensive. Supersedes v1.0 in full.
**Working name:** Handoff (placeholder)
**Status:** v1 shipped. This document specifies the platform layer on top of it.
**Wedge:** Agencies and studios serving many clients; freelancers as the long tail.

---

# PART A — PRODUCT

## 1. Problem

An agency signs a contract and the work immediately fragments. Assets go to
Drive, feedback arrives in email and Slack, approvals happen verbally, and the
project manager becomes a human message bus. Two costs follow.

**Delivery drag.** Nobody can answer "what is blocked, and on whom?" The agency
absorbs blame for delays caused by client feedback latency, because there is no
record of who held the work and for how long.

**Scope leak.** Revision rounds are contracted and then uncounted. Round four of
a two-round agreement is invisible until the margin is gone.

Existing tools fail at the boundary, not at the board. Asana and Monday charge
per seat and were built for one company's employees. Basecamp has a client view
but is permanent and message-centric. Frame.io nails versioned review for video
only. Drive holds files but knows nothing about what they mean.

## 2. Theses

**T1 — The project is the unit of everything.** One signed contract produces one
project, reachable by one link. That object is simultaneously the unit of work,
of access, of billing, and of deletion. Four concerns, one lifecycle. This is the
structural advantage: competitors committed to permanent storage pay for files
forever. Handoff does not.

**T2 — The board is a rendering, not a record.** Cards move because a file was
submitted or a decision was made, never because someone dragged them. A board
people maintain by hand becomes a board that lies, and every metric built on it
becomes fiction.

**T3 — People outlast projects.** A designer works across four agencies, a
freelancer has no agency, a client contact reviews work from three vendors. The
account is durable; organizations and projects attach to it. Identity scoped to a
single engagement was the v1 simplification and is now the constraint to remove.

**T4 — Starting should cost nothing.** A signed SOW or a project spreadsheet
already contains the plan. Re-typing it into a board is the tax that keeps teams
in email. Ingestion removes the tax; human confirmation keeps it honest.

## 3. Users and access

| Role | Holds | Access path |
|---|---|---|
| Owner / admin | An organization | Account, Google or email |
| Member | Org membership + project memberships | Account |
| External collaborator | Project membership only, no org visibility | Account |
| Reviewer | One project, no account | Magic link |
| Freelancer | Personal org, projects, no colleagues | Account |

Reviewers are never billed and never create an account. Gating the client side
kills the growth loop, in which a client who liked the experience asks their
*other* vendors to use Handoff.

## 4. Tenancy model

```
account (a person, canonically a verified email)
  ├── identity           google | email        (one row per provider)
  ├── org_membership  →  organization          owner | admin | member
  └── project_membership → project             lead | contributor | reviewer
```

Rules that follow, each load-bearing:

- **A project membership does not require an org membership.** This is what lets
  an external collaborator work inside your project while seeing nothing of your
  organization. Systems that derive project access from org access make the
  external case special, and special cases leak.
- **Every account gets a personal organization at signup.** There is no orgless
  project. The freelancer is an account whose only org is their own, hidden until
  they invite someone. A nullable `org_id` would put a branch in every query,
  permission check, billing count, and purge sweep.
- **An account belongs to many organizations and many concurrent projects.** No
  exclusivity anywhere.
- **Teams** are named subsets of an org's members that can be granted a project
  role in one action. They are a convenience over `project_membership`, never a
  separate authority — expanding a team writes individual rows.
- **The org switcher is UI state, never authority.** Every request re-resolves
  permission for the specific object being touched.

## 5. Identity and authentication

**Provider: Auth.js v5 — Google OAuth and email code, sessions in Postgres.**
Rejected Firebase Auth: it puts identity in a different datastore from the
permission graph it must join against, requires a permanent uid-to-account sync,
cannot express multi-org membership regardless, and adds a second vendor to the
one path that must never be down. Enterprise SSO (SAML, SCIM) for the Studio tier
arrives later as an additional row in `identities`, not as a replacement.

**The auth vendor never owns the user id.** `accounts.id` is ours; provider
subjects are rows in `identities`.

**Account linking.** A Google login auto-links to an existing account only when
the provider asserts `email_verified` for a matching address. Otherwise the link
is pending until an email code confirms it. Skipping this is a documented
account-takeover path.

### 5.1 Three token types, never conflated

| Token | Lifetime | Purpose |
|---|---|---|
| Invite | 7 days, single-use | Identifies an offer of membership: email, target, role |
| Sign-in | 15 minutes, single-use | Proves control of an email address |
| Session | 30 days, rolling | Established only after a sign-in token or OAuth |

**An invite authenticates nobody.** Clicking it resolves the invitation and then
demands independent verification of the invited address. A mismatch is not
redeemable. Without this, a forwarded invite email — routine in agency work — is
an account takeover.

**Sign-in leads with a 6-digit code.** Corporate mail scanners prefetch URLs and
will silently consume a one-time link before the human clicks. Client contacts
are exactly the population sitting behind those scanners. A link, where offered,
lands on a page requiring an explicit POST to consume.

Only `sha256(token)` is stored. Redemption is atomic. Responses never reveal
whether an address has an account, and take the same time either way.

## 6. Work model

### 6.1 Board and lanes
Lanes are published by default; private is explicit. Private lanes and their
cards are never serialised to a reviewer — the guard is at the query layer, not
the UI. Cards are deliverables, not tasks. Drag reorders position and never
changes state.

### 6.2 Stage and backstage
One card, two projections, no second board and no double entry. The client sees
title, state, due date, published versions, their notes, and rounds used. The
agency additionally sees assignee, internal subtasks, unpublished drafts,
possession split, and effort. An internal review gate sits before
`AWAITING_CLIENT`; `INTERNAL_REVIEW` collapses to `IN_PROGRESS` in the client
projection, so the client learns work is underway, not that draft two was
rejected.

### 6.3 State machine

```
DRAFT → ASSIGNED → IN_PROGRESS → INTERNAL_REVIEW → AWAITING_CLIENT
             ↑                                            │
             └──────── CHANGES_REQUESTED ←────────────────┤
                                                          ↓
                                                 APPROVED → SIGNED_OFF
```

Possession: agency holds everything except `AWAITING_CLIENT`. `SIGNED_OFF` is
terminal and holds nothing.

### 6.4 Files
Two classes, deliberately not one filesystem. **Versions** live on cards —
immutable, numbered, hashed, each with its own note thread and approval state;
notes thread to the version they were written against and never float forward.
**Reference shelf** — brand guidelines, raw footage, the contract — flat, a
handful of labelled groups, no versioning, no tree.

### 6.5 Approvals
A decision binds to one immutable version and records the deciding identity,
timestamp, IP, user agent, and the file's sha256 copied at decision time.
Decisions are `APPROVED` or `CHANGES_REQUESTED`, the latter requiring a note.

### 6.6 Time intelligence
The possession clock is derived from `state_transitions` and never stored as a
running total, producing "9 of 14 days awaiting client." It is agency-internal by
default; auto-surfacing latency to a paying client is a diplomatic incident.
Revision rounds increment on each `AWAITING_CLIENT → CHANGES_REQUESTED` cycle and
compare against the contracted number.

Attention ranks by **actionability**, not deadline proximity: blocked on me,
blocked on my team, with the client, no movement in seven days. Colour encodes
possession; red is reserved for a breached commitment alone, so it still means
something on a Wednesday afternoon.

## 7. Document ingestion

A signed SOW or a project spreadsheet already contains the plan. Ingestion turns
it into a board without re-typing.

**Ingestion emits a template definition, never a project.** It runs through the
same `applyTemplate()` as everything else. One creation path, extraction becomes
reviewable data, and "save this SOW's structure as a reusable template" falls out
for free.

```
upload → extract → structure → PROPOSE → human confirmation → stamp
```

**Human confirmation is mandatory.** The review screen is a diff — accept, edit,
or drop per row — sorted by confidence, with a provenance link showing the page,
cell, or sentence each item came from. Never auto-create.

### 7.1 Input classes, honestly labelled

| Input | Precision | Approach |
|---|---|---|
| XLSX / CSV plan with a header row | High | Structured parse; the model only maps columns |
| DOCX SOW with headings | Medium-high | Section parse, then structure |
| Narrative PDF SOW | Medium | Text + layout extraction, then structure |
| Scanned PDF | Low | OCR first; flag the whole extraction as needing review |

The UI states the result plainly: "18 items found, 6 need review."

### 7.2 Assignment intelligence, in two tiers

**Deterministic first.** Email addresses literally present in the document,
matched against existing accounts and memberships. High precision, no inference.

**Inference second, as suggestions only.** Role labels — "Design lead",
"Localization vendor" — mapped to org members by role and past assignments,
surfaced with a confidence score, never pre-applied.

**An inferred assignment never triggers an outbound invite.** Emailing a stranger
because a model read their name off a PDF is a privacy incident involving your
customer's client, which is the worst possible party to have one with. Invites
are always an explicit human action on a named address.

### 7.3 Dates
SOW dates are usually relative: "within 10 business days of kickoff." The schema
carries relative offsets anchored to a kickoff date the user supplies at
confirmation. Absolute dates guessed by a model are a support ticket.

### 7.4 Handling of source documents
Ingested documents land on the reference shelf, defaulting to private — SOWs
carry rates and legal terms. Extracted data is covered by the purge walk, or the
deletion certificate has a hole in it. Sending document content to a model API is
a sub-processor disclosure the agency's own clients may care about: it is a
per-org setting, disclosed, and off by default for organizations that opt into
strict handling.

## 8. Ephemerality

A project is **active** if `status = ACTIVE` and it has had activity in the last
30 days. Inactive → `ARCHIVED` (read-only) → warnings at archive, +14d, +23d,
+29d → hard purge at 60 days from last activity.

**Both sides are warned.** Reviewers and external collaborators receive every
notice the agency receives, plus a free one-click export of everything they can
see, never paywalled. The agency's contract with its client almost certainly
obliges it to retain deliverables; a silent purge manufactures a breach.

Purge destroys object bytes and content rows and leaves one **deletion
certificate** — a signed manifest of hashes, counts, and timestamp, emitted to
both parties. Certified destruction of client IP after delivery is a compliance
artifact agencies get asked for.

**Unresolved and blocking:** managed Postgres backups retain a copy of content
you certified as destroyed. Either the certificate specifies "purged from primary
systems immediately, from backups within N days," or the backup strategy must
exclude purged content. See Part D.

## 9. Plans

One scaling unit: **concurrent active projects per organization.** The other
levers are gates and caps, not multipliers. An account belonging to five
organizations consumes none of its own quota.

| | Free | Pro | Studio |
|---|---|---|---|
| Active projects | 3 | 15 | Unlimited |
| Members | Unlimited | Unlimited | Unlimited |
| Retention | Purge at 60d | Indefinite | Indefinite |
| White-label | — | Logo, colours | Custom domain, SSO, audit export |
| Ingestion | 3 documents/mo | Unlimited | Unlimited + strict handling |
| Storage | Fair-use cap | Higher cap | Negotiated |

Seats are never charged: agencies run on freelancers who cycle weekly, and
per-seat pricing produces shared logins and destroys usage data. It is also a
direct knife against the seat-based incumbents.

## 10. Out of scope

- **Chat rooms.** Per-lane chat ships forty empty rooms, loses to Slack and
  email, and becomes the off-record surface where the "yeah just go ahead" that
  later gets disputed happens. Discussion attaches to cards and versions.
- **Live huddles.** A meeting link on the card, notes dropped back onto it.
- **Procurement, invoicing, SOW negotiation.** Different buyer, different sales
  cycle. The project object is shaped so this can layer on later.
- **Time tracking.** The possession clock answers the question that matters.
- **Cross-org reviewer accounts.** A reviewer who wants a home upgrades to an
  account; there is no separate reviewer-side product in this scope.

## 11. Metrics

**North star:** weekly active projects with at least one client-side action. It
is the only metric that fails if either side stops showing up.

| Metric | Target |
|---|---|
| Reviewer time-to-first-action after invite | under 5 min |
| Approvals in-product vs email | over 80% by week 4 |
| Ingestion rows accepted without edit | over 70% for XLSX, over 45% for PDF SOW |
| Projects created via ingestion | over 40% of new projects by month 3 |
| Median client possession per cycle | trending down |
| Cards edited with no file activity | under 10% |

The last one is the health check that matters most. If agencies maintain the
board by hand, the product has become a status page and every other number is
fiction.

---

# PART B — SYSTEM

## 12. Stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15 App Router, TypeScript strict | One deployable; RSC suits the read-heavy client board |
| DB | Postgres 16 + Drizzle | Explicit SQL, cheap row-level filtering, migrations in-repo |
| Auth | Auth.js v5 — Google + email code | Identity sits next to the permission graph |
| Objects | Cloudflare R2 | Zero egress — decisive for a file-heavy product |
| Jobs | pg-boss | Purge, warnings, nudges, ingestion. No extra infra |
| Extraction | `xlsx`, `mammoth`, `pdfjs` + layout; OCR via `tesseract` fallback | Deterministic before probabilistic |
| Structuring | Claude with a constrained JSON schema | Only where deterministic parsing cannot reach |
| Realtime | SSE over LISTEN/NOTIFY | No vendor dependency |
| Email | Resend | Codes, invites, warnings, certificates |
| Deploy | Railway — Singapore region | Single-provider ops; Docker keeps it portable |

## 13. Invariants

Enforced by `tests/invariants/`. Never edited to make a build pass.

| | Rule |
|---|---|
| INV-1 | No reviewer response contains a private lane, private card, agency-only state, unpublished version, or internal field |
| INV-2 | `cards.state` changes only via the state machine |
| INV-3 | An approval references one immutable version and stores its sha256 |
| INV-4 | `asset_versions` is append-only except by the purge worker |
| INV-5 | Every transition writes a `state_transitions` row carrying possession |
| INV-6 | *(revised)* A reviewer session is scoped to one project and cannot be widened |
| INV-7 | Purge destroys all bytes and content rows and leaves exactly one certificate |
| INV-8 | Active-project count is one function, called by both billing and expiry |
| INV-9 | Business logic lives in `src/domain/`; handlers parse, call, serialise |
| INV-10 | File bytes never traverse the app server |
| INV-11 | *(new)* All access decisions come from `resolveAccess()`. Deny by default |
| INV-12 | *(new)* An invite token never establishes a session |
| INV-13 | *(new)* Ingestion never writes a project graph; it emits a template definition a human confirms |
| INV-14 | *(new)* No inferred assignment triggers an outbound email |

## 14. Permission resolution

```ts
resolveAccess(accountId, projectId): {
  role: 'lead' | 'contributor' | 'reviewer' | null;
  via: 'project' | 'org' | 'team' | null;
}
```

Deny by default. Effective role is the stronger of direct project membership and
any role derived from org membership. Nothing else computes permissions — not a
route handler, not a component, not a query file.

## 15. Sessions

```ts
type Session =
  | { kind: 'account';  accountId: string; activeOrgId: string | null }
  | { kind: 'reviewer'; contactId: string; projectId: string };
```

`activeOrgId` is the switcher's UI state. It is never an authority.

## 16. Ingestion schema

```ts
interface ExtractedPlan {
  sourceDocumentId: string;
  inputClass: 'xlsx' | 'docx' | 'pdf' | 'scanned_pdf';
  kickoffAnchorRequired: boolean;
  overallConfidence: number;
  lanes: ExtractedLane[];
  shelfCandidates: { filename: string; suggestedGroup: string }[];
}

interface ExtractedLane {
  name: string;
  position: number;
  visibility: 'published' | 'private';
  cards: ExtractedCard[];
}

interface ExtractedCard {
  title: string;
  description: string | null;
  due:
    | { kind: 'absolute'; date: string }
    | { kind: 'relative'; offsetDays: number; businessDays: boolean;
        anchor: 'kickoff' | 'prior_card' }
    | null;
  contractedRounds: number | null;
  assigneeHint:
    | { kind: 'email'; email: string }          // deterministic
    | { kind: 'role';  label: string; candidates: string[] }  // inferred
    | null;
  confidence: number;                            // 0..1
  provenance: { page?: number; sheet?: string; cell?: string; excerpt: string };
}
```

`provenance` is not optional in practice — the review screen must show where each
row came from, or confirmation becomes rubber-stamping.

---

# PART C — DELIVERY

Implementation plan, module sequencing, and role-level detail: see
`docs/DELIVERY-PLAN.md`. Phase files: `docs/phases/PHASE-9.md` through
`PHASE-13.md`.

---

# PART D — OPEN DECISIONS

These are product owner calls, not engineering gaps. Each blocks a specific
phase.

**D1 — Backups vs certified deletion.** *Blocks Phase 13.* Managed Postgres
backups keep purged content for the retention window. Either the certificate
reads "purged from primary systems immediately, from backups within N days," or
backups must exclude purged content, which is hard and expensive. A client's
legal team will ask.

**D2 — Tombstone recoverability.** *Blocks Phase 13.* Engineering wants a 30-day
soft delete for incident recovery; certified destruction says the bytes are gone.
Both defensible, mutually contradictory, and the certificate wording depends on
the answer. Related to D1 — resolve them together.

**D3 — Do org admins get automatic project access?** *Blocks Phase 9.*
Convenience says yes; least privilege says no, and agencies handling competing
clients may need Chinese walls between projects in the same org. Currently
specified as yes for `owner` and `admin`, configurable per org at Studio tier.

**D4 — Model sub-processor default.** *Blocks Phase 12.* Ingestion sends document
content to a model API. Off by default for strict-handling orgs is specified;
whether it is off by default for *everyone* is a growth-versus-trust call.

**D5 — Low-confidence ingestion.** *Blocks Phase 12.* When overall confidence is
below threshold, does the flow still offer a partial board, or refuse and suggest
manual setup? A bad first board may be worse than none.

**D6 — Possession visibility to clients.** Internal-only in v1. A plausible Pro
feature and a plausible relationship hazard.

**D7 — Reactivation pricing.** Reactivating an archived project is the strongest
conversion moment in the product. Paywall or free courtesy is untested.
