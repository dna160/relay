# ADR-016 — Server events ride on Postgres LISTEN/NOTIFY

**Status:** accepted (Round 2, Phase 5 pulled forward) · **Relates to:** INV-1,
INV-6, API-CONTRACT amendment A1

## Context

`docs/API-CONTRACT.md` names an SSE stream carrying `card.transitioned`,
`version.published`, `decision.recorded`, `comment.created` and
`engagement.warned`, and amendment A1 split it in two: `GET /api/events?engagementId=`
for the agency and `GET /api/client/events`, which takes no parameter, for the
client.

Something has to get an event from the request that caused it to the browsers
that are watching. Three options were on the table:

1. an in-process `EventEmitter`;
2. Redis pub/sub, or a hosted equivalent;
3. Postgres `LISTEN`/`NOTIFY` on the connection we already have.

`railway.json` sets `numReplicas: 2` in production. An in-process emitter
delivers an event only to the browsers attached to the replica that happened to
serve the mutation — which is not a bug that shows up in development, where
there is one process, and not one that shows up in staging, where there is also
one process. It shows up on the day the second replica is added, as "the board
sometimes doesn't update", which is the worst possible shape for a defect.

Redis is correct and is a new dependency, a new service in the topology, a new
failure mode, and a new line on the bill, for a feature whose entire value is
that a board refreshes a few seconds sooner.

## Decision

Events travel on Postgres `LISTEN`/`NOTIFY`, channel `relay_events`.

- **Publishing** is `select pg_notify($1, $2)` executed on the caller's
  executor, so a publish inside a transaction is delivered when — and only when
  — that transaction commits. A rolled-back transition announces nothing, and
  we did not have to write that behaviour or get it wrong.
- **Subscribing** opens one dedicated `pg.Client` per app process, started on
  the first subscriber and closed after the last one leaves. It is deliberately
  not taken from the pool: a pooled client held open for the life of a browser
  tab never comes back, and the pool is sized for requests.
- **What travels** is an `EventEnvelope` — `{ engagementId, cardId, versionId,
  event }` — not a bare `ServerEvent`. The envelope carries the routing and
  authorisation facts and never leaves the server; each stream filters on it and
  emits only `envelope.event`. That is what lets the client stream ask "may this
  contact see this card?" without the answer having to be encoded in the public
  event shape, and it means `ServerEvent` in `src/lib/types.ts` needed no new
  field.
- **An event is a hint, never a value.** Both surfaces respond by re-reading the
  projection. Trusting a payload to patch local state is how two browsers end up
  disagreeing about a card's state.

## Consequences

- Correct at any replica count, with no new dependency and no new service.
- One extra database connection per app process, and only while at least one
  stream is open. `PGPOOL_MAX` is unaffected — the listener is outside the pool
  — but it is one more connection to count against Postgres `max_connections`,
  which the env registry row for `PGPOOL_MAX` in `docs/RUNBOOK.md` should say.
- NOTIFY payloads are capped at 8000 bytes by Postgres. `publishEvent()` refuses
  anything over 7500 and logs; today's envelopes are a few uuids.
- Publishing is best-effort and never throws. A dropped announcement costs a
  stale board until its next read; a dropped announcement that also 500s the
  transition that caused it would cost an approval.
- The client stream pays one small visibility query per event, reusing
  `loadClientVisibleCardId()` and `loadClientDownloadTarget()` rather than a
  stream-specific predicate. At human-paced event volumes that is the right
  trade, and it is what makes "the stream is not a side door" (amendment A1)
  true by construction rather than by review.
- `engagement.warned` has no publisher yet. The retention worker (Phase 6) owns
  it; the stream will carry it the day that worker calls `publishEvent()`.
