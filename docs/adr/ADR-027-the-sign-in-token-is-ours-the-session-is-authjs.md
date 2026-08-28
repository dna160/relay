# ADR-027 — The sign-in token is ours; the session stays Auth.js's

**Status:** accepted — **narrows ADR-017**, implements ADR-021 §5, makes INV-12 real
**Date:** 2026-08-28
**Phase:** 10.

## Context

ADR-017 decided that agency sign-in goes through Auth.js's own routes,
unmodified, and the reasoning was good: the library does token generation,
single-use semantics, expiry and CSRF correctly, and a hand-rolled second email
flow would have to redo all four.

One of those four is wrong for this product, and PHASE-10's exit condition is
what makes it visible:

> A mail scanner that GETs the sign-in link twice before any human action leaves
> the token valid — only the explicit POST consumes it.

Auth.js's email callback is `GET /api/auth/callback/resend?token=…&email=…`,
and following it **consumes the token**. Outlook Safe Links, Proofpoint and
every other corporate link prescanner fetches URLs in inbound mail before a
human sees them. On any tenant running one, the token is spent before the
recipient opens the message and their own click lands on *this link has
expired*. ADR-021 §5 names this in as many words and says the link must land on
a page requiring an explicit POST.

That property cannot be arranged inside a flow whose consuming step is a GET.

## Decision

**Split the flow at the token/session seam.**

| | Owner | Where |
|---|---|---|
| The sign-in **token** | ours | `signin_tokens`, `src/domain/auth/signin.ts` |
| The **session** | Auth.js | `auth_sessions`, unchanged |
| The session **cookie** | Auth.js's name and rule | `accountSessionCookie()` |
| OAuth, CSRF, adapter | Auth.js | unchanged |

`POST /api/auth/signin/request` issues a six-digit code. `POST
/api/auth/signin/confirm` consumes it and writes an ordinary `auth_sessions`
row, so `auth()` and `getSession()` are untouched and there is still exactly
**one session shape** in the product. This is the same move
`src/app/api/test/session/route.ts` already makes for the e2e path, promoted to
a real flow.

Auth.js's own routes stay mounted and keep working. Nothing was removed.

### The link is a page, not a callback

The emailed link is `/signin/confirm?email=…&code=…`, a page with one button.
Fetching it renders HTML and consumes nothing. The API path exports only `POST`,
so a `GET` on it is a 405 from the framework rather than a branch inside a
handler that could later be relaxed.

**Measured, on a live server and a live database** (Phase 10 handover):

```
scanner GET #1 (the page):  404      ← page not built yet; still consumes nothing
scanner GET #2 (the page):  404
scanner GET #3 (the api):   405
token after three GETs:     attempts=0  still_valid=t
the human's POST:           {"needsOnboarding":true}
token after the POST:       attempts=1  still_valid=f
```

### The code is primary, the link is secondary

ADR-021 §5's ordering, and it survives the prescanner even where the link does
not: a code typed from an email cannot be spent by anything that reads the
email.

## Consequences

- **`RESEND_API_KEY` gains a second consumer** and no new configuration. The
  same `sendMail()` fallback applies: with no key, the code is logged.
- **Auth.js's `/api/auth/signin/resend` still exists** and still burns its token
  on a GET. It is the older path and both work; the front-end should prefer the
  code flow, and ADR-017's step 3 table is now the fallback rather than the
  route.
- **One more producer of a session.** `establishAccountSession()` refuses a
  `VerifiedAddress` older than sixty seconds, so a verification cannot be
  carried across requests, cached, or replayed into a session.
- **`accountSessionCookie()` restates Auth.js's naming rule** — `__Secure-`
  prefixed when `AUTH_URL` is https. Getting it wrong is a silent
  authentication failure, so it lives in one function rather than in a route.
  A real sign-in sets exactly one name; only the test route sets both.
- ADR-017's core claim is intact: there is no second *session* implementation,
  no credentials provider, and no second thing `getSession()` must understand.

## What this does not change

Google as a second provider is **not** in this phase. The account-linking rule
(ADR-021 §3 — an unverified provider email must not auto-link to an existing
account) is nonetheless already structural rather than pending: every function
that can turn an address into an account or a membership takes a
`VerifiedAddress`, and the only two things that produce one are
`consumeSignin()` and `verifiedAddressFrom(email, emailVerifiedAt)`, which
returns `null` for a null timestamp. A provider asserting an unverified address
cannot construct the argument, so it cannot reach the linking path.
