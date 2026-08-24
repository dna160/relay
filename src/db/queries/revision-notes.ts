/**
 * Reading the revision thread, both sides.
 *
 * The table has been written to since Phase 3 (`record-decision.ts` threads a
 * `changes_requested` note onto the version it was decided against) and read by
 * nothing, which left PRD §5.3's "notes thread to the version they were written
 * against and never float forward" unenforceable in the UI — the guarantee
 * existed in the schema and nowhere a user could see it.
 *
 * ## How the client read is scoped
 *
 * Nothing in this file takes a `ClientScope`, and that is deliberate rather
 * than an omission. A client note read is two questions — "may this contact see
 * this version?" and "what is threaded to it?" — and the first one already has
 * an answer: `loadClientDecidableVersion()` in `client-board.ts`, which
 * resolves a version through the published-version, visible-card and
 * published-lane predicates and throws `NOT_VISIBLE` when it cannot. That
 * function is enumerated and covered in `tests/invariants/visibility.spec.ts`.
 *
 * So the client route resolves the version through it *first* and only then
 * reads the thread, exactly as `loadClientQueue` is built out of
 * `loadClientBoard` rather than being a second unfiltered path. Writing a
 * second scoped predicate here would be a second thing to keep in step with
 * lane visibility, card overrides, draft state and the publish gate, and the
 * day the two drift is the day the thread shows something the board does not.
 *
 * `includeInternal` is the one remaining hazard, so it is a required argument
 * with no default. A caller has to decide, in writing, at every call site.
 */

import { and, asc, eq } from 'drizzle-orm';
import {
  assetVersions,
  cards,
  clientContacts,
  engagements,
  revisionNotes,
  users,
} from '@/db/schema';
import type { Executor } from '@/db/types';
import { notVisible } from '@/domain/errors';

/** Which side of the engagement wrote a note. Never an id. */
export type NoteSide = 'agency' | 'client';

export interface AgencyRevisionNote {
  id: string;
  versionId: string;
  versionNo: number;
  body: string;
  /** Agency-only. A read with `includeInternal: false` cannot return a true. */
  internal: boolean;
  side: NoteSide;
  authorName: string | null;
  authorUserId: string | null;
  authorContactId: string | null;
  createdAt: string;
}

export interface ClientRevisionNote {
  id: string;
  versionId: string;
  /** The version number the note was written against — the "on v4" binding. */
  versionNo: number;
  body: string;
  side: NoteSide;
  /** A display name, or null. Deliberately never an email and never an id. */
  authorName: string | null;
  createdAt: string;
}

function sideOf(row: { authorUserId: string | null }): NoteSide {
  return row.authorUserId === null ? 'client' : 'agency';
}

interface NoteRow {
  id: string;
  versionId: string;
  versionNo: number;
  body: string;
  internal: boolean;
  authorUserId: string | null;
  authorContactId: string | null;
  userName: string | null;
  contactName: string | null;
  createdAt: Date;
}

/**
 * The shared read. Always narrowed by the engagement, and by `internal = false`
 * unless the caller has explicitly asked otherwise.
 */
async function selectNotes(
  exec: Executor,
  engagementId: string,
  versionId: string,
  includeInternal: boolean,
): Promise<NoteRow[]> {
  const scoped = and(
    eq(revisionNotes.assetVersionId, versionId),
    eq(cards.engagementId, engagementId),
  );
  return exec
    .select({
      id: revisionNotes.id,
      versionId: revisionNotes.assetVersionId,
      versionNo: assetVersions.versionNo,
      body: revisionNotes.body,
      internal: revisionNotes.internal,
      authorUserId: revisionNotes.authorUserId,
      authorContactId: revisionNotes.authorContactId,
      userName: users.name,
      contactName: clientContacts.name,
      createdAt: revisionNotes.createdAt,
    })
    .from(revisionNotes)
    .innerJoin(assetVersions, eq(assetVersions.id, revisionNotes.assetVersionId))
    .innerJoin(cards, eq(cards.id, assetVersions.cardId))
    .leftJoin(users, eq(users.id, revisionNotes.authorUserId))
    .leftJoin(clientContacts, eq(clientContacts.id, revisionNotes.authorContactId))
    .where(includeInternal ? scoped : and(scoped, eq(revisionNotes.internal, false)))
    .orderBy(asc(revisionNotes.createdAt));
}

/**
 * AGENCY-ONLY. Every note on one version, internal ones included, oldest first.
 *
 * Authorised in the predicate: the caller has already resolved the version to
 * an engagement it owns via {@link loadVersionEngagementForOrg}, and the read
 * is narrowed by that engagement again here.
 */
export async function loadAgencyRevisionNotes(
  exec: Executor,
  engagementId: string,
  versionId: string,
): Promise<AgencyRevisionNote[]> {
  const rows = await selectNotes(exec, engagementId, versionId, true);
  return rows.map((row) => ({
    id: row.id,
    versionId: row.versionId,
    versionNo: row.versionNo,
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
 * CLIENT-REACHABLE, but only ever *after* `loadClientDecidableVersion()` has
 * resolved the version through the board's own predicate. See the file header:
 * the visibility decision is that function's, and this one only refuses to
 * carry internal rows.
 *
 * Emits **no identifiers at all** — not a user id, not a contact id, not an
 * email. `MUST_NOT_LEAK` in the fixtures lists a bare user uuid for exactly
 * this reason. A thread needs a display name and a side to be readable, and
 * nothing that can be correlated.
 */
export async function loadClientVisibleNotes(
  exec: Executor,
  engagementId: string,
  versionId: string,
): Promise<ClientRevisionNote[]> {
  const rows = await selectNotes(exec, engagementId, versionId, false);
  return rows.map((row) => ({
    id: row.id,
    versionId: row.versionId,
    versionNo: row.versionNo,
    body: row.body,
    side: sideOf(row),
    authorName: row.userName ?? row.contactName,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * AGENCY-ONLY. Resolves a version to its engagement, org-scoped.
 *
 * The notes routes need the engagement id before they can read or write, and
 * they must not learn it from the request. `NOT_VISIBLE` — a 404, never a 403 —
 * because a 403 confirms the version exists.
 */
export async function loadVersionEngagementForOrg(
  exec: Executor,
  orgId: string,
  versionId: string,
): Promise<{ engagementId: string; cardId: string }> {
  const rows = await exec
    .select({ engagementId: cards.engagementId, cardId: cards.id })
    .from(assetVersions)
    .innerJoin(cards, eq(cards.id, assetVersions.cardId))
    .innerJoin(engagements, eq(engagements.id, cards.engagementId))
    .where(and(eq(assetVersions.id, versionId), eq(engagements.orgId, orgId)))
    .limit(1);

  const row = rows[0];
  if (!row) throw notVisible('Version not found');
  return row;
}
