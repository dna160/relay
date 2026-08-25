# ADR-021 — Identity, tenancy, and the permission graph

**Status:** accepted — **supersedes ADR-005**, revises INV-6, adds INV-11 and INV-12
**Renumbered:** arrived as ADR-012 in the v1.1 package; that number was already taken by the derived client link token, so it is ADR-021 here. Nothing else changed.
**Date:** 2026-08-25

## Context

ADR-005 scoped client identity to exactly one engagement and stated there is
deliberately no cross-engagement client account. That was correct for a
single-agency v1 and is now wrong: an account must be able to hold membership in
several organizations and several concurrent projects, and freelancers must
operate without an organization of their own.

This is a migration on a shipped system, not a greenfield choice. The order of
work matters and is specified at the end.

## Decision

### 1. The account is the person. Membership is a graph.

```
account (a person, canonically identified by a verified email)
  ├── identity        (google | email — one row per auth provider)
  ├── org_membership  → organization   role: owner | admin | member
  └── project_membership → project     role: lead | contributor | reviewer
```

An `account` is never owned by an organization. Membership rows are the only
thing that grants access, and they are independent: **a project membership does
not require an org membership.** That single property is what lets a client-side
reviewer participate in a project inside your org while having no visibility
into the org itself, and it is the shape most permission systems get wrong by
deriving project access from org access.

### 2. Every account gets a personal organization at signup.

There is no orgless project. The freelancer case is an account whose only
organization is their personal one, which is invisible in the UI until they
invite someone into it. The alternative — a nullable `org_id` on projects — puts
a branch in every query, every permission check, every billing count, and every
purge sweep. One code path is worth the one extra row.

### 3. The auth vendor never owns the user id.

`accounts.id` is ours. Provider subjects live in `identities (provider,
provider_subject, account_id, email_verified)`. Swapping or adding an identity
provider is then a change to one table and never touches the permission graph.

**Provider: Auth.js v5 with Google OAuth and email magic link, sessions in
Postgres.** Rejected Firebase Auth: it puts identity in a different datastore
from the permission graph it must be joined against, requires a permanent
uid-to-account sync, cannot express multi-org membership anyway, and adds a
second vendor to the one path that must never be down. Enterprise SSO
(SAML/SCIM) for the Studio tier is genuinely painful to build — when that lands,
add WorkOS as another row in `identities` rather than as a replacement.

**Account linking rule:** a Google login auto-links to an existing account only
when the provider asserts `email_verified` for a matching address. Unverified
provider emails create a pending link that requires a magic-link confirmation.
Skipping this is a documented account-takeover path.

### 4. Two session kinds, two rules.

```ts
type Session =
  | { kind: 'account';  accountId: string; activeOrgId: string | null }
  | { kind: 'reviewer'; contactId: string; projectId: string };
```

`activeOrgId` is a UI convenience — the switcher. It is **never** an authority.
Every request re-resolves permission from the membership graph for the specific
object being touched.

Reviewer sessions are the zero-account path and stay scoped to one project.

### 5. Invites authenticate nobody.

Three token types, never conflated:

| Token | Lifetime | Purpose |
|---|---|---|
| Invite | 7 days, single-use | Identifies an offer of membership: (email, target, role) |
| Sign-in | 15 min, single-use | Proves control of an email address |
| Session | 30 days, rolling | Established only after a sign-in token or OAuth |

Clicking an invite link does **not** sign you in. It resolves the invitation and
then demands independent verification — Google sign-in or a sign-in code — for
the invited address. If the verified address does not match the invite, the
invite is not redeemable. Without this, a forwarded invite email is an account
takeover.

Token storage and handling:
- Only `sha256(token)` is persisted. Raw tokens exist in the email and nowhere else.
- Redemption is atomic: `UPDATE ... WHERE consumed_at IS NULL RETURNING`.
- **Sign-in uses a 6-digit code as the primary affordance, with the link as a
  convenience.** Corporate mail scanners (Outlook Safe Links, Proofpoint) prefetch
  URLs and will silently consume a one-time link before the human clicks it. If a
  link is offered it must land on a page that requires an explicit POST to consume.
- Responses never reveal whether an address has an account.
- Rate limited per address and per IP, with a constant-time response either way.

### 6. Permission resolution is one function.

```ts
resolveAccess(accountId, projectId): {
  role: 'lead' | 'contributor' | 'reviewer' | null;
  via: 'project' | 'org' | null;
}
```

Deny by default. Effective role is the stronger of the direct project membership
and any role derived from org membership. Nothing else computes permissions —
not a route handler, not a React component, not a query file.

## Consequences

- INV-6 is narrowed: *a reviewer session is scoped to exactly one project and
  cannot be widened.* Account sessions are governed by INV-11 instead.
- **INV-11 (new):** all access decisions come from `resolveAccess()`. A route or
  query that compares ids inline fails the invariant suite.
- **INV-12 (new):** an invite token never establishes a session. Membership is
  written only after independent verification of the invited address.
- The client export and purge paths must now walk memberships rather than a
  single engagement's contact list. INV-7 completeness tests need extending.
- Billing changes shape: the active-project limit is counted per organization,
  and an account belonging to five orgs consumes none of its own quota.
  `countActiveEngagements()` keeps its signature but takes an org id explicitly.

## Migration order

Run in this sequence. Each step ships independently and is reversible until the
one after it.

1. Add `accounts`, `identities`, `organizations`, `org_memberships`,
   `project_memberships`. Do not drop anything.
2. Backfill: one account per existing user, one personal org per account, one
   org membership per existing agency user, one project membership per existing
   assignment. Existing `client_contacts` stay as they are — they remain the
   reviewer path.
3. Introduce `resolveAccess()` and route every existing check through it while
   the old checks still run. Log every disagreement between old and new for a
   week. Do not proceed while disagreements are non-zero.
4. Remove the old checks. Unskip INV-11.
5. Add the org and project switcher UI, multi-org invites, and INV-12's invite
   flow.
6. Only then allow an account to be invited into a second organization.

Step 3 is the one people skip. It is the only step that tells you whether the new
graph agrees with the system you already shipped.
