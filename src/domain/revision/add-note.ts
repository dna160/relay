/**
 * Revision notes — PRD §5.3: "notes thread to the version they were written
 * against and never float forward."
 *
 * That sentence is the entire design. A note lives on an `asset_version_id`,
 * not on a card, so "the logo reads too small" stays attached to v1 after v2
 * lands. A card-level thread would show the same sentence against the file that
 * fixed it, and the dispute six months later is about which file the objection
 * was made about.
 *
 * `record-decision.ts` already writes into this table — a `changes_requested`
 * note *is* a revision note, and there is deliberately no second table for it.
 * This module is the other half: the notes people write without also making a
 * decision, and the reads that make the thread visible at all.
 *
 * `internal` is agency-only and is not settable from a client session —
 * structurally, in the same way `postComment` handles it, not by a flag the
 * route remembers to clear.
 */

import { and, eq } from 'drizzle-orm';
import { assetVersions, cards, clientContacts, revisionNotes, users } from '@/db/schema';
import type { Database, Tx } from '@/db/types';
import type { Actor } from '../card/state-machine';
import { bumpActivity } from '../engagement/lifecycle';
import { notVisible, validationFailed } from '../errors';

export interface AddRevisionNoteInput {
  versionId: string;
  /** The engagement the caller is scoped to. A mismatch is `NOT_VISIBLE`. */
  engagementId: string;
  actor: Actor;
  body: string;
  /** Ignored for client actors — structurally, not conditionally. */
  internal?: boolean;
}

export interface RevisionNoteRecord {
  id: string;
  assetVersionId: string;
  body: string;
  internal: boolean;
  authorContactId: string | null;
  authorUserId: string | null;
  /**
   * The author's display name, resolved in the same transaction that wrote the
   * row. Returned so the surface can render the note it just posted without a
   * second round trip — and, more usefully, so the POST response and the GET
   * response are the same shape. A thread whose newest entry is missing a name
   * until the page refreshes is a thread that looks broken.
   */
  authorName: string | null;
  createdAt: Date;
}

export const MAX_NOTE_LENGTH = 20_000;

export async function addRevisionNote(
  db: Database,
  input: AddRevisionNoteInput,
  now: Date,
): Promise<RevisionNoteRecord> {
  const body = input.body.trim();
  if (body.length === 0) throw validationFailed('A note needs something in it');
  if (body.length > MAX_NOTE_LENGTH) throw validationFailed('That note is too long');

  return db.transaction(async (tx) => {
    /**
     * The version must belong to the engagement the caller is scoped to. Joined
     * through `cards` rather than trusted from the request: a version id from
     * another agency's board would otherwise thread a note onto their file.
     */
    const rows = await tx
      .select({ id: assetVersions.id })
      .from(assetVersions)
      .innerJoin(cards, eq(cards.id, assetVersions.cardId))
      .where(
        and(eq(assetVersions.id, input.versionId), eq(cards.engagementId, input.engagementId)),
      )
      .limit(1);
    if (!rows[0]) throw notVisible('Version not found');

    const actor = input.actor;
    const inserted = await tx
      .insert(revisionNotes)
      .values({
        assetVersionId: input.versionId,
        authorContactId: actor.kind === 'client' ? actor.contactId : null,
        authorUserId: actor.kind === 'agency' ? actor.userId : null,
        body,
        // A client-authored note can never be internal. There is no branch here
        // that a future edit could invert.
        internal: actor.kind === 'agency' ? (input.internal ?? false) : false,
        createdAt: now,
      })
      .returning({
        id: revisionNotes.id,
        assetVersionId: revisionNotes.assetVersionId,
        body: revisionNotes.body,
        internal: revisionNotes.internal,
        authorContactId: revisionNotes.authorContactId,
        authorUserId: revisionNotes.authorUserId,
        createdAt: revisionNotes.createdAt,
      });

    const row = inserted[0];
    if (!row) throw new Error('revision note insert returned no row');

    // A note is work. It keeps the retention clock from taking a workspace
    // people are still arguing in.
    await bumpActivity(tx, input.engagementId, now);

    return { ...row, authorName: await authorNameFor(tx, actor) };
  });
}

/**
 * The author's display name, and nothing else about them. A client contact's
 * email is deliberately not a fallback: the note read that serves the client
 * emits no addresses at all (INV-1), and a POST response that did would be the
 * one place the rule was not held.
 */
async function authorNameFor(tx: Tx, actor: Actor): Promise<string | null> {
  if (actor.kind === 'agency') {
    const rows = await tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, actor.userId))
      .limit(1);
    return rows[0]?.name ?? null;
  }
  const rows = await tx
    .select({ name: clientContacts.name })
    .from(clientContacts)
    .where(eq(clientContacts.id, actor.contactId))
    .limit(1);
  return rows[0]?.name ?? null;
}
