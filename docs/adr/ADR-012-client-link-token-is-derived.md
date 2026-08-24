# ADR-012 — The client link token is derived, not stored

**Status:** accepted (Phase 1) · **Supersedes:** nothing · **Relates to:** ADR-005, INV-6, INV-7

## Context

A client contact opens the workspace at `/e/<token>`. DATA-MODEL.md has no
`engagements.client_token` column, and the client link flow needs *something* in
the URL that names an engagement without being guessable. Engagement ids are
uuid v7, which carry a millisecond timestamp in their high bits and are
therefore partially predictable — not a secret.

## Decision

The token is `"<engagementId>.<HMAC-SHA256(CLIENT_LINK_SECRET, 'engagement:' + id)>"`,
computed on demand in `src/lib/auth.ts` and verified in constant time. Nothing
is persisted.

## Consequences

- There is no token column to leak in a database dump, to forget to rotate, or
  to leave behind after a purge — one fewer row for INV-7 to account for.
- Rotating `CLIENT_LINK_SECRET` invalidates every outstanding client link at
  once. `.env.example` already describes that as the intended blast radius.
- Per-engagement revocation is *not* available. Revoking one link means removing
  the contact, which is the coarser but honest action. If per-engagement
  revocation becomes a requirement, the fix is a `link_generation` integer on
  `engagements` folded into the HMAC input — additive, not a rewrite.
- The token names the engagement but grants nothing. Possession of it only lets
  someone request a code for an address that is already on the contact list, and
  the request endpoint answers identically for addresses that are not.
