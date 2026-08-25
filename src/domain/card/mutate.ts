/**
 * Card writes that are not state changes: create, edit, reorder.
 *
 * There is deliberately no `state` field anywhere in this file. Dragging a card
 * writes `position`, and editing one writes prose — neither is allowed to move
 * the board (ADR-003, INV-2). The route's zod schema omits `state` for the same
 * reason, so a client that sends it gets a 400 rather than a silent no-op.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { cards, engagements, lanes, users } from '@/db/schema';
import type { Database, Executor } from '@/db/types';
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

/**
 * The assignee must be a member of the agency that owns the engagement.
 *
 * `assigneeId` arrives in the request body and, unchecked, is any UUID in the
 * `users` table — including a member of a different agency. Nothing stops the
 * insert: `cards.assignee_id` references `users`, not "users in this org". The
 * board read then joins `users` on that id and returns the person's **name**,
 * so a card assigned to `<another agency's user id>` prints a stranger's name
 * on your board, and probing ids turns the board into a directory of every
 * agency on the platform.
 *
 * 404 rather than 400: which user ids exist is not a fact this caller is
 * entitled to, and `NOT_VISIBLE` is how the rest of the codebase says so.
 */
async function assertAssigneeInOrg(
  exec: Executor,
  engagementId: string,
  assigneeId: string,
): Promise<void> {
  const rows = await exec
    .select({ id: users.id })
    .from(users)
    .innerJoin(engagements, eq(engagements.orgId, users.orgId))
    .where(and(eq(users.id, assigneeId), eq(engagements.id, engagementId)))
    .limit(1);
  if (!rows[0]) throw notVisible('Assignee not found');
}

export async function createCard(
  exec: Executor,
  input: CreateCardInput,
  now: Date,
): Promise<CardRecord> {
  const title = input.title.trim();
  if (title.length === 0) throw validationFailed('A card needs a title');

  if (input.assigneeId) await assertAssigneeInOrg(exec, input.engagementId, input.assigneeId);

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
  if (patch.assigneeId) await assertAssigneeInOrg(exec, engagementId, patch.assigneeId);

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

/**
 * An edit that also moves the card: content, lane and position, one transaction.
 *
 * `PATCH /api/cards/:id` used to call `updateCard()` and then `reorderCards()`
 * against the bare connection. Two transactions, so a lane id belonging to
 * another engagement — which `reorderCards()` correctly refuses — left the
 * title, description and internal notes from the same request already written,
 * and returned a 404 saying nothing had happened. The response and the database
 * disagreed about whether the request was applied, which is the one thing a
 * PATCH must never do.
 */
export async function updateAndPlaceCard(
  db: Database,
  engagementId: string,
  cardId: string,
  patch: UpdateCardInput,
  placement: { laneId?: string; position?: number },
  now: Date,
): Promise<CardRecord> {
  return db.transaction(async (tx) => {
    const card = await updateCard(tx, engagementId, cardId, patch, now);
    const laneId = placement.laneId ?? card.laneId;
    const position = placement.position ?? card.position;
    await reorderCards(tx, engagementId, [{ cardId, laneId, position }], now);
    return { ...card, laneId, position };
  });
}
