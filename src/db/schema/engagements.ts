/**
 * Phase 1 — the aggregate root (ADR-001).
 *
 * Everything hangs off one engagement row: access checks, the billing count,
 * and the purge walk all start here. `last_activity_at` is the single input to
 * both billing and expiry, which is why exactly one function is permitted to
 * interpret it (INV-8).
 */

import { relations, sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, primaryId, tstz, tstzNow } from './_shared';
import { ENGAGEMENT_STATUSES } from './enums';
import { organizations, templates, users } from './tenancy';

export const engagements = pgTable(
  'engagements',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    clientOrgName: text('client_org_name').notNull(),
    title: text('title').notNull(),
    status: text('status', { enum: ENGAGEMENT_STATUSES }).notNull().default('draft'),
    templateId: uuid('template_id').references(() => templates.id, { onDelete: 'set null' }),
    startedAt: tstz('started_at'),
    wrappedAt: tstz('wrapped_at'),
    /** Bumped by any transition, version upload, decision, or note. */
    lastActivityAt: tstzNow('last_activity_at'),
    /** Null on a retaining plan — paid plans null out the countdown entirely. */
    archiveAt: tstz('archive_at'),
    purgeAt: tstz('purge_at'),
    contractedRoundsDefault: integer('contracted_rounds_default').notNull().default(2),
    /**
     * Phase 7. The shelf group labels a template stamped, in the order it named
     * them.
     *
     * A shelf group is a **label on a file**, not an entity (DATA-MODEL: "no
     * versioning, no approval, no tree"), so a group with nothing in it has
     * nowhere else to live — and an empty labelled group is the entire point of
     * stamping one. `loadShelf()` seeds these before it groups the files, which
     * is why "Contract / Brand / Footage" appears on a board the moment it is
     * created rather than after somebody uploads into each.
     *
     * It is on the engagement rather than read back through `template_id`
     * because a definition may arrive from a document with no `templates` row
     * behind it (INV-13), and because renaming a template later must not
     * silently rename the shelves of every workspace it ever stamped.
     */
    shelfGroupLabels: text('shelf_group_labels')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: tstzNow('created_at'),
  },
  (t) => ({
    /** Serves the active count (INV-8). */
    byOrgStatusActivity: index('engagements_org_status_activity_idx').on(
      t.orgId,
      t.status,
      t.lastActivityAt,
    ),
    /** Serves the purge sweep. */
    byPurgeAt: index('engagements_purge_at_idx')
      .on(t.purgeAt)
      .where(sql`status = 'archived'`),
  }),
);

/**
 * Client-side identity, scoped to exactly one engagement (INV-6, ADR-005).
 * There is no global contact row: the same email in two engagements produces
 * two unrelated contacts, and neither session can see the other's work.
 */
export const clientContacts = pgTable(
  'client_contacts',
  {
    id: primaryId(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    name: text('name'),
    verifiedAt: tstz('verified_at'),
    lastSeenAt: tstz('last_seen_at'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: tstzNow('created_at'),
  },
  (t) => ({
    oneContactPerEngagement: uniqueIndex('client_contacts_engagement_email_key').on(
      t.engagementId,
      t.email,
    ),
  }),
);

/**
 * Append-only. Purged with the engagement, except for retention actions, which
 * outlive it so that a deletion can be proved after the fact.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: primaryId(),
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    /** No FK: retention rows must survive the engagement they describe. */
    engagementId: uuid('engagement_id'),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    metadata: jsonb('metadata'),
    occurredAt: tstzNow('occurred_at'),
  },
  (t) => ({
    byEngagement: index('audit_log_engagement_idx').on(t.engagementId, t.occurredAt),
    /**
     * The four retention warnings live here rather than in a table of their own
     * — RUNBOOK §6 triages them with `action = 'retention.warned'` and the
     * runbook is the contract. What an append-only log does not give on its own
     * is idempotency, and the purge guard counts these rows: a sweep that ran
     * twice must not be able to make three warnings look like four.
     *
     * `subject_type` carries the offset (`retention_warning:14`), so one notice
     * per offset per engagement is a database property. Partial, so it
     * constrains nothing else written to this table.
     */
    oneWarningPerOffset: uniqueIndex('audit_log_retention_warning_key')
      .on(t.engagementId, t.subjectType)
      .where(sql`action = 'retention.warned'`),
  }),
);

export const engagementsRelations = relations(engagements, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [engagements.orgId],
    references: [organizations.id],
  }),
  contacts: many(clientContacts),
}));

export const clientContactsRelations = relations(clientContacts, ({ one }) => ({
  engagement: one(engagements, {
    fields: [clientContacts.engagementId],
    references: [engagements.id],
  }),
}));
