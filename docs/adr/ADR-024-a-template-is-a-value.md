# ADR-024 — A template is a value, not a saved board

**Status:** accepted — implements PHASE-7's stamping half
**Date:** 2026-08-26
**Phase:** 7. Hard dependency of Phase 12 (INV-13).

## Context

Templates are v1 for a structural reason, not a convenience one: disposable
workspaces only work if creating one is nearly free (PRD §5.7). Without them,
ephemerality is a tax, an agency pays it by keeping one long-lived workspace,
and that breaks billing, purge, and isolation together — the three things Phase
6 spent five SIGKILLs hardening.

The shape of `TemplateDefinition` was fixed in `src/lib/types.ts` before this
phase started, and it has no ids, no `state`, and no absolute dates. This ADR
records the four decisions that implementing it forced, and one schema change
that had no obvious home.

## Decision 1 — `applyTemplate()` takes its clock and its id factory as arguments

```ts
applyTemplate(definition, { engagementId, startedAt, now, newId }): StampedGraph
```

Three injections: the id factory, the origin the relative dates resolve against,
and the row-timestamp clock. Nothing else about the function is
non-deterministic, so with those outside it, the phase's exit condition —
*stamping a template twice produces structurally identical graphs* — is a
property you assert by calling the function twice with counters.

**The rejected alternative was a function that stamps.** It would have called
`uuidv7()` and `new Date()` itself and taken an `Executor`, which reads as one
fewer moving part. It makes the exit condition a claim about a transaction
instead of a property of a function, and the test that checks it becomes a test
that two database writes agree — which is a slower, flakier way of proving
something weaker.

The I/O lives in `stampTemplate()` (`src/domain/template/stamp.ts`), which makes
no decisions and inserts what it is handed.

## Decision 2 — the definition is a *value*, never a row it has to come from

`applyTemplate()` mentions `templates` nowhere. `openEngagement()` takes
`template: { id: string | null; definition: TemplateDefinition }` — an id that
is allowed to be null beside a definition that is not.

That nullable id is the entire Phase 12 seam. INV-13 says ingestion never writes
a project graph: extraction emits a definition, a human confirms it, and only
`applyTemplate()` creates lanes and cards. A definition that has been confirmed
but not saved has no `templates` row, so a create path that took a `templateId`
could not be handed one, and ingestion would have needed a second creation path
— which is the exact thing INV-13 exists to prevent.

It also means the route resolves the template, not the domain function, matching
every other route in the tree (INV-9) and keeping `src/domain/` free of imports
from `src/db/queries/`.

## Decision 3 — the parse runs on read as well as on write, and rejects

`templates.definition` is jsonb. `row.definition as TemplateDefinition` is a
cast, not a check, and the column will hand back rows written by a build with
different rules. So there is one parser, `parseTemplateDefinition()`, and both
directions go through it.

Two properties of it are load-bearing:

- **`.strict()`, so unknown keys are rejected rather than stripped.** zod's
  default is to strip, and the key this exists to refuse is `state`. A stripped
  `state` is a definition whose author believes it worked; a rejected one is a
  400 that names the field. `cards.state` has exactly one writer (INV-2) and a
  template must not become a second.
- **`version` is `z.literal(1)`, not `z.number()`.** A stored row from a future
  shape fails loudly instead of being read by v1 rules and stamped into a board
  that is wrong in ways nothing tests. When a v2 exists this becomes a
  discriminated union and v1 rows keep parsing, which is the only reason the
  field is in the persisted shape.

On the list endpoint an unparseable row is **omitted, with its id logged**.
Failing the whole request lets one bad row hide every good one; returning it as
`laneCount: 0` is a coercion wearing a number. Loading that same template by id
still throws — at that point the caller asked for that specific template, and a
silent substitute is the worst answer available.

## Decision 4 — "save as template" clamps two things and flattens one

`deriveTemplateDefinition()` is the inverse of `applyTemplate()` and is also
pure. `dueAfterDays = round((dueAt − startedAt) / 24h)`, which is timezone-free
and exactly reversible, and:

- **A due date before the start becomes day 0.** "Days after the start" has no
  room for a negative, and a template that stamped an already-overdue card would
  put every new workspace into breach on creation.
- **A due date past the ten-year cap becomes null.** A save that produces a row
  the reader rejects is worse than a save that drops one date.
- **`contractedRounds` flattens once.** derive → apply → derive is a fixed point
  from the *second* derivation, not the first: a card that stated no rounds
  inherits `contractedRoundsDefault` at stamp time and thereafter states it. No
  attempt is made to re-null a card whose count equals the default — a card
  deliberately set to two and a card that inherited two are the same row, and
  guessing would silently re-point it at the next template's default. The board
  is identical either way.

What derive drops it drops **structurally**: `TemplateCard` has four fields, so
there is nowhere to put a state, an assignee, an effort estimate, or an internal
note. That last one matters more than it looks — a template is a thing that gets
re-stamped for the next client, and internal notes about the previous one riding
along is a leak nobody would have written a test for.

## Decision 5 — stamped shelf groups live on the engagement

`engagements.shelf_group_labels text[] NOT NULL DEFAULT '{}'` (migration 0006,
which is additive and changes no existing column — `templates` itself is
unchanged since 0000 apart from an org-first index).

A shelf group is a label on a file, not an entity — DATA-MODEL is explicit that
the shelf has "no versioning, no approval, no tree", and `loadShelf()` groups a
flat list by `group_label`. So a group with *no files in it* cannot exist, and
an empty labelled group is precisely what stamping one produces.

Storing the labels on the engagement keeps the shelf's shape unchanged: still no
group entity, still no group id to rename or leave dangling. `loadShelf()` seeds
the map with them before it groups the files, so a stamped group is a heading
with nothing under it — which the shelf page already renders.

**The rejected alternative was reading them back through `engagements.template_id`.**
It needs no column. It also loses the groups for any engagement whose definition
came from a document rather than a saved template (Decision 2), and it makes
renaming a template silently rename the shelves of every workspace it ever
stamped.

## Consequences

- Stamping is inside `openEngagement()`'s transaction, under the plan gate's
  existing row lock on the organisation. A half-stamped board is worse than a
  failed create, and a failed stamp cannot consume a plan slot on its way out.
- Definition size is capped (50 lanes, 500 cards, 50 shelf groups) because the
  size of a definition is the size of that transaction and a definition is
  user-supplied. Lane and card name lengths match the `POST /api/lanes` and
  `POST /api/cards` schemas exactly: a template must not be a way to write a
  name those routes would have rejected.
- The plan gate is untouched. `countActiveEngagements(orgId, rows, now)` remains
  the one counter and `PLAN_LIMITS` the one limits table (INV-8); nothing in
  this phase added a second predicate for "active".
- Nothing here can reach a theme token. A definition carries lanes, cards,
  rounds, and shelf labels — there is no colour in the shape, so the white-label
  clamp in `globals.css` gains no new path around it.

## Endpoint shapes

```
GET  /api/templates      -> 200 { templates: TemplateSummary[] }
GET  /api/templates/:id  -> 200 { template: TemplateSummary, definition: TemplateDefinition }
POST /api/templates      -> 201 { template: TemplateSummary }
POST /api/engagements { templateId? } -> 201 { engagement, plan, stamped }
```

`TemplateSummary` is exactly the `src/lib/types.ts` shape — `id`, `name`,
`createdAt`, `laneCount`, `cardCount`. Nothing is added on top of it and the
`templates` table gained no columns of its own this phase; a redeclared summary
inside the API seam is how a surface ends up reading a field the route never
sends, typechecking, and printing `Invalid Date`.

The two reads answer different questions and that is why there are two. The
summary's counts answer *how big*, so the picker does not have to fetch a
definition to render a row. `GET /api/templates/:id` answers *what* — lane
names, which are private, and the deliverables under each — because a workspace
that consumes a plan slot should not arrive as a surprise. Both count from the
same parsed definition, so header and body cannot disagree.

`POST /api/templates` accepts `{ name, fromEngagementId }` — "save this board" —
or `{ name, definition }`, the explicit form a future editor and Phase 12 will
post. Both together is a 400; neither saves an empty named template. Another
organisation's engagement or template is a 404, never a 403. A stored definition
this build cannot parse is a 400 on the detail read and an omission with a
logged id on the list.

`stamped` is `{ templateId, laneCount, cardCount } | null`. It is reported
rather than left for the board to reveal, because a create that named a template
and stamped nothing is otherwise indistinguishable from a board that failed to
load.
