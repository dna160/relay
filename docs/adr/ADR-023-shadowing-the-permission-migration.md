# ADR-023 — Shadowing the permission migration

**Status:** accepted — implements ADR-021 steps 1–3 and ADR-022 D3
**Date:** 2026-08-25
**Phase:** 9. Nothing here changes user-visible behaviour.

## Context

ADR-021 replaces "an agency user sees every engagement in their org" with a
membership graph, and ADR-022 D3 decides that `owner` and `admin` derive project
access while `member` does not. Both are correct and neither is observable: the
system that is running has no `project_memberships` table to disagree with.

ADR-021's step 3 says to run both and log the differences for a week, and says
that step is the one people skip. This ADR records the four decisions that
implementing it forced, because each is a place where the cheaper option looks
identical from the outside and is not.

## Decision 1 — the backfill grants explicitly only where derivation does not reach

Under D3 an `owner` or `admin` reproduces v1's behaviour by derivation and needs
no rows. A `member` derives nothing, so every non-admin in every agency would
silently lose their board the day the old checks are deleted.

So the backfill writes `project_memberships` for members only, on every
non-purged engagement in their org, and writes nothing for admins.

**The rejected alternative was a row for everybody.** It is one line simpler and
it would have made the shadow harness agree trivially — every check satisfied by
a direct grant, the org-derived branch never exercised, seven clean days proving
only that the backfill ran. ADR-022 warns that D3 makes the org-derived branch
the tempting one to reason loosely about; a harness that never executes it is
that temptation with a green tick on it.

The consequence is that `openEngagement()` now writes the same rows for the same
population inside its own transaction (`grantOrgMembersOnCreate`). Without that,
the graph would fall behind the running product on the first engagement anyone
created, and the resulting disagreement count would look like a resolver bug and
be a coverage gap.

## Decision 2 — the harness returns the old answer, and there is no flag

`withShadow()` runs the shipped check, runs `resolveAccess()` beside it, records
any difference, and returns exactly what the shipped path returned — or rethrows
exactly what it threw.

There is no parameter that changes this and no variant that returns the new
answer. A wrapper with a "use the new result" flag is a wrapper someone flips
during an incident, and the whole value of the exercise is that the two systems
are compared without either being live twice.

The harness also cannot fail a request: every error inside it is swallowed and
logged. A harness that can 500 a route gets removed under pressure, which is
precisely when it is most needed.

**Reviewers are deliberately out of scope.** `resolveAccess()` answers for
accounts; a reviewer is a `client_contacts` row with no account, scoped to one
engagement by INV-6 as ADR-021 narrows it. There is nothing for the two paths to
disagree about, and stating that here makes the gap a decision rather than an
omission.

## Decision 3 — `access_shadow_disagreements` is content, and a purge takes it

The table records `project_id`, `account_id`, `legacy_user_id`, `legacy_org_id`
and a full copy of each decision input. That is a per-project record of who
tried to reach what.

Diagnostics feel exempt from a deletion promise. They are not. A table that
survives a purge holding the ids of a purged project is exactly the kind of
thing ADR-022's certificate should never have to explain, and ADR-022's own
argument is that a document which overclaims fails at the only moment it is
read. So the purge destroys these rows with the rest of the engagement's
content, and `TABLE_DISPOSITION` says so.

`project_memberships` goes the same way. `accounts`, `identities`,
`org_memberships`, `teams` and `team_members` do not — the person outlasts the
project (DELIVERY-PLAN §IV), and destroying an account would take with it every
other project that person is still working on.

Both deletes live in `src/domain/access/purge-project-access.ts` rather than in
the purge worker. INV-11's static scan forbids any file outside
`src/domain/access/` from naming a membership table, and it rejected the direct
version — correctly. A purge is not a permission decision, but the scan cannot
know that, and "the scan cannot know that" is a reason to move the code, not a
reason to widen the allowlist.

## Decision 4 — `countActiveEngagements()` takes the org id, with a dated shim

The plan limit is a property of the organization, not of the person: an account
in five orgs consumes none of its own quota (ADR-021). v1 had one org per person
so "the rows the caller loaded" and "one org's rows" were the same set, and the
distinction cost nothing. Under the graph, a mis-scoped query bills one tenant
for another's workspaces.

The canonical form is now:

```ts
countActiveEngagements(orgId, rows, now, windowDays?)
```

It filters to `orgId` itself. A caller that loads too much still gets the right
answer, which is the only kind of safety worth having in a billing path.

**The v1 positional form survives as a deprecated overload**, because the test
files that call it belong to another agent this round and a signature change
cannot land in two repositories at once. It counts exactly the rows it is given
— v1's behaviour, unchanged — and **throws** if those rows span more than one
organization, so it cannot become the silent cross-tenant count it is being
retired for. It is removed at ADR-021 step 4, alongside the old permission
checks. INV-8 is unaffected: one file, one loop, one predicate, one window.

## Consequences

- The old checks stay. They are deleted only after seven consecutive days at
  zero disagreements *and* seven days of the harness actually observing —
  `npm run access:shadow` reports both, and an empty table reports zero days
  live rather than a clean streak, because "never wired up" and "clean week"
  must not look the same.
- INV-11 stays skipped until that deletion.
- Measured: `resolveAccess()` p99 **1.02 ms** over 3,000 resolving calls against
  25,000 accounts / 5,000 orgs / 50,000 engagements / 275,000 project
  memberships. `EXPLAIN ANALYZE` shows index scans throughout, 13 shared buffer
  hits, no sequential scan. NFR is 5 ms.
- The backfill is idempotent and reversible, proved by running it twice and
  rolling it back: the second run writes zero rows, and an md5 census of all 26
  tables is byte-identical before the run and after the rollback.
