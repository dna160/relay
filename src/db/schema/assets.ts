/**
 * Phase 3 — versions, approvals, discussion, and the reference shelf.
 *
 * `asset_versions` is append-only (INV-4). After insert the only columns any
 * code may write are `published_to_client_at` and `superseded_by`, both
 * set-once, and only the purge worker may delete a row.
 *
 * An approval binds to one immutable version and copies that version's sha256
 * at decision time (INV-3, ADR-004). "Approved" has to survive a dispute six
 * months later; approving a mutable card cannot do that, approving a hash can.
 */

import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  index,
  inet,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { primaryId, tstz, tstzNow } from './_shared';
import { DECISIONS } from './enums';
import { cards } from './board';
import { engagements, clientContacts } from './engagements';
import { users } from './tenancy';

export const assetVersions = pgTable(
  'asset_versions',
  {
    id: primaryId(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    /** Computed by the uploader and recorded here. Never recomputed server-side. */
    sha256: char('sha256', { length: 64 }).notNull(),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    uploadedAt: tstzNow('uploaded_at'),
    /** Null until an agency member passes the internal gate. Set once. */
    publishedToClientAt: tstz('published_to_client_at'),
    /** Set once, when a newer version lands. */
    supersededBy: uuid('superseded_by').references((): AnyPgColumn => assetVersions.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    /** version_no is monotonic per card and never reused (INV-4). */
    versionNoPerCard: uniqueIndex('asset_versions_card_version_no_key').on(t.cardId, t.versionNo),
    byCard: index('asset_versions_card_idx').on(t.cardId, t.uploadedAt),
  }),
);

export const approvals = pgTable(
  'approvals',
  {
    id: primaryId(),
    assetVersionId: uuid('asset_version_id')
      .notNull()
      .references(() => assetVersions.id, { onDelete: 'cascade' }),
    decision: text('decision', { enum: DECISIONS }).notNull(),
    decidedByContactId: uuid('decided_by_contact_id').references(() => clientContacts.id, {
      onDelete: 'set null',
    }),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Copied from the version at decision time (INV-3). Never a join. */
    versionSha256: char('version_sha256', { length: 64 }).notNull(),
    note: text('note'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    decidedAt: tstzNow('decided_at'),
  },
  (t) => ({
    noteRequiredOnChanges: check(
      'approvals_changes_require_note',
      sql`${t.decision} = 'approved' OR ${t.note} IS NOT NULL`,
    ),
    exactlyOneDecider: check(
      'approvals_one_decider',
      sql`num_nonnulls(${t.decidedByContactId}, ${t.decidedByUserId}) = 1`,
    ),
    byVersion: index('approvals_version_idx').on(t.assetVersionId, t.decidedAt),
  }),
);

/** Threaded to a version. Never floats forward to the next one (PRD §5.3). */
export const revisionNotes = pgTable(
  'revision_notes',
  {
    id: primaryId(),
    assetVersionId: uuid('asset_version_id')
      .notNull()
      .references(() => assetVersions.id, { onDelete: 'cascade' }),
    authorContactId: uuid('author_contact_id').references(() => clientContacts.id, {
      onDelete: 'set null',
    }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    internal: boolean('internal').notNull().default(false),
    createdAt: tstzNow('created_at'),
  },
  (t) => ({
    byVersion: index('revision_notes_version_idx').on(t.assetVersionId, t.createdAt),
  }),
);

/** Card-level discussion. This is the chat surface's replacement (ADR-011). */
export const comments = pgTable(
  'comments',
  {
    id: primaryId(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    authorContactId: uuid('author_contact_id').references(() => clientContacts.id, {
      onDelete: 'set null',
    }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    internal: boolean('internal').notNull().default(false),
    parentId: uuid('parent_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'cascade',
    }),
    createdAt: tstzNow('created_at'),
  },
  (t) => ({
    byCard: index('comments_card_idx').on(t.cardId, t.createdAt),
  }),
);

/** The shelf. Flat, a handful of labelled groups, no versioning, no tree. */
export const referenceFiles = pgTable(
  'reference_files',
  {
    id: primaryId(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    groupLabel: text('group_label'),
    storageKey: text('storage_key').notNull(),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    clientVisible: boolean('client_visible').notNull().default(true),
    createdAt: tstzNow('created_at'),
  },
  (t) => ({
    byEngagement: index('reference_files_engagement_idx').on(t.engagementId, t.groupLabel),
  }),
);

export const assetVersionsRelations = relations(assetVersions, ({ one, many }) => ({
  card: one(cards, { fields: [assetVersions.cardId], references: [cards.id] }),
  approvals: many(approvals),
  notes: many(revisionNotes),
}));

export const approvalsRelations = relations(approvals, ({ one }) => ({
  version: one(assetVersions, {
    fields: [approvals.assetVersionId],
    references: [assetVersions.id],
  }),
}));
