# ADR-017 — Agency sign-in goes through Auth.js's own routes

**Status:** accepted (Round 3) · **Relates to:** ADR-005, ADR-013, INV-6

## Context

`authConfig.pages.signIn` has pointed at `/signin` since Phase 1 and `/signin`
did not exist. A signed-out agency member had no route into the product: every
agency page 401s, every redirect Auth.js issues lands on a 404, and the front
end correctly refused to link a button at it.

The question that had to be settled before either side could build was whether
Relay needs a sign-in *API* of its own, the way the client link does
(`POST /api/auth/client/request` and `/verify`, ADR-005 and ADR-012).

It does not, and the asymmetry is worth stating because it looks like an
inconsistency. The client flow needed custom routes because a client contact is
not an account: there is no user row, no session table, no adapter, and the
cookie names exactly one engagement (INV-6). None of that is true of an agency
member, who is an ordinary Auth.js user with an adapter, a `auth_sessions` row
and an email provider. Writing a second, hand-rolled email flow beside the one
the library already ships would mean owning token generation, single-use
semantics, expiry and CSRF ourselves, for a flow the library does correctly.

## Decision

Agency sign-in is Auth.js's, unmodified, mounted at the catch-all that already
exists: `src/app/api/auth/[...nextauth]/route.ts`, base path `/api/auth`. **No
new route was added.** The only change to the configuration is that
`pages.error` now points at `/signin`.

### What the front end calls

Two paths, both correct. Prefer the first.

**A — a Server Action (recommended).** `signIn` is exported from `@/lib/auth`.
Called server-side it runs with `skipCSRFCheck`, so there is no token to fetch
and no form field to remember:

```ts
'use server';
import { AuthError } from 'next-auth';
import { signIn } from '@/lib/auth';

// `redirect: false` matters twice: it returns the URL instead of throwing
// Next's NEXT_REDIRECT, so the try/catch below cannot swallow a redirect by
// accident, and it lets the page render its own "check your email" state.
await signIn('resend', { email, redirect: false, redirectTo: '/' });
```

Throws `AuthError` on failure — `EmailSignInError` when the provider refused to
send, `AccessDenied` when a `signIn` callback rejected. Catch `AuthError`
specifically and rethrow everything else.

**B — plain HTTP**, for a client component or a fetch-based form. Three steps,
same-origin, cookies included:

| # | Request | Response |
|---|---|---|
| 1 | `GET /api/auth/csrf` | `200 { "csrfToken": string }`, and sets the `authjs.csrf-token` cookie (`__Host-authjs.csrf-token` over https). Both halves are required — the body value alone will not verify. |
| 2 | `POST /api/auth/signin/resend`, `content-type: application/x-www-form-urlencoded`, body `csrfToken`, `email`, `callbackUrl` | `302` to `/api/auth/verify-request?provider=resend&type=email`, which redirects on to `/signin/check-email`. Send `X-Auth-Return-Redirect: 1` to get `200 { "url": "<absolute>" }` instead of a redirect. |
| 3 | nothing — the person clicks the emailed link | `GET /api/auth/callback/resend?...` sets the session cookie and 302s to `callbackUrl`. |

`resend` is the provider id, from the provider's own definition. A missing or
mismatched CSRF token is a `MissingCSRF` failure, which lands on `/signin`
with `?error=`.

Sign-out is `POST /api/auth/signout` with the same CSRF pair, or the exported
`signOut` server action.

### Where a failure lands

`pages.error` was unset and therefore defaulted to `/api/auth/error`, an
unstyled Auth.js page outside the product. That is where an expired or
already-used link put someone — the most common failure of a magic-link flow,
and the moment they most need a "send me another" button. It now points at
`/signin`, which is public, so there is no redirect loop.

The page receives `?error=` with one of `Verification` (link expired or already
used), `EmailSignInError`, `AccessDenied`, `Configuration`, or `MissingCSRF`.
Render `Verification` as "that link has expired — request a new one" and
everything else as one generic message. Never echo the raw code at a person.

### The three pages the front end owns

`/signin`, which must handle `?callbackUrl=` and `?error=`;
`/signin/check-email` (`pages.verifyRequest`); and the onboarding screen.

### Signed in and still not in

A first-time user has no org. `users.org_id` is nullable for exactly this
window (ADR-013), and `getSession()` returns `null` for them — correct, because
a null org must only ever deny. But *only* null is indistinguishable from
signed-out, and a surface that cannot tell them apart sends the person back to
`/signin`, where they sign in again and arrive in the same place.

`pendingOnboarding()` in `@/lib/auth` answers that one question and returns no
org, no role, and nothing an agency route would accept. Non-null means send
them to the onboarding screen, which posts `{ name, slug }` to
`POST /api/onboarding/org` and gets `201 { organization }`.

## Consequences

- No new dependency, no new route, no second email flow to keep correct.
- `AUTH_URL` must be set in every deployed environment. Auth.js derives
  `trustHost` from its presence, and behind Railway's proxy an absent
  `AUTH_URL` with no `AUTH_TRUST_HOST` is an `UntrustedHost` failure on the
  first sign-in attempt. It is already in `.env.example` and the env registry;
  this is the flow that makes it load-bearing rather than cosmetic.
- `RESEND_API_KEY` and `EMAIL_FROM` become load-bearing at the same moment. The
  provider falls back to the string `missing`, which sends nothing and surfaces
  as `EmailSignInError` on `/signin` — a legible failure rather than a hang.
- Anyone with an email address can create a user row. That is not a hole: a
  user with no org can reach nothing, and `POST /api/onboarding/org` is the
  only thing they can do. Plan limits are enforced per org (INV-8), not per
  signup.
