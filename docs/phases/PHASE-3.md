# PHASE 3 — Assets, versions, approvals

## ENTRY
- Phase 2 exit verified. INV-1, 2, 5, 9 green.
- S3-compatible credentials present in `.env` (MinIO is acceptable locally).

## SCOPE
- Schema + migration: `asset_versions`, `approvals`, `revision_notes`,
  `comments`, `reference_files`. Both CHECK constraints on `approvals`.
- `POST /api/uploads/presign` — presigned PUT, multipart above 100 MB, to 5 GB.
  No byte ever touches the app server (INV-10).
- `POST /api/versions` — records metadata and the client-computed sha256 after a
  completed upload, allocating `version_no` inside the transaction.
- The internal gate: `POST /api/cards/:id/publish` sets `published_to_client_at`
  and transitions `internal_review -> awaiting_client` through the state machine.
- `domain/approval/record-decision.ts` — copies `asset_versions.sha256` into
  `approvals.version_sha256` at decision time (INV-3). `changes_requested`
  requires a note. Increments `rounds_used` on the awaiting_client -> changes
  cycle, per `transition()`'s `incrementsRound`.
- Revision notes thread to a version and never float forward.

## OUT
- The client-facing decision UI. Phase 4 — this phase ships the endpoint.
- Purge deletion of these rows. Phase 6.

## EXIT
- INV-3, INV-4, INV-10 unskipped and passing.
- An upload of a 200 MB fixture completes without the app process RSS moving.
- A decision recorded, then the version row re-read: stored hash still matches.
- `changes_requested` with no note returns 400 and writes nothing.

## INVARIANTS
Unskips **INV-3**, **INV-4**. Strengthens **INV-10** with a real presign path.

## HANDOVER
Record: where sha256 is computed, the multipart threshold, and the exact list of
columns on `asset_versions` that are permitted to be updated after insert.
