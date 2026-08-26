/**
 * Phase 2 — the board.
 *
 * `lanes.visibility` defaults to `'published'` at the column level (ADR-006):
 * the product decision is that private is explicit, so the default lives in the
 * database rather than in whichever call site remembered it.
 *
 * `cards.state` is written by exactly one file, `domain/card/transition-card.ts`
 * (INV-2). `state_transitions` is the sole source of possession data (INV-5,
 * ADR-010) — no running total is stored anywhere, because totals denormalise
 * badly and cannot be recomputed after a bug.
 *
 * `archived_at` on both tables is removal, and it is deliberately **not** a
 * card state (ADR-026). Archived is orthogonal to the approval machine: an
 * archived card that was `awaiting_client` is still awaiting the client if it
 * comes back, and a machine with a trapdoor from every state to one state and
 * back is not a machine. A nullable timestamp keeps `cards.state` untouched, so
 * removal writes nothing INV-2 governs.
 */

import { relations, sql } from 'drizzle-orm';
import { index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { primaryId, tstz, tstzNow } from './_shared';
import {
  cardStateEnum,
  laneVisibilityEnum,
  possessionEnum,
  CARD_VISIBILITY_OVERRIDES,
} from './enums';
import { engagements, clientContacts } from './engagements';
import { users } from './tenancy';

export const lanes = pgTable(
  'lanes',
  {
    id: primaryId(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    visibility: laneVisibilityEnum('visibility').notNull().default('published'),
    /**
     * Removal (ADR-026). Null is a live lane. An archived lane and everything
     * standing in it disappears from both boards — the same shape private
     * visibility already has, where the lane hides its cards without touching
     * a single card row.
     */
    archivedAt: tstz('archived_at'),
    archivedByUserId: uuid('archived_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: tstzNow('created_at'),
  },
  (t) => ({
    byEngagement: index('lanes_engagement_position_idx').on(t.engagementId, t.position),
    /** The board read. Partial, because the archive is the rare half. */
    live: index('lanes_engagement_live_idx')
      .on(t.engagementId, t.position)
      .where(sql`archived_at IS NULL`),
  }),
);

export const cards = pgTable(
  'cards',
  {
    id: primaryId(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    laneId: uuid('lane_id')
      .notNull()
      .references(() => lanes.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    state: cardStateEnum('state').notNull().default('draft'),
    position: integer('position').notNull().default(0),
    /** INTERNAL — never emitted by client-view.ts. */
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    dueAt: tstz('due_at'),
    contractedRounds: integer('contracted_rounds'),
    roundsUsed: integer('rounds_used').notNull().default(0),
    /** INTERNAL. */
    internalNotes: text('internal_notes'),
    /** INTERNAL. */
    effortEstimate: integer('effort_estimate'),
    visibilityOverride: text('visibility_override', { enum: CARD_VISIBILITY_OVERRIDES })
      .notNull()
      .default('inherit'),
    /**
     * Removal (ADR-026). Null is a live card. Set, the card is off both boards
     * and out of the attention list, and every version, approval, transition
     * and comment it carries is untouched — which is the entire reason this
     * column exists rather than a `DELETE`.
     */
    archivedAt: tstz('archived_at'),
    archivedByUserId: uuid('archived_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: tstzNow('created_at'),
    updatedAt: tstzNow('updated_at'),
  },
  (t) => ({
    byLane: index('cards_engagement_lane_position_idx').on(t.engagementId, t.laneId, t.position),
    /** "My cards", which never means the ones already signed off. */
    byAssignee: index('cards_assignee_state_idx')
      .on(t.assigneeId, t.state)
      .where(sql`state <> 'signed_off'`),
    /** Every board read carries `archived_at IS NULL`; this is what serves it. */
    live: index('cards_engagement_live_idx')
      .on(t.engagementId, t.laneId, t.position)
      .where(sql`archived_at IS NULL`),
  }),
);

/**
 * One row per persisted transition, carrying the possession that the state
 * machine reported. `possession` is nullable for exactly one state:
 * `signed_off` accrues to neither party, so the clock stops rather than
 * pretending the agency still holds the ball.
 */
export const stateTransitions = pgTable(
  'state_transitions',
  {
    id: primaryId(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    fromState: cardStateEnum('from_state').notNull(),
    toState: cardStateEnum('to_state').notNull(),
    possession: possessionEnum('possession'),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorContactId: uuid('actor_contact_id').references(() => clientContacts.id, {
      onDelete: 'set null',
    }),
    occurredAt: tstzNow('occurred_at'),
  },
  (t) => ({
    byCard: index('state_transitions_card_occurred_idx').on(t.cardId, t.occurredAt),
  }),
);

export const lanesRelations = relations(lanes, ({ one, many }) => ({
  engagement: one(engagements, { fields: [lanes.engagementId], references: [engagements.id] }),
  cards: many(cards),
}));

export const cardsRelations = relations(cards, ({ one, many }) => ({
  lane: one(lanes, { fields: [cards.laneId], references: [lanes.id] }),
  engagement: one(engagements, { fields: [cards.engagementId], references: [engagements.id] }),
  transitions: many(stateTransitions),
}));
