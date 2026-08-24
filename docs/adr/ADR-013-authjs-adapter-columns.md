# ADR-013 — Auth.js adapter columns on `users`, and a nullable `org_id`

**Status:** accepted (Phase 1), **needs the architect's ratification** ·
**Relates to:** DATA-MODEL.md `users`

## Context

ARCHITECTURE.md picks Auth.js v5 with the email provider and
`@auth/drizzle-adapter`. The adapter is not optional here: the email provider
stores a one-time token through it, so there is no adapter-free configuration.

The adapter requires a `users` table with `emailVerified` and `image`, plus
`accounts`, `sessions`, and `verificationTokens` tables. DATA-MODEL.md's `users`
has neither column and none of those tables. It also implies `org_id` is
required, while the adapter's `createUser` inserts a row containing only
`{ id, email, emailVerified, name, image }` — an org the person has not chosen
yet.

## Decision

1. Add `email_verified timestamptz` and `image text` to `users`, both nullable.
2. Add `auth_accounts`, `auth_sessions`, `auth_verification_tokens`, named with
   the `auth_` prefix so it is obvious they belong to the framework and not to
   the domain.
3. Make `users.org_id` **nullable**, for exactly the window between Auth.js
   creating the row and the person joining or creating an agency.

`getSession()` refuses to build an agency session for a user whose `org_id` is
null. A null org is "not yet onboarded" and never "belongs to every org", so the
nullable column cannot widen anyone's access — it can only deny it.

`POST /api/onboarding/org` closes the window. It sets `org_id` under an
`org_id IS NULL` predicate, so a second call changes nothing rather than moving
someone between agencies.

## Consequences

- DATA-MODEL.md and the schema differ on `users`. This ADR is the record of why;
  the architecture layer should either fold these columns into DATA-MODEL.md or
  reject the adapter and specify a hand-written one.
- `auth_verification_tokens` is reused by the client magic link, which is why
  the client code flow needs no table of its own.
- The adapter's table types are written against `text` email columns and ours is
  `citext`. One `as unknown as` cast sits at that boundary in `src/lib/auth.ts`
  and nowhere else.
