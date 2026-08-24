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
`/api/templates` (Phase 7) · `/api/engagements/:id/export`, `/api/client/export`
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
