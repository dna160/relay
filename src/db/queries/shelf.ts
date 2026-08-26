/**
 * The reference shelf, agency side.
 *
 * A "group" is a label on a row, not an entity (DATA-MODEL: `group_label` is a
 * text column, and the shelf has "no versioning, no approval, no tree"). The
 * grouping below is presentation over a flat list — there is no group id to
 * rename, reorder, or leave dangling when its last file is deleted.
 */

import { asc, eq } from 'drizzle-orm';
import { engagements, referenceFiles } from '@/db/schema';
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
  /**
   * Phase 7. The labels a template stamped, which have no files under them yet
   * and therefore appear nowhere in `reference_files`.
   *
   * This is the only reason `engagements.shelf_group_labels` exists: a group is
   * a label on a row, so an *empty* group cannot be one. Seeding them here
   * keeps that true — there is still no group entity, no group id to rename,
   * and nothing to leave dangling. The engagement carries a list of names the
   * grouping starts from, and a stamped group that never gets a file is a
   * heading with nothing under it, which is exactly what the shelf page
   * already renders.
   */
  const stamped = await exec
    .select({ labels: engagements.shelfGroupLabels })
    .from(engagements)
    .where(eq(engagements.id, engagementId))
    .limit(1);

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
  // Insertion order is the map's order, so the stamped labels come first, in
  // the order the template named them, and a label somebody invented by
  // uploading under it lands after. `Ungrouped` is not seeded: it is a fallback
  // for files with no label, and an empty one would be a heading for nothing.
  for (const label of stamped[0]?.labels ?? []) {
    if (label.length > 0 && !byLabel.has(label)) byLabel.set(label, []);
  }
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
