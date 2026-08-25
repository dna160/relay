# PHASE 10 — Auth and invites

## ENTRY
Phase 9 complete: the old permission path deleted after seven consecutive days at zero shadow-harness disagreements, INV-11 unskipped. ADR-021 §identity read in full.

## SCOPE
Google as a second identity provider, joining email codes — `identities` carries one row per provider, `accounts.id` stays ours (ADR-021), so adding SAML later touches one table. Code-first sign-in: the six-digit field is primary and focused on load, `autocomplete="one-time-code"`, paste-friendly; the emailed link is secondary and lands on a page with a single confirm button. The token service: `issueSignin` / `consumeSignin` (atomic, attempt-limited, constant-time) / `issueInvite` / `resolveInvite` / `redeemInvite`. Invite redemption UI showing who invited you, to what, in what role, before asking for anything. `signin_tokens` and `invites` tables.

## OUT
The org switcher and teams UI — Phase 11. Ingestion — Phase 12. Do not let an invite widen a session; that is the whole point of the phase.

## EXIT
INV-12 unskipped: redeeming an invite without a verified session yields no membership and no session cookie, and redeeming with a mismatched verified address fails. A mail scanner that GETs the sign-in link twice before any human action leaves the token valid — only the explicit POST consumes it. Response time and body are indistinguishable for a known and an unknown address. An unverified provider email does not auto-link to an existing account.

## INVARIANTS
INV-12. Holds INV-11 — every new route resolves access rather than reading a membership row.

## HANDOVER
Record the exact conditions under which `redeemInvite` refuses, and confirm no code path produces membership from a token alone. If you added a provider, say what happens when its email is unverified.
