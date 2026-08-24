/**
 * Reading card-level discussion, both sides.
 *
 * `comments` is the chat surface's replacement (ADR-011, PRD §7: "Discussion
 * attaches to cards and versions"). It shipped in round 1 with a writer —
 * `POST /api/client/comments` — and no reader at all, so the front end had a
 * form that posted into a table nobody could read back and correctly refused to
 * ship it. This is the missing half.
 *
 * A comment is *about a card*. A revision note (`revision-notes.ts`) is bound
 * to one immutable version and is what an approval argument is made of. Both
 * are intended and they are not interchangeable, which is why they are two
 * tables, two routes and two files rather than one generalised "thread".
 *
 * ## How the client read is scoped
 *
 * Nothing in this file takes a `ClientScope`, for the same reason nothing in
 * `revision-notes.ts` does. A client comment read is two questions — "may this
 * contact see this card?" and "what is on it?" — and the first already has an
 * answer: `loadClientVisibleCardId()` in `client-board.ts`, which resolves a
 * card id through the board's own visible-card and published-lane predicates
 * and throws `NOT_VISIBLE` when it cannot. It is enumerated and covered in
 * `tests/invariants/visibility.spec.ts`, and it is the same predicate
 * `POST /api/client/comments` already writes behind, so the read and the write
 * cannot disagree about which cards exist.
 *
 * Writing a second scoped predicate here would be a second thing to keep in
 * step with lane visibility, card overrides and the draft gate. The day the two
 * drift is the day the thread shows a card the board does not.
 *
 * ## Threading
 *
 * `comments.parent_id` is one level deep by construction — `postComment()`
 * refuses a reply to a reply — so a flat, thread-ordered list plus `parentId`
 * is everything a renderer needs, without a second request and without a tree
 * walk. The order is part of the contract: roots oldest-first, each root
 * immediately followed by its own replies, oldest-first.
 *
 * The client read drops an internal *root* and every reply beneath it, in SQL,
 * via a self-join. Filtering on `comments.internal` alone would leave a public
 * reply to an internal root pointing at a `parentId` the client can never
 * resolve — an orphan that both breaks the renderer and confirms that a comment
 * it may not see exists.
 */

import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { cards, clientContacts, comments, engagements, users } from '@/db/schema';
import type { Executor } from '@/db/types';
import { notVisible } from '@/domain/errors';

/** Which side of the engagement wrote a comment. Never an id. */
export type CommentSide = 'agency' | 'client';

export interface AgencyComment {
  id: string;
  cardId: string;
  /** `null` for a root. One level only — a reply is never itself a parent. */
  parentId: string | null;
  body: string;
  /** Agency-only. A read with `includeInternal: false` cannot return a true. */
  internal: boolean;
  side: CommentSide;
  authorName: string | null;
  authorUserId: string | null;
  authorContactId: string | null;
  createdAt: string;
}

export interface ClientComment {
  id: string;
  cardId: string;
  parentId: string | null;
  body: string;
  side: CommentSide;
  /** A display name, or null. Deliberately never an email and never an id. */
  authorName: string | null;
  createdAt: string;
}

function sideOf(row: { authorUserId: string | null }): CommentSide {
  return row.authorUserId === null ? 'client' : 'agency';
}

interface CommentRow {
  id: string;
  cardId: string;
  parentId: string | null;
  body: string;
  internal: boolean;
  authorUserId: string | null;
  authorContactId: string | null;
  userName: string | null;
  contactName: string | null;
  createdAt: Date;
}

/**
 * The shared read. Always narrowed by the engagement as well as the card, and
 * by `internal = false` on the comment *and its parent* unless the caller has
 * explicitly asked otherwise.
 *
 * `includeInternal` is a required argument with no default, exactly as it is
 * for revision notes: a caller has to decide, in writing, at every call site.
 */
async function selectComments(
  exec: Executor,
  engagementId: string,
  cardId: string,
  includeInternal: boolean,
): Promise<CommentRow[]> {
  const parent = alias(comments, 'parent_comment');

  const scoped = and(eq(comments.cardId, cardId), eq(cards.engagementId, engagementId));
  const publicOnly = and(
    eq(comments.internal, false),
    // A reply under an internal root is part of an internal thread, whatever
    // its own flag says.
    or(isNull(comments.parentId), eq(parent.internal, false)),
  );

  return exec
    .select({
      id: comments.id,
      cardId: comments.cardId,
      parentId: comments.parentId,
      body: comments.body,
      internal: comments.internal,
      authorUserId: comments.authorUserId,
      authorContactId: comments.authorContactId,
      userName: users.name,
      contactName: clientContacts.name,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .innerJoin(cards, eq(cards.id, comments.cardId))
    .leftJoin(parent, eq(parent.id, comments.parentId))
    .leftJoin(users, eq(users.id, comments.authorUserId))
    .leftJoin(clientContacts, eq(clientContacts.id, comments.authorContactId))
    .where(includeInternal ? scoped : and(scoped, publicOnly))
    .orderBy(asc(comments.createdAt), asc(comments.id));
}

/**
 * Roots oldest-first, each immediately followed by its replies oldest-first.
 *
 * Done here rather than in SQL because it is presentation order over a set the
 * database has already decided; a recursive CTE would buy nothing at one level
 * of nesting. A reply whose root is not in the set is dropped — with the SQL
 * above that cannot happen for the client read, and it is the safe behaviour if
 * a future caller ever makes it possible.
 */
function threadOrder<T extends { id: string; parentId: string | null }>(rows: readonly T[]): T[] {
  const roots = rows.filter((row) => row.parentId === null);
  const repliesTo = new Map<string, T[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    const bucket = repliesTo.get(row.parentId);
    if (bucket) bucket.push(row);
    else repliesTo.set(row.parentId, [row]);
  }
  return roots.flatMap((root) => [root, ...(repliesTo.get(root.id) ?? [])]);
}

/**
 * AGENCY-ONLY. Every comment on one card, internal ones included.
 *
 * Authorised in the predicate: the caller has already resolved the card to an
 * engagement it owns via {@link loadCardEngagementForOrg}, and the read is
 * narrowed by that engagement again here.
 */
export async function loadAgencyComments(
  exec: Executor,
  engagementId: string,
  cardId: string,
): Promise<AgencyComment[]> {
  const rows = await selectComments(exec, engagementId, cardId, true);
  return threadOrder(rows).map((row) => ({
    id: row.id,
    cardId: row.cardId,
    parentId: row.parentId,
    body: row.body,
    internal: row.internal,
    side: sideOf(row),
    authorName: row.userName ?? row.contactName,
    authorUserId: row.authorUserId,
    authorContactId: row.authorContactId,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * CLIENT-REACHABLE, but only ever *after* `loadClientVisibleCardId()` has
 * resolved the card through the board's own predicate. See the file header: the
 * visibility decision is that function's, and this one only refuses to carry
 * internal rows.
 *
 * Emits **no identifiers of people at all** — not a user id, not a contact id,
 * not an email. `MUST_NOT_LEAK` in the fixtures lists a bare user uuid for
 * exactly this reason. A thread needs a display name and a side to be readable
 * and nothing that can be correlated. The comment's own id and `parentId` are
 * emitted because a reply has to be able to name what it replies to, and both
 * are ids of rows the contact is looking at.
 */
export async function loadClientVisibleComments(
  exec: Executor,
  engagementId: string,
  cardId: string,
): Promise<ClientComment[]> {
  const rows = await selectComments(exec, engagementId, cardId, false);
  return threadOrder(rows).map((row) => ({
    id: row.id,
    cardId: row.cardId,
    parentId: row.parentId,
    body: row.body,
    side: sideOf(row),
    authorName: row.userName ?? row.contactName,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * AGENCY-ONLY. Resolves a card to its engagement, org-scoped.
 *
 * `GET /api/comments` needs the engagement id before it can read and must not
 * learn it from the request. `NOT_VISIBLE` — a 404, never a 403 — because a 403
 * confirms the card exists.
 */
export async function loadCardEngagementForOrg(
  exec: Executor,
  orgId: string,
  cardId: string,
): Promise<{ engagementId: string; cardId: string }> {
  const rows = await exec
    .select({ engagementId: cards.engagementId, cardId: cards.id })
    .from(cards)
    .innerJoin(engagements, eq(engagements.id, cards.engagementId))
    .where(and(eq(cards.id, cardId), eq(engagements.orgId, orgId)))
    .limit(1);

  const row = rows[0];
  if (!row) throw notVisible('Card not found');
  return row;
}
