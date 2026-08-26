# ADR-026 — Removal is archive, with a narrow discard

**Status:** accepted, 2026-08-26
**Context:** product-owner feedback, round 9 — "there is no way to delete a lane
or a card"
**Touches:** INV-2, INV-3, INV-4, INV-5, INV-7. Supersedes nothing.

## The complaint, and why "add DELETE" is the wrong reflex

There are no `DELETE` routes for lanes or cards. That is a real gap — a typo'd
card is permanent, a mis-dragged column is permanent, and the board accumulates
debris nobody can clear.

It is also the one gap in this product where the obvious fix is the dangerous
one. From the committed migrations:

```
approvals.asset_version_id  ON DELETE cascade
asset_versions.card_id      ON DELETE cascade
cards.lane_id               ON DELETE cascade
comments.card_id            ON DELETE cascade
state_transitions.card_id   ON DELETE cascade
```

So `DELETE FROM cards WHERE id = $1` destroys, without naming any of them: the
immutable versions INV-4 says are append-only and deletable only by the purge
worker; the approvals INV-3 says bind one version and its sha256 *so that
"approved" survives a dispute six months later*; and the possession ledger INV-5
says is the sole source of the clock. `DELETE FROM lanes` does all of that for
every card standing in the column.

INV-7 gives the product exactly one path that may destroy an engagement's
content, and that path ends in a `purge_certificate` handed to both parties. A
delete button is not that path, and a feature that quietly becomes a second one
would make the certificate a document about a subset.

## Decision

**Removal is `archived_at`, a nullable timestamp on `lanes` and on `cards`.**
Setting it takes the thing off the board. Everything it carries stays.

**Discard — a real `DELETE` — is permitted in exactly one case: when the cascade
has nothing to cascade to.** A card with no versions, no state transitions and
no comments. Not "a card that looks unimportant": the literal statement that
deleting this row destroys no other row.

**The caller does not choose between them.** `DELETE /api/cards/:id` takes the
least destructive mechanism that satisfies the request and reports which one it
used. `DELETE /api/lanes/:id` likewise.

## The questions this had to answer

### Is a card with no versions and no approvals different from one with them?

Yes, and the distinction is the whole design. It is the only line that can be
drawn *mechanically* rather than by judgement, and mechanical is what this has
to be — a person clicking "remove" cannot be expected to know whether this
particular card has an approval bound to a sha256 behind it, and asking them is
how the wrong answer gets clicked.

Approvals and revision notes are not counted directly. Both hang off
`asset_versions`, so a card with no versions has neither. Counting them as well
would imply there is a case where a version exists and its approvals are the
deciding fact; there is not.

### Should a card the client has seen be removable, and does approval change it?

It should be removable — scope changes, and a deliverable that was cancelled has
to be able to leave the board. It should never be *deleted*, and approval does
not change that answer because approval is not the thing being protected. The
evidence is.

"Has the client seen it" is answered without a new column. A card that has never
left `draft` has never been visible to a client — the client scope excludes
`draft`, INV-2 says a card leaves `draft` only through the state machine, and
INV-5 says every transition writes a `state_transitions` row. **Zero transitions
is therefore a sound proof of never-seen**, derived from a ledger that already
exists rather than from a `seen_by_client_at` that something would have to
remember to write. The converse is not claimed and is not needed: a card that
has moved *might* have been seen, and "might" requires archiving.

**The soundness comes from two invariants holding together, and from neither of
them alone.** INV-2 closes the door — a card leaves `draft` only through the
state machine, so there is no other way for its state to move. INV-5 makes the
door leave a mark — every transition the machine performs writes a
`state_transitions` row. Either one on its own proves nothing here: INV-2
without INV-5 means the card moved and left no trace to count, and INV-5 without
INV-2 means something else could have moved it silently. Together they make the
absence of a row a *fact about the card's whole history*, which is a fact nobody
had to store. It is worth naming as a pattern: the guardrails in this codebase
are not only constraints, they are a source of derivable truth, and a new column
that duplicates one is a second thing that can disagree with it.

### Does deleting a lane delete its cards, refuse, or move them?

None of the three, quite.

Cascade-delete is out on the argument above — it is the most destructive
statement in the schema. Move-on-delete requires choosing a destination the
product cannot choose (which lane? what position? what if it is the only one?).
Refuse-while-occupied is honest but makes the common case — "this column was a
mistake, and it has cards in it" — a chore with no ending.

So: **a lane holding no cards is discarded; a lane holding any card is archived,
and its cards go with it.** Archiving a lane touches no card row at all. It is
the same shape `visibility = 'private'` already has, where the lane is the thing
that decides and the cards underneath are untouched — which is what makes
restore exact: the cards come back where they were, in the order they were,
because nothing about them ever moved.

**"Holding no cards" counts archived cards.** A lane whose only occupant is an
archived card looks empty on the board and is not empty in the table, and
deleting it would cascade straight through that card into its versions and
approvals. This is the one place the archive could have opened a new hole and it
is closed explicitly:

> **Emptiness is asked of the table, never of the board.**

That sentence is the whole guard, and the bug it prevents is the worst class
this feature could have shipped: silent data loss, on the evidence, triggered by
a user doing something reasonable to a column that *looked* empty because the
feature in the same commit had made it look that way. Archiving is what creates
the discrepancy between the two notions of empty, so archiving is what has to
answer for it. `removeLane()` counts `cards` by `lane_id` with no
`archived_at` predicate at all — the absence of that predicate is load-bearing,
and it is the kind of absence a later "tidy-up" would add without knowing.

### Is removal part of the state machine?

No, and this is the load-bearing structural decision.

ADR-003 says the board is a rendering of an approval state machine. `archived`
is not a position in that machine. An archived card that was `awaiting_client`
is still awaiting the client if it comes back; the fact of removal is orthogonal
to where the work had got to. Making it a `card_state` would mean:

- an edge from every state to `archived` and back — a machine with a trapdoor
  from everywhere is not a machine, it is a flag with ceremony;
- a second answer to "what possession does this carry", with `signed_off`'s
  ambiguity but reversible;
- `ClientCard['state']` — currently `Exclude<CardState, 'draft' | 'internal_review'>`
  — silently widening to include it;
- and a second writer of `cards.state`, or a state-machine change, either of
  which puts INV-2 in play for an operation that has nothing to do with
  approval.

A nullable timestamp keeps `cards.state` untouched. `src/domain/board/removal.ts`
does not name `state` in a write position anywhere, so INV-2 is not merely
respected — it is structurally out of scope.

## What this must never become, and why it cannot

- **It must not destroy an `asset_version` or an `approval` outside the purge
  worker** (INV-4, INV-7). It refuses to delete anything that would: the
  dependent count and the delete run in one transaction with `FOR UPDATE` on
  the row, so a version landing concurrently cannot be destroyed by a delete
  authorised against a card that did not have it yet.
- **It must not become a second writer of `cards.state`** (INV-2). It writes
  `archived_at`, `archived_by_user_id` and `updated_at`, and nothing else.
- **It must not hide anything from the purge.** Archived rows are ordinary
  content rows; `src/workers/purge.ts` enumerates by engagement id and by
  storage prefix and has no idea this column exists. A row invisible to the UI
  *and* to the purge would make INV-7's certificate a lie, which is the failure
  mode `tests/invariants/removal-preserves-evidence.spec.ts` asserts from both
  ends.

## Costs accepted

**A card the client approved can vanish from their board.** No notice, no
tombstone. That is the intended behaviour — "this deliverable is out of scope
now" is a normal thing for an agency to do — and the mitigations are real: the
approval row is untouched, the export bundle is built from `asset_versions` and
still contains it, and the audit log carries `card.archived` with the actor and
the counts. If the product later wants the client to see *that* something was
withdrawn, that is a projection change, not a schema change.

**A discard is unrecoverable and there is deliberately no undo route for it.**
`DELETE` reports which of the two happened so the surface knows whether to offer
one. What a missing undo costs is bounded by the discard rule itself: a title
someone can retype.

**Every table that gains a foreign key to `cards` must be added to
`cardDependents()`.** That is the one maintenance obligation this design
creates. It is stated on the function rather than left to be discovered by a
cascade in production, and QA derives the forbidden set from the migrations
rather than from a list, so a new cascade widens the guard on its own.

## Also decided here — the presign failure shape

Filed in the same round and resolved by the same principle: *a failure should
name the state it is in.*

Uploads on staging failed with **"Could not reach the workspace — the connection
dropped or the service is restarting. Try again in a moment."** The actual cause
was that `S3_ENDPOINT`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` were unset,
so presign could not work at all. Every clause of that sentence was false, and
the advice it gave — retry — was advice to repeat something that could never
succeed. The route threw a bare `Error`, `toErrorResponse` turned it into a 500
with no code, and the agency surface's `default` branch supplied the words.

Two conditions, two answers, both 503:

| | Meaning | Presign | `/api/health` |
|---|---|---|---|
| `STORAGE_NOT_CONFIGURED` | No `S3_*` on this deployment. Cannot ever work. | 503, "needs an administrator" | `storage: "unconfigured"`, **503** |
| `STORAGE_UNREACHABLE` | Configured; the bucket did not answer. | 503, "try again in a moment" | `storage: "unreachable"`, 200 |

Neither body names a variable, a bucket, an endpoint or an SDK error. The
operator's half goes to the server log.

`/api/health` now probes storage because the old rule — *"the health check must
not touch R2"* — was too wide by one case. A third-party blip still never takes
the app out of rotation (`unreachable` is 200); a deployment that structurally
cannot sign an upload never enters it (`unconfigured` is 503). RUNBOOK §7 carries
the full split and, for the first time, a written list of what health does
**not** probe.

Both codes are in `ERROR_CODES` and are raised through the ordinary `apiError()`
path. They were briefly emitted through an escape hatch while `src/lib/types.ts`
caught up; that hatch was deleted in the same round rather than carried, because
a documented pressure valve with two entries in it is how a third arrives.

## Also decided here — assignability follows from membership

`assigneeId` has been accepted by `POST /api/cards` and `PATCH /api/cards/:id`
since Phase 2 and nothing enumerated the candidates, so no picker could exist.

`GET /api/engagements/:id/members` ships the read. Phase 9 changed what "who"
means, and the definition of record is `listAssignableAccounts()` in
`src/domain/access/` — it reads the membership graph and runs the same
`resolveAccessFrom()` arithmetic `resolveAccess()` does, so the list cannot
contain somebody the resolver would deny. It lives in the access domain because
INV-11 says only that directory may read a membership table, and because the
alternative — a query elsewhere that selects the org's users and calls it "the
team" — is precisely the second notion of project belonging that INV-11 exists
to prevent. `reviewer` is excluded: a reviewer is the client-side person, and a
deliverable is requested *of* the agency, not assigned to the party waiting for
it.

What the route **returns** during Phase 9's shadow window is the shipped answer,
`listAssignableUsers()`, which shares its predicate with the write path's own
`assertAssigneeInOrg()` — because a picker wider than the check offers people
the write path 404s on, and one narrower hides colleagues, and neither fails
loudly. The graph's answer is computed on every request and compared, one ledger
row per person the two disagree about, under a new `assignable_set_differs`
reason (ADR-023).

Returning the graph's answer today would go further than any other endpoint in
the product does, and it would fail visibly: on a deployment whose backfill has
not run, the membership tables are empty, every picker renders nobody, and the
write path goes on accepting the ids the picker no longer offers. When the
streak reaches seven days and ADR-021 step 4 deletes the old checks, the route
drops the legacy read and returns the graph's list — including the `role` and
`via` it already computes, which are absent from the response today because a
role attached to a list the graph did not produce would be a fact about nothing.

**`reviewer` is excluded from the picker, and the write path does not know
that.** It does not need to today: a reviewer is a `client_contacts` row, which
`assertAssigneeInOrg()` 404s and which `cards.assignee_id REFERENCES users(id)`
would reject anyway, and no account holds project role `reviewer` until Phase 10
issues them. The obligation lands on ADR-021 **step 4**: the graph-based check
that replaces `assertAssigneeInOrg()` must ask `canHoldAssignment()`, not merely
"does this account have access", or the picker will exclude somebody the check
accepts.

Between now and then the divergence is **observable rather than assumed** — an
account the shipped list includes and the graph excludes is a
`assignable_set_differs` row with `side: 'shipped'`, recorded per request in
production. That is the same property the harness gives every permission check,
arriving on a read path nobody designed it to cover.
