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
    createdAt: tstzNow('created_at'),
  },
  (t) => ({
    byEngagement: index('lanes_engagement_position_idx').on(t.engagementId, t.position),
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
    createdAt: tstzNow('created_at'),
    updatedAt: tstzNow('updated_at'),
  },
  (t) => ({
    byLane: index('cards_engagement_lane_position_idx').on(t.engagementId, t.laneId, t.position),
    /** "My cards", which never means the ones already signed off. */
    byAssignee: index('cards_assignee_state_idx')
      .on(t.assigneeId, t.state)
      .where(sql`state <> 'signed_off'`),
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
