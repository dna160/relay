/**
 * The reference shelf (PRD §5.3). Flat, a handful of labelled groups, no
 * versioning, no approval state, no tree.
 *
 * Deliberately not the same code path as `asset_versions`. The shelf holds
 * brand guidelines, raw footage, and the contract — inputs, not deliverables.
 * Giving them version numbers and approval states would make every one of them
 * look like something the client is expected to sign off.
 */

import { eq } from 'drizzle-orm';
import { engagements, referenceFiles } from '@/db/schema';
import type { Database } from '@/db/types';
import { isShelfKeyFor } from '../storage/keys';
import { bumpActivity } from '../engagement/lifecycle';
import { notVisible, validationFailed } from '../errors';

export interface AddReferenceFileInput {
  engagementId: string;
  groupLabel?: string | null;
  storageKey: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  uploadedByUserId: string;
  clientVisible?: boolean;
}

export interface ReferenceFileRecord {
  id: string;
  groupLabel: string | null;
  filename: string;
  mime: string;
  sizeBytes: number;
  clientVisible: boolean;
  createdAt: Date;
}

export async function addReferenceFile(
  db: Database,
  input: AddReferenceFileInput,
  now: Date,
): Promise<ReferenceFileRecord> {
  if (input.sizeBytes <= 0) throw validationFailed('sizeBytes must be positive');
  // Same reasoning as `recordVersion`: the key comes back in a request body and
  // is not the one this route handed out until it has been checked against the
  // engagement that authorised the write.
  if (!isShelfKeyFor(input.engagementId, input.storageKey)) {
    throw validationFailed('That storage key does not belong to this engagement');
  }

  return db.transaction(async (tx) => {
    const found = await tx
      .select({ id: engagements.id })
      .from(engagements)
      .where(eq(engagements.id, input.engagementId))
      .limit(1);
    if (!found[0]) throw notVisible('Engagement not found');

    const inserted = await tx
      .insert(referenceFiles)
      .values({
        engagementId: input.engagementId,
        groupLabel: input.groupLabel ?? null,
        storageKey: input.storageKey,
        filename: input.filename,
        mime: input.mime,
        sizeBytes: input.sizeBytes,
        uploadedByUserId: input.uploadedByUserId,
        ...(input.clientVisible === undefined ? {} : { clientVisible: input.clientVisible }),
        createdAt: now,
      })
      .returning({
        id: referenceFiles.id,
        groupLabel: referenceFiles.groupLabel,
        filename: referenceFiles.filename,
        mime: referenceFiles.mime,
        sizeBytes: referenceFiles.sizeBytes,
        clientVisible: referenceFiles.clientVisible,
        createdAt: referenceFiles.createdAt,
      });

    const row = inserted[0];
    if (!row) throw new Error('reference_file insert returned no row');

    await bumpActivity(tx, input.engagementId, now);
    return row;
  });
}
