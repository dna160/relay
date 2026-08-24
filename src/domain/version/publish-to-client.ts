/**
 * The internal review gate (PRD §5.2). Nothing reaches the client projection
 * until an agency member promotes it.
 *
 * One transaction stamps `published_to_client_at` on the version and moves the
 * card `internal_review -> awaiting_client` through the state machine. The two
 * halves cannot separate: a published version on a card the client cannot see
 * is a file in limbo, and an `awaiting_client` card with nothing published is a
 * client staring at an empty review screen.
 */

import { and, desc, eq } from 'drizzle-orm';
import { assetVersions, cards } from '@/db/schema';
import type { Database } from '@/db/types';
import { transitionCard, type TransitionOutcome } from '../card/transition-card';
import { notVisible, validationFailed } from '../errors';
import { markPublished, type VersionRecord } from './record-version';

export interface PublishCardInput {
  cardId: string;
  engagementId: string;
  /** Defaults to the card's newest version. */
  versionId?: string;
  actorUserId: string;
}

export interface PublishResult {
  version: VersionRecord;
  transition: TransitionOutcome;
  /** False when the version was already published — a no-op, not a re-stamp. */
  newlyPublished: boolean;
}

export async function publishCardToClient(
  db: Database,
  input: PublishCardInput,
  now: Date,
): Promise<PublishResult> {
  return db.transaction(async (tx) => {
    const card = await tx
      .select({ id: cards.id })
      .from(cards)
      .where(and(eq(cards.id, input.cardId), eq(cards.engagementId, input.engagementId)))
      .limit(1);
    if (!card[0]) throw notVisible('Card not found');

    const candidates = await tx
      .select({
        id: assetVersions.id,
        publishedToClientAt: assetVersions.publishedToClientAt,
      })
      .from(assetVersions)
      .where(
        input.versionId
          ? and(eq(assetVersions.cardId, input.cardId), eq(assetVersions.id, input.versionId))
          : eq(assetVersions.cardId, input.cardId),
      )
      .orderBy(desc(assetVersions.versionNo))
      .limit(1);

    const target = candidates[0];
    if (!target) {
      throw validationFailed('There is no version to publish on this card');
    }

    const published = await markPublished(tx, target.id, now);
    const newlyPublished = published !== null;

    // The state machine decides whether this move is legal; an already
    // published version on a card in the wrong state still gets a 409.
    const outcome = await transitionCard(
      tx,
      { cardId: input.cardId, to: 'awaiting_client', actor: { kind: 'agency', userId: input.actorUserId } },
      now,
    );

    if (published) return { version: published, transition: outcome, newlyPublished };

    const existing = await tx
      .select()
      .from(assetVersions)
      .where(eq(assetVersions.id, target.id))
      .limit(1);
    const row = existing[0];
    if (!row) throw notVisible('Version not found');
    return {
      version: {
        id: row.id,
        cardId: row.cardId,
        versionNo: row.versionNo,
        filename: row.filename,
        mime: row.mime,
        sizeBytes: row.sizeBytes,
        sha256: row.sha256,
        uploadedAt: row.uploadedAt,
        publishedToClientAt: row.publishedToClientAt,
        supersededBy: row.supersededBy,
      },
      transition: outcome,
      newlyPublished,
    };
  });
}
