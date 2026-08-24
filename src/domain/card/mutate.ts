/**
 * Card writes that are not state changes: create, edit, reorder.
 *
 * There is deliberately no `state` field anywhere in this file. Dragging a card
 * writes `position`, and editing one writes prose — neither is allowed to move
 * the board (ADR-003, INV-2). The route's zod schema omits `state` for the same
 * reason, so a client that sends it gets a 400 rather than a silent no-op.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { cards, lanes } from '@/db/schema';
import type { Executor } from '@/db/types';
import type { CardVisibilityOverride } from '@/lib/types';
import { notVisible, validationFailed } from '../errors';

export interface CreateCardInput {
  engagementId: string;
  laneId: string;
  title: string;
  description?: string | null;
  assigneeId?: string | null;
  dueAt?: Date | null;
  contractedRounds?: number | null;
  internalNotes?: string | null;
  effortEstimate?: number | null;
  visibilityOverride?: CardVisibilityOverride;
  position?: number;
}

export interface CardRecord {
  id: string;
  engagementId: string;
  laneId: string;
  title: string;
  position: number;
}

export async function createCard(
  exec: Executor,
  input: CreateCardInput,
  now: Date,
): Promise<CardRecord> {
  const title = input.title.trim();
  if (title.length === 0) throw validationFailed('A card needs a title');

  // The lane must belong to the engagement the caller is scoped to. Without
  // this, a lane id from another agency's board would create a card there.
  const lane = await exec
    .select({ id: lanes.id })
    .from(lanes)
    .where(and(eq(lanes.id, input.laneId), eq(lanes.engagementId, input.engagementId)))
    .limit(1);
  if (!lane[0]) throw notVisible('Lane not found');

  const inserted = await exec
    .insert(cards)
    .values({
      engagementId: input.engagementId,
      laneId: input.laneId,
      title,
      description: input.description ?? null,
      assigneeId: input.assigneeId ?? null,
      dueAt: input.dueAt ?? null,
      contractedRounds: input.contractedRounds ?? null,
      internalNotes: input.internalNotes ?? null,
      effortEstimate: input.effortEstimate ?? null,
      visibilityOverride: input.visibilityOverride ?? 'inherit',
      position: input.position ?? 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning({
      id: cards.id,
      engagementId: cards.engagementId,
      laneId: cards.laneId,
      title: cards.title,
      position: cards.position,
    });

  const row = inserted[0];
  if (!row) throw new Error('card insert returned no row');
  return row;
}

/** Every editable field. `state` is absent, structurally. */
export interface UpdateCardInput {
  title?: string;
  description?: string | null;
  assigneeId?: string | null;
  dueAt?: Date | null;
  contractedRounds?: number | null;
  internalNotes?: string | null;
  effortEstimate?: number | null;
  visibilityOverride?: CardVisibilityOverride;
}

export async function updateCard(
  exec: Executor,
  engagementId: string,
  cardId: string,
  patch: UpdateCardInput,
  now: Date,
): Promise<CardRecord> {
  const updated = await exec
    .update(cards)
    .set({ ...patch, updatedAt: now })
    .where(and(eq(cards.id, cardId), eq(cards.engagementId, engagementId)))
    .returning({
      id: cards.id,
      engagementId: cards.engagementId,
      laneId: cards.laneId,
      title: cards.title,
      position: cards.position,
    });

  const row = updated[0];
  if (!row) throw notVisible('Card not found');
  return row;
}

export interface ReorderItem {
  cardId: string;
  laneId: string;
  position: number;
}

/**
 * Reorder writes `position` and, when a card is dragged between lanes,
 * `lane_id`. Nothing else. The whole batch runs in one statement per card
 * inside the caller's transaction so a half-applied drag cannot leave two cards
 * claiming position 3.
 */
export async function reorderCards(
  exec: Executor,
  engagementId: string,
  items: readonly ReorderItem[],
  now: Date,
): Promise<void> {
  if (items.length === 0) return;

  const laneIds = [...new Set(items.map((i) => i.laneId))];
  const owned = await exec
    .select({ id: lanes.id })
    .from(lanes)
    .where(and(eq(lanes.engagementId, engagementId), inArray(lanes.id, laneIds)));
  if (owned.length !== laneIds.length) throw notVisible('Lane not found');

  for (const item of items) {
    await exec
      .update(cards)
      .set({ laneId: item.laneId, position: item.position, updatedAt: now })
      .where(and(eq(cards.id, item.cardId), eq(cards.engagementId, engagementId)));
  }
}
