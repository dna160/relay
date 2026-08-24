/**
 * The reference shelf, agency side.
 *
 * A "group" is a label on a row, not an entity (DATA-MODEL: `group_label` is a
 * text column, and the shelf has "no versioning, no approval, no tree"). The
 * grouping below is presentation over a flat list — there is no group id to
 * rename, reorder, or leave dangling when its last file is deleted.
 */

import { asc, eq } from 'drizzle-orm';
import { referenceFiles } from '@/db/schema';
import type { Executor } from '@/db/types';

export interface ShelfItem {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  uploadedAt: string;
  clientVisible: boolean;
}

export interface ShelfGroup {
  /** The label itself. There is no group row, so there is no other id. */
  id: string;
  label: string;
  position: number;
  items: ShelfItem[];
}

const UNGROUPED = 'Ungrouped';

export async function loadShelf(exec: Executor, engagementId: string): Promise<ShelfGroup[]> {
  const rows = await exec
    .select({
      id: referenceFiles.id,
      groupLabel: referenceFiles.groupLabel,
      filename: referenceFiles.filename,
      mime: referenceFiles.mime,
      sizeBytes: referenceFiles.sizeBytes,
      clientVisible: referenceFiles.clientVisible,
      createdAt: referenceFiles.createdAt,
    })
    .from(referenceFiles)
    .where(eq(referenceFiles.engagementId, engagementId))
    .orderBy(asc(referenceFiles.groupLabel), asc(referenceFiles.createdAt));

  const byLabel = new Map<string, ShelfItem[]>();
  for (const row of rows) {
    const label = row.groupLabel ?? UNGROUPED;
    const item: ShelfItem = {
      id: row.id,
      filename: row.filename,
      mime: row.mime,
      sizeBytes: row.sizeBytes,
      uploadedAt: row.createdAt.toISOString(),
      clientVisible: row.clientVisible,
    };
    const bucket = byLabel.get(label);
    if (bucket) bucket.push(item);
    else byLabel.set(label, [item]);
  }

  return [...byLabel.entries()].map(([label, items], position) => ({
    id: label,
    label,
    position,
    items,
  }));
}
