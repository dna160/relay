# PHASE 6 — Ephemerality

> The feature that makes the business model work, and the one where a bug
> destroys an account. Everything here is dry-runnable first.

## ENTRY
- Phases 1 and 3 exit verified. pg-boss running against the same Postgres.

## SCOPE
- Schema + migration: `purge_certificates`.
- Archive sweep: `last_activity_at + 30d -> status archived`, read-only.
  Any mutation on an archived engagement returns 423 `ENGAGEMENT_ARCHIVED`.
- Four warnings — at archive, +14d, +23d, +29d — to **both** sides. Every one
  carries the days-to-purge count and the client's free one-click export link.
- `POST /api/engagements/:id/export` and `GET /api/client/export`. The client
  export is never paywalled.
- Purge worker: destroys object bytes and content rows, writes exactly one
  certificate in the same transaction as the content deletion (INV-7).
- `npm run purge:plan` — prints the manifest, destroys nothing.
- Paid plans null out `archive_at` / `purge_at`. Downgrade recomputes them and
  warns immediately; a downgrade never purges silently.

## OUT
- Reactivation pricing. Open product decision (PRD 9) — build the reactivation
  path, leave the paywall behind a flag.
- Phase-two tombstone removal at +30d. Ship the tombstone; scheduling its
  deletion waits on the PRD 9 decision on certified destruction.

## EXIT
- INV-7 unskipped and passing, including the idempotency case.
- A purge killed at each of its steps and rerun yields exactly one certificate.
- No purge path can run without four warning rows already recorded.
- `purge:plan` leaves every row count and object count unchanged.

## INVARIANTS
Unskips **INV-7**. The purge worker is the one sanctioned exception to **INV-4**
and must be the only file that is.

## HANDOVER
Record: the manifest format, the certificate signature scheme, the resume points
in the purge job, and whether the PRD 9 tombstone decision has landed.
