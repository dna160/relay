# PHASE 4 — Client surface

> This is the acquisition surface and the client is not motivated. It has to be
> fast, obvious, and free of agency chrome.

## ENTRY
- Phases 2 and 3 exit verified. INV-1, 3, 4, 10 green.

## SCOPE
- `src/app/(client)/e/[token]/` — magic link landing, email verify, published
  board, decision queue, version stack, `DecisionBar`, comments, free export.
- `GET /api/client/board`, `/queue`, `POST /client/versions/:id/decision`,
  `/client/comments`, `GET /client/export`, `GET /client/download/:versionId`
  (302 to a presigned GET).
- Every client route takes the engagement from the session. A client route with
  an `engagementId` parameter is a bug (API-CONTRACT).
- `NOT_VISIBLE` returns 404, never 403 — a 403 confirms the object exists.
- No agency component in this bundle. Verify by inspecting the built chunk.

## OUT
- Possession display. Internal-only in v1 (PRD 9). Do not surface it here.
- Anything on the agency side.

## EXIT
- A Playwright run completes invite -> verify -> approve without ever touching
  an agency route.
- INV-1 extended with a case for every new client query added in this phase.
- Client board FCP under 1.5s on a throttled 4G profile.
- The client bundle contains no agency route code.

## INVARIANTS
Extends **INV-1** to the full client read surface. Holds **INV-6** and **INV-10**.

## HANDOVER
Record: the token format, the verify flow's rate limits, and every query added
to `clientScope()`.
