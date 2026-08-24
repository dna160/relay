/**
 * Lane writes.
 *
 * `visibility` is not defaulted here. It is defaulted in the column (ADR-006),
 * so a lane created by a route that forgot the field, a template stamp, or a
 * future import script is published — which is the product decision — without
 * three call sites each having to remember it.
 */

import { and, eq } from 'drizzle-orm';
import { lanes } from '@/db/schema';
import type { Executor } from '@/db/types';
import type { LaneVisibility } from '@/lib/types';
import { notVisible, validationFailed } from '../errors';

export interface LaneRecord {
  id: string;
  engagementId: string;
  name: string;
  position: number;
  visibility: LaneVisibility;
}

const laneColumns = {
  id: lanes.id,
  engagementId: lanes.engagementId,
  name: lanes.name,
  position: lanes.position,
  visibility: lanes.visibility,
} as const;

export async function createLane(
  exec: Executor,
  input: { engagementId: string; name: string; position?: number; visibility?: LaneVisibility },
  now: Date,
): Promise<LaneRecord> {
  const name = input.name.trim();
  if (name.length === 0) throw validationFailed('A lane needs a name');

  const inserted = await exec
    .insert(lanes)
    .values({
      engagementId: input.engagementId,
      name,
      position: input.position ?? 0,
      // Omitted rather than defaulted: the column decides.
      ...(input.visibility ? { visibility: input.visibility } : {}),
      createdAt: now,
    })
    .returning(laneColumns);

  const row = inserted[0];
  if (!row) throw new Error('lane insert returned no row');
  return row;
}

export async function updateLane(
  exec: Executor,
  engagementId: string,
  laneId: string,
  patch: { name?: string; position?: number; visibility?: LaneVisibility },
): Promise<LaneRecord> {
  const updated = await exec
    .update(lanes)
    .set(patch)
    .where(and(eq(lanes.id, laneId), eq(lanes.engagementId, engagementId)))
    .returning(laneColumns);

  const row = updated[0];
  if (!row) throw notVisible('Lane not found');
  return row;
}
