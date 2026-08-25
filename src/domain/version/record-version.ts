/**
 * Recording a version after the bytes have already landed in object storage.
 *
 * The app server never sees the file (INV-10, ADR-009). It hands out a
 * presigned PUT, the browser uploads directly, and this function records what
 * happened: key, size, mime, and the sha256 the uploader computed. The hash is
 * the uploader's claim, made at the moment of upload and frozen from then on —
 * which is precisely what an approval binds to six months later.
 *
 * `asset_versions` is append-only (INV-4). After this insert the only columns
 * anything may write are `published_to_client_at` and `superseded_by`, both
 * set-once, and only the purge worker may delete a row.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import { assetVersions, cards } from '@/db/schema';
import type { Database, Tx } from '@/db/types';
import { isVersionKeyFor } from '../storage/keys';
import { bumpActivity } from '../engagement/lifecycle';
import { notVisible, validationFailed } from '../errors';

const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface RecordVersionInput {
  cardId: string;
  engagementId: string;
  storageKey: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  uploadedByUserId: string;
}

export interface VersionRecord {
  id: string;
  cardId: string;
  versionNo: number;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: Date;
  publishedToClientAt: Date | null;
  supersededBy: string | null;
}

const versionColumns = {
  id: assetVersions.id,
  cardId: assetVersions.cardId,
  versionNo: assetVersions.versionNo,
  filename: assetVersions.filename,
  mime: assetVersions.mime,
  sizeBytes: assetVersions.sizeBytes,
  sha256: assetVersions.sha256,
  uploadedAt: assetVersions.uploadedAt,
  publishedToClientAt: assetVersions.publishedToClientAt,
  supersededBy: assetVersions.supersededBy,
} as const;

/**
 * Allocates `version_no` inside the transaction, under a row lock on the card.
 * `UNIQUE (card_id, version_no)` is the backstop: if two uploads race past the
 * lock somehow, the second one fails loudly rather than producing two "v3"s
 * that later disagree about which was approved.
 */
export async function recordVersion(
  db: Database,
  input: RecordVersionInput,
  now: Date,
): Promise<VersionRecord> {
  if (!SHA256_HEX.test(input.sha256)) {
    throw validationFailed('sha256 must be 64 lowercase hex characters');
  }
  if (input.sizeBytes <= 0) throw validationFailed('sizeBytes must be positive');
  /**
   * The key must be one this engagement and card were actually issued. It
   * arrives in the request body after the upload, so until it is checked a
   * caller can point a version row at any object in the bucket — including one
   * belonging to another engagement, which breaks purge (INV-7) and lets the
   * download route sign a GET for it.
   */
  if (!isVersionKeyFor(input.engagementId, input.cardId, input.storageKey)) {
    throw validationFailed('That storage key does not belong to this card');
  }

  return db.transaction(async (tx) => {
    const card = await tx
      .select({ id: cards.id })
      .from(cards)
      .where(and(eq(cards.id, input.cardId), eq(cards.engagementId, input.engagementId)))
      .for('update')
      .limit(1);
    if (!card[0]) throw notVisible('Card not found');

    const previous = await tx
      .select({ id: assetVersions.id, versionNo: assetVersions.versionNo })
      .from(assetVersions)
      .where(eq(assetVersions.cardId, input.cardId))
      .orderBy(desc(assetVersions.versionNo))
      .limit(1);

    const versionNo = (previous[0]?.versionNo ?? 0) + 1;

    const inserted = await tx
      .insert(assetVersions)
      .values({
        cardId: input.cardId,
        versionNo,
        storageKey: input.storageKey,
        filename: input.filename,
        mime: input.mime,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        uploadedByUserId: input.uploadedByUserId,
        uploadedAt: now,
      })
      .returning(versionColumns);

    const row = inserted[0];
    if (!row) throw new Error('asset_version insert returned no row');

    const priorId = previous[0]?.id;
    if (priorId) await supersede(tx, priorId, row.id);

    await bumpActivity(tx, input.engagementId, now);
    return row;
  });
}

/**
 * Set-once. The `IS NULL` guard is what makes it set-once rather than
 * "set-once as long as nobody calls it twice" — one of the two mutations INV-4
 * permits on this table.
 */
export async function supersede(tx: Tx, versionId: string, bySupersedingId: string): Promise<void> {
  await tx
    .update(assetVersions)
    .set({ supersededBy: bySupersedingId })
    .where(and(eq(assetVersions.id, versionId), isNull(assetVersions.supersededBy)));
}

/**
 * The internal gate's write half. Publishing an already-published version is a
 * no-op, not a re-stamp: the date a client first saw a file is a fact about the
 * past, and moving it would quietly rewrite a review clock.
 */
export async function markPublished(
  tx: Tx,
  versionId: string,
  now: Date,
): Promise<VersionRecord | null> {
  const updated = await tx
    .update(assetVersions)
    .set({ publishedToClientAt: now })
    .where(and(eq(assetVersions.id, versionId), isNull(assetVersions.publishedToClientAt)))
    .returning(versionColumns);
  return updated[0] ?? null;
}

export async function loadVersionForCard(
  tx: Tx,
  versionId: string,
): Promise<{ version: VersionRecord; cardId: string; engagementId: string }> {
  const rows = await tx
    .select({ version: versionColumns, engagementId: cards.engagementId })
    .from(assetVersions)
    .innerJoin(cards, eq(cards.id, assetVersions.cardId))
    .where(eq(assetVersions.id, versionId))
    .limit(1);
  const row = rows[0];
  if (!row) throw notVisible('Version not found');
  return { version: row.version, cardId: row.version.cardId, engagementId: row.engagementId };
}
