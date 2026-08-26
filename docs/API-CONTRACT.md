# API Contract

Front-end and back-end conform to this file. Where an implementation diverges,
this file wins and both sides change. Types live in `src/lib/types.ts` and are
imported by both — never redeclared.

## Auth

Two session kinds. A request carries exactly one.

```ts
type Session =
  | { kind: 'agency'; userId: string; orgId: string; role: 'admin' | 'member' }
  | { kind: 'client'; contactId: string; engagementId: string };
```

Client sessions come from a magic link: `POST /api/auth/client/request`
(engagement token + email) then `POST /api/auth/client/verify` (code). The
session cookie is scoped to one engagement id and cannot be widened (INV-6).

## Shared types

```ts
type CardState =
  | 'draft' | 'assigned' | 'in_progress' | 'internal_review'
  | 'awaiting_client' | 'changes_requested' | 'approved' | 'signed_off';

type ClientCardState = Exclude<CardState, 'draft' | 'internal_review'>;

interface ClientCard {              // what a client contact receives
  id: string;
  laneId: string;
  title: string;
  description: string | null;
  state: ClientCardState;           // internal_review collapses to in_progress
  dueAt: string | null;
  position: number;
  roundsUsed: number;
  contractedRounds: number | null;
  versions: ClientVersion[];        // only those published to client
  awaitingYou: boolean;
}

interface AgencyCard extends Omit<ClientCard, 'state' | 'versions'> {
  state: CardState;
  versions: AgencyVersion[];
  assignee: { id: string; name: string } | null;
  internalNotes: string | null;
  effortEstimate: number | null;
  possession: { agencyMs: number; clientMs: number };
}
```

`ClientCard` has no `assignee`, `internalNotes`, `effortEstimate`, or
`possession` field. Absence is structural, not conditional — the client
serialiser cannot emit them.

## Endpoints

### Agency

| Method | Path | Notes |
|---|---|---|
| GET | `/api/engagements` | Portfolio. Returns counts, possession summary, days-to-purge |
| POST | `/api/engagements` | 402 if plan's active limit is reached |
| GET | `/api/engagements/:id` | Agency projection |
| POST | `/api/engagements/:id/invite` | Adds a client contact, sends the link |
| POST | `/api/engagements/:id/wrap` | Marks delivered, starts the countdown |
| POST | `/api/engagements/:id/export` | Queues a zip; returns a job id |
| GET | `/api/engagements/:id/board` | Lanes + agency cards |
| POST | `/api/lanes` `PATCH /api/lanes/:id` | `visibility` defaults to `published` |
| POST | `/api/cards` `PATCH /api/cards/:id` | `state` is **rejected** here (INV-2) |
| POST | `/api/cards/:id/transition` | The only state writer. Body: `{ to, reason? }` |
| POST | `/api/cards/:id/publish` | Passes the internal gate -> `awaiting_client` |
| POST | `/api/uploads/presign` | `{ cardId? , engagementId, filename, mime, size }` |
| POST | `/api/versions` | Records metadata + sha256 after a completed upload |
| GET | `/api/templates` `POST /api/templates` | |

### Client

| Method | Path | Notes |
|---|---|---|
| GET | `/api/client/board` | Published lanes and cards only |
| GET | `/api/client/queue` | Cards where `awaitingYou = true` |
| POST | `/api/client/versions/:id/decision` | `{ decision, note? }`. Note required on `changes_requested` |
| POST | `/api/client/comments` | |
| GET | `/api/client/export` | Everything the contact can see. Never paywalled |
| GET | `/api/client/download/:versionId` | 302 to a presigned GET |

Client routes take the engagement from the session, never from the request body.
A client route that accepts an `engagementId` parameter is a bug.

## Errors

```ts
{ error: { code: string; message: string; details?: unknown } }
```

| Code | HTTP | When |
|---|---|---|
| `PLAN_LIMIT_REACHED` | 402 | Active engagement cap hit |
| `INVALID_TRANSITION` | 409 | State machine rejected the move |
| `ENGAGEMENT_ARCHIVED` | 423 | Read-only; any mutation |
| `ENGAGEMENT_PURGED` | 410 | Gone. Points at the certificate |
| `NOT_VISIBLE` | 404 | Client asked for a private object. Never 403 — a 403 confirms it exists |

`NOT_VISIBLE` returning 404 is deliberate. Telling a client that a lane exists
but is hidden leaks the thing INV-1 protects.

## Events (SSE)

**Amended R2 — see Amendment A1.** Agency: `GET /api/events?engagementId=`.
Client: `GET /api/client/events`, which takes the engagement from the session
and accepts no parameter. Both stream:
`card.transitioned`, `version.published`, `decision.recorded`,
`comment.created`, `engagement.warned`. Client streams are filtered through the
same projection as REST — the stream is not a side door.


---

## Amendments

Changes made after the contract was frozen, each with the reason. This log is
the provenance — where an amendment and the body of this document disagree, the
amendment is newer and wins.

### A1 — the client event stream takes no parameter (INV-6)
*Raised by the back-end in round 1. Contract defect.*

The frozen contract specified one stream, `GET /api/events?engagementId=`. For a
client session that is an INV-6 violation on its face: a client route must take
the engagement from the session and never from the request. The invariant is
law and the contract was wrong. Split into an agency stream, which keeps the
parameter and authorises it against the org, and `GET /api/client/events`, which
accepts no parameter at all. Neither is a side door — both are filtered through
the same projection as REST.

### A2 — `INTERNAL` (500) added to `ERROR_CODES`
The error helper emitted `code: 'INTERNAL'`, which was not a valid `ErrorCode`.
It carries no `details` — an internal failure explaining itself to a client
contact is an information leak with a stack trace attached.

### A3 — every response is enveloped
Responses are `{ card }`, `{ lane }`, `{ engagements }`, `{ transition }` rather
than bare objects or arrays. A bare top-level array cannot gain a field later
without breaking every caller; the envelope is what makes `{ engagements, plan }`
possible without a v2.

### A4 — agency engagement routes live at `/w/[id]`, not `/e/[id]`
*Raised by the front-end in round 1. Framework constraint, not preference.*

`(agency)/e/[id]/board` and `(client)/e/[token]/board` both resolve to
`/e/:x/board`, and Next refuses to build. `/e/{token}` is the link printed in
client emails and could not move, so the agency side did. `docs/ARCHITECTURE.md`
has been corrected to match.

### A5 — mutations carry `engagementId` in the body
Agency mutation routes take the engagement explicitly so the authorisation check
has a subject before any row is read. Client routes still take it from the
session and must never accept it — that asymmetry is INV-6, not an inconsistency.

### A6 — routes added that the contract did not name
| Route | Why it had to exist |
|---|---|
| `POST /api/onboarding/org` | The Auth.js adapter creates a user before org membership exists, so a freshly magic-linked user has no org and every agency route 401s. Without this, no agency session can ever be reached. ADR-013. |
| `POST /api/cards/reorder` | Drag is a batch reindex. N individual PATCHes lose their ordering on refresh. |
| `POST /api/reference-files`, `GET /api/engagements/:id/shelf` | Presign already signed shelf keys; without these the shelf was a dead end. |

### A7 — routes named here that are not built yet, with their owning phase
`/api/attention` (Phase 5) · `/api/events`, `/api/client/events` (Phase 5) ·
 `/api/engagements/:id/export`, `/api/client/export`
(Phase 6). The front-end calls each of these and marks it `NOT BUILT` in
`src/lib/api-client.ts`. `GET /api/attention` is the portfolio's primary
content and is the first of them to land.

### A8 — routes shipped in round 2
| Route | Response | Note |
|---|---|---|
| `GET /api/attention` | `{ items: AttentionItem[] }` | Optional `?limit=` 1–200, default 50. Ranked server-side in PRD §5.5 order. Scoped to active engagements — an archived one cannot be acted on. |
| `GET /api/events?engagementId=` | SSE | Agency. The id is authorised against the org and 404s, never 403s. |
| `GET /api/client/events` | SSE | Client. Takes **no query string at all** (A1). Every frame is filtered through the same predicates as the board. |
| `GET/POST /api/versions/:id/notes` | `{ notes: AgencyRevisionNote[], cardId }` / `{ note }` | Notes carry `versionNo` — this is the "on v4" binding. |
| `GET/POST /api/client/versions/:id/notes` | `{ notes: ClientRevisionNote[], cardId }` / `{ note }` | Client shape emits no ids and no emails: display name and side only. |
| `GET /api/health` | `{ status, db, dbLatencyMs, checkedAt }`, 200 or 503 | A real `select 1` with a 3s race. A Next process boots fine against a wrong `DATABASE_URL`, so liveness alone proves nothing. Names no host, driver, or error text. |
| `POST /api/test/{seed,session}`, `GET /api/test/last-code` | test-only | Mounted only when `NODE_ENV !== 'production'` **and** a constant-time `E2E_SEED_TOKEN` match. Both, not either. Failure is 404. |

### A9 — client mutations assert writability
*Self-identified by the back-end in round 2.*

`POST /api/client/comments` and `POST /api/client/versions/:id/decision` did not
call `assertWritable`. A contact could therefore write into an archived
workspace — and a recorded decision would bump `last_activity_at`, pulling the
engagement back out of the retention timeline it had already entered. Both now
return 423 `ENGAGEMENT_ARCHIVED` before the write. This is the reason
`status` was added to the client board header (A8's sibling directive B6): the
surface has to be able to say so before the client types a note they cannot post.

### A10 — no `note.created` server event
A revision note publishes `comment.created`. Both surfaces already read that as
"re-read this card", which is the entire semantic content a second variant would
carry. A discriminated union that grows a case for every writer, rather than for
every distinct reaction, forces every consumer to handle a distinction that
changes nothing. Revisit if a surface ever needs to react to a note differently
from a comment.

### A11 — card-level comments have a reader, and threads are one level deep
*Round 3. The write shipped in round 2 with no read, so the front-end deleted
its client thread rather than ship a form letting a client write notes they
could never read back — the right call, and this is the fix.*

Card-level comments stay. PRD §7 cuts chat rooms; it does not cut discussion.
Version-threaded revision notes (A8) and card comments do different jobs: a note
is bound to a deliverable, a comment is about the card.

| Route | Response |
|---|---|
| `GET /api/comments?cardId=` | `{ comments: AgencyComment[], cardId }` — includes internal |
| `POST /api/comments` | `201 { comment: AgencyComment }` — body `{ engagementId, cardId, body, parentId?, internal? }`, `.strict()` |
| `GET /api/client/comments?cardId=` | `{ comments: ClientComment[], cardId }` |

`ClientComment` emits `side` and `authorName` and **no person identifier** — no
email, no user id, no contact id.

Both reads return one flat, **thread-ordered** list: roots oldest-first, each
root immediately followed by its own replies oldest-first. The ordering is part
of the contract, which is what makes a second request unnecessary. Threads are
one level deep *by construction*: `postComment()` rejects a parent on another
card, a parent that is itself a reply, and a client replying to an internal root.
Before that validation existed, `parent_id` was a bare self-reference and a reply
could be grafted onto another engagement entirely.

On the write: `engagementId` is carried per A5, and the card's *own* engagement
is then checked against it — the body names a subject for the authorisation
check, it does not state a fact to be trusted. `assertWritable` runs before
anything is written, because A9 was caused by exactly that check being skipped
and a fresh writer is where it gets skipped again.

**An internal comment publishes no `comment.created` event.** The client stream
filters a frame on whether the contact can see the *card*, not on whether the
comment is internal — and an internal comment's card usually is visible. The
frame carries no body, but its arrival is a signal, and "something was just said
about your card" is precisely the fact an internal thread exists to withhold.
Both streams ride one bus, so there is no way to tell the agency and not the
client. Giving the agency live internal comments would need an audience field on
`EventEnvelope`; that is a contract change and it has not been made.

**The orphan hazard, and why the client read self-joins.** Filtering
`internal = false` alone leaves a *public reply under an internal root*, carrying
a `parentId` the client can never resolve. That is a broken render and, worse, a
confirmation that a hidden comment exists — the precise thing INV-1 protects.
The client read therefore drops the whole internal thread, and a reply under an
internal root is forced internal at write. Two mechanisms, because the read
defends against rows the write did not create.

### A12 — agency sign-in uses Auth.js's own routes
*Round 3. `authConfig.pages.signIn` pointed at `/signin`, which did not exist,
so a signed-out agency member had no route into the product at all.*

No new endpoint was added: the catch-all at `/api/auth` already serves the flow.
Provider id is `resend`. The recommended call is the server-side `signIn` action
(`redirect: false`, so a `try/catch` cannot swallow Next's `NEXT_REDIRECT`); the
plain HTTP path is `GET /api/auth/csrf` then a form POST to
`/api/auth/signin/resend`. There is no password surface anywhere in this product
(ADR-005) and none is to be added.

Two fixes came with it. `pages.error` was unset, so an expired link landed on an
unstyled Auth.js page **outside the product**; it now points at `/signin`.
And `pendingOnboarding()` closes a redirect loop: a first-time user has no org,
so `getSession()` returns null — correct, but indistinguishable from signed-out,
which would have bounced them back to `/signin` forever. It grants no org, no
role, and nothing an agency route accepts; it only distinguishes the two nulls.


### A13 — templates
*Phase 7. The last unbuilt piece of v1, and a hard dependency for Phase 12.*

| Method | Path | Response |
|---|---|---|
| `GET` | `/api/templates` | `{ templates: TemplateSummary[] }`, newest first |
| `GET` | `/api/templates/:id` | `{ template: TemplateSummary, definition: TemplateDefinition }` |
| `POST` | `/api/templates` | `201 { template: TemplateSummary }` |
| `POST` | `/api/engagements` | now accepts `templateId?`; returns `stamped: { templateId, laneCount, cardCount } | null` |

`POST` accepts either `{ name, fromEngagementId }` — capturing a live board — or
`{ name, definition }`, which is the seam Phase 12's ingestion writes through.
Both together is 400; neither saves a named empty template. Another org's
template or engagement is 404, never 403, and no engagement row is written on
the way to that failure.

**`TemplateDefinition` is parsed on read as well as write.** `templates.definition`
is jsonb, and `row.definition as TemplateDefinition` is a cast rather than a
check. The parse is `.strict()` — unknown keys are **rejected, not stripped** —
because the key it exists to refuse is `state`, and a silently stripped `state`
is a definition whose author believes it worked. `version` is a literal rather
than a number, so a row written by a future shape fails loudly instead of being
read under v1 rules.

Rejection differs by caller, deliberately: the list omits an unparseable row and
logs its id, because failing the request would let one bad row hide every good
one, and a `laneCount: 0` would be a coercion wearing a number. Fetching that
same id throws — the caller asked for that template specifically.

**`applyTemplate(definition, ctx)` is pure**, taking its id factory, the
engagement's start date, and a clock as arguments. That is what makes "stamping
twice produces structurally identical graphs" a property provable by calling a
function twice, rather than a claim about two database writes.
