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

`GET /api/events?engagementId=` streams:
`card.transitioned`, `version.published`, `decision.recorded`,
`comment.created`, `engagement.warned`. Client streams are filtered through the
same projection as REST — the stream is not a side door.
