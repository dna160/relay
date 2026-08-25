/**
 * INV-3 / ADR-004 — an approval binds to one immutable version and stores that
 * version's sha256 at decision time.
 *
 * The hash is *copied*, never joined. A join answers "what does this file hash
 * to now"; the dispute six months later asks "what did the person who clicked
 * approve actually see". Only a copy can answer that, and only a copy survives
 * the version row being purged.
 *
 * `changes_requested` requires a note. The database enforces it with a CHECK;
 * this file enforces it too, because a constraint violation is a 500 and the
 * client deserves a 400 that says what is missing.
 */

import { eq } from 'drizzle-orm';
import { approvals, assetVersions, cards, revisionNotes } from '@/db/schema';
import type { Database } from '@/db/types';
import type { Decision } from '@/lib/types';
import { transitionCard, type TransitionOutcome } from '../card/transition-card';
import type { Actor, CardState } from '../card/state-machine';
import { notVisible, validationFailed } from '../errors';

export interface RecordDecisionInput {
  versionId: string;
  /**
   * From the session, never the request (INV-6). A client decision carries a
   * contact id; an agency-side sign-off carries a user id. Exactly one, which
   * the `num_nonnulls(...) = 1` CHECK also insists on.
   */
  actor: Actor;
  decision: Decision;
  note?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** The engagement the caller is scoped to. A mismatch is `NOT_VISIBLE`. */
  engagementId: string;
}

export interface DecisionRecord {
  id: string;
  assetVersionId: string;
  decision: Decision;
  versionSha256: string;
  note: string | null;
  decidedAt: Date;
}

export interface RecordDecisionResult {
  approval: DecisionRecord;
  transition: TransitionOutcome;
  roundsUsed: number;
}

/** Where a decision sends the card. The state machine validates the edge. */
function targetState(decision: Decision): CardState {
  return decision === 'approved' ? 'approved' : 'changes_requested';
}

export async function recordDecision(
  db: Database,
  input: RecordDecisionInput,
  now: Date,
): Promise<RecordDecisionResult> {
  const note = input.note?.trim() ?? null;
  if (input.decision === 'changes_requested' && (note === null || note.length === 0)) {
    throw validationFailed('Requesting changes needs a note saying what to change');
  }

  return db.transaction(async (tx) => {
    /**
     * The card is locked first, then the version.
     *
     * `recordVersion()` already takes them in that order — it locks the card to
     * allocate `version_no`, then updates the previous version row to set
     * `superseded_by`. Locking the version first here would make the two paths
     * an ABBA pair: an agency upload on card X racing a client approval of X's
     * current version deadlocks, Postgres kills one of them with 40P01, and one
     * of the two people gets a 500 on the single most consequential button in
     * the product. Both orders are now card -> version, so they queue instead.
     *
     * Re-locking the same card inside `transitionCard()` below costs nothing;
     * the lock is already held by this transaction.
     */
    const owner = await tx
      .select({ cardId: assetVersions.cardId })
      .from(assetVersions)
      .where(eq(assetVersions.id, input.versionId))
      .limit(1);
    const ownerRow = owner[0];
    if (!ownerRow) throw notVisible('Version not found');

    await tx
      .select({ id: cards.id })
      .from(cards)
      .where(eq(cards.id, ownerRow.cardId))
      .for('update')
      .limit(1);

    // The version and its hash, locked, inside the same transaction that will
    // copy the hash. Nothing can slip between the read and the write.
    const rows = await tx
      .select({
        versionId: assetVersions.id,
        sha256: assetVersions.sha256,
        publishedToClientAt: assetVersions.publishedToClientAt,
        cardId: assetVersions.cardId,
        engagementId: cards.engagementId,
      })
      .from(assetVersions)
      .innerJoin(cards, eq(cards.id, assetVersions.cardId))
      .where(eq(assetVersions.id, input.versionId))
      .for('update', { of: assetVersions })
      .limit(1);

    const version = rows[0];
    if (!version) throw notVisible('Version not found');
    if (version.engagementId !== input.engagementId) throw notVisible('Version not found');

    // A client deciding on a version they were never shown is not a permission
    // error, it is a thing that does not exist as far as they are concerned.
    if (input.actor.kind === 'client' && version.publishedToClientAt === null) {
      throw notVisible('Version not found');
    }

    const inserted = await tx
      .insert(approvals)
      .values({
        assetVersionId: version.versionId,
        decision: input.decision,
        decidedByContactId: input.actor.kind === 'client' ? input.actor.contactId : null,
        decidedByUserId: input.actor.kind === 'agency' ? input.actor.userId : null,
        versionSha256: version.sha256,
        note,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        decidedAt: now,
      })
      .returning({
        id: approvals.id,
        assetVersionId: approvals.assetVersionId,
        decision: approvals.decision,
        versionSha256: approvals.versionSha256,
        note: approvals.note,
        decidedAt: approvals.decidedAt,
      });

    const approval = inserted[0];
    if (!approval) throw new Error('approval insert returned no row');

    if (note !== null) {
      // Threaded to this version. It never floats forward to the next one.
      await tx.insert(revisionNotes).values({
        assetVersionId: version.versionId,
        authorContactId: input.actor.kind === 'client' ? input.actor.contactId : null,
        authorUserId: input.actor.kind === 'agency' ? input.actor.userId : null,
        body: note,
        internal: false,
        createdAt: now,
      });
    }

    /**
     * The round counter lives in `transitionCard`, which applies it whenever
     * `transition()` reports `incrementsRound` — so an agency-initiated
     * awaiting_client -> changes_requested counts identically to a client one.
     * Two increment sites would eventually disagree, and the number they
     * disagree about is the one an invoice is argued over.
     */
    const outcome = await transitionCard(
      tx,
      { cardId: version.cardId, to: targetState(input.decision), actor: input.actor },
      now,
    );

    return { approval, transition: outcome, roundsUsed: outcome.roundsUsed };
  });
}
