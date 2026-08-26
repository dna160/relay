# ADR-025 — The SQL spelling of "running" is derived, not written

**Status:** accepted — closes DEFECT-16, tightens ADR-008 / INV-8
**Date:** 2026-08-26
**Phase:** 7 follow-up. No behaviour changes.

## Context

`src/db/queries/attention.ts` carried three hand-written
`engagements.status = 'active'` predicates for six phases. INV-8's scans read
`src/domain` only — one eighth of the tree — so the invariant that exists to
guarantee one definition of "active" could not see the layer where a second one
is most likely to be written. QA widened the scan to all of `src/` and the
predicates surfaced.

The interesting part is that **the behaviour was right and the spelling was
wrong**. What `attention.ts` means is `isRunning()` — "not archived, not
purged" — and it is correct to mean that. Scoping an attention list to PRD
§5.6's *active*, which also requires activity inside the 30-day window, would
hide the engagement nobody has touched in six weeks: the one the list exists to
surface. Two correct behaviours, one of them spelled twice, is exactly the drift
ADR-008 predicts.

## The option that does not work here

`src/db/queries/retention.ts` is the worked example the invariant points at: it
loads a deliberately *wider* set (`status <> 'purged'`) and asks `isRunning()`
in JavaScript. That is the right answer wherever the wider set is small.

It is the wrong answer for the attention list. That filter rides a join over
every unfinished card in the organisation, and widening it means reading every
archived engagement's finished cards in order to discard them. The join in that
file exists because the previous `IN`-list shape shipped 4,320 bound parameters
against a 120-engagement agency and was on a path to `pg`'s hard ceiling of
65,535 — trading that back for a JavaScript filter would undo a fix for a bug
that stopped the home screen rendering.

A SQL filter fundamentally cannot call `isRunning()`: the predicate takes a row
that has already been loaded, and the point of a `WHERE` is not to load it.

## Decision

`count-active.ts` — still the sole definition — now exports the predicate's
*admitted values*, obtained by running the predicate over the status enum:

```ts
export function isRunningStatus(status: EngagementStatus): boolean {
  return status === 'active';
}
export function isRunning(row: ActivityRow): boolean {
  return isRunningStatus(row.status);
}
export const RUNNING_STATUSES: readonly EngagementStatus[] =
  ENGAGEMENT_STATUSES.filter(isRunningStatus);
```

`attention.ts` builds one module-level predicate from it —
`inArray(engagements.status, [...RUNNING_STATUSES])` — and reuses it across all
three reads. Three hand-written predicates became zero; the file now names no
engagement status at all.

**This is not a second spelling kept in step by discipline.** `RUNNING_STATUSES`
has no independent existence: it is this file's own function evaluated over the
enum at module load. If "running" ever means two statuses, `isRunningStatus`
changes and the array changes with it, because there is nothing else to change.

The one cost is an import of `ENGAGEMENT_STATUSES` from `@/db/schema/enums` into
a file whose header advertises purity. It is a frozen array of strings — no
table, no connection, nothing a unit test has to stand a database up for — and
`@/db/schema` is not among INV-9's forbidden domain imports.

## Consequences

- **The sanctioned exclusion can be deleted.** With
  `SANCTIONED_SQL_PREDICATE` emptied, INV-8's widened scan passes across all of
  `src/`. Verified by running the scan's own regexes with the exclusion removed.
  The exclusion becomes a decision by ceasing to exist, which is the strongest
  form of the coordinator's request.
- The reachability test that paid for the exclusion — "whatever `attention.ts`
  means by active may never become the number the plan limit is checked against"
  — is still worth keeping on its own terms, now as a property of the query
  layer generally rather than as rent on one file.
- Behaviour is unchanged, checked against a live database with one engagement in
  each of the four statuses: the attention list and the badge count return the
  running one and nothing else, before and after.
- `attention.ts`'s header said "active" where it meant "running". It now says
  `isRunning()`, says why it is deliberately not `isEngagementActive()`, and
  says why it does not use retention.ts's widen-then-filter shape — so the next
  person to read it inherits the decision rather than the tolerance.
