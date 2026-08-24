/**
 * Phase 1 — the agency tenant and its people.
 *
 * `organizations` is the agency. `users` are agency-side members and are never
 * billed per seat (PRD §5.8). Files in `src/db/schema/` are layered so the
 * import graph stays acyclic: tenancy -> engagements -> board -> assets.
 */

import { relations } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { citext, primaryId, tstz, tstzNow } from './_shared';
import { AGENCY_ROLES, PLANS } from './enums';

export const organizations = pgTable('organizations', {
  id: primaryId(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  plan: text('plan', { enum: PLANS }).notNull().default('free'),
  brandLogoKey: text('brand_logo_key'),
  brandPrimary: text('brand_primary'),
  brandDomain: text('brand_domain'),
  createdAt: tstzNow('created_at'),
});

export const users = pgTable(
  'users',
  {
    id: primaryId(),
    /**
     * Nullable for exactly one window: Auth.js `createUser` runs on first
     * magic-link verification, before the person has joined or created an org.
     * Every read path treats a null org as "not yet onboarded", never as
     * "belongs to every org".
     */
    orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    email: citext('email').notNull().unique(),
    name: text('name'),
    /** Auth.js adapter column — not in DATA-MODEL.md. Flagged in the handover. */
    emailVerified: tstz('email_verified'),
    /** Auth.js adapter column — not in DATA-MODEL.md. Flagged in the handover. */
    image: text('image'),
    role: text('role', { enum: AGENCY_ROLES }).notNull().default('member'),
    createdAt: tstzNow('created_at'),
    lastSeenAt: tstz('last_seen_at'),
  },
  (t) => ({
    byOrg: index('users_org_id_idx').on(t.orgId),
  }),
);

export const templates = pgTable('templates', {
  id: primaryId(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Lanes (with visibility), cards, contracted rounds, shelf groups. */
  definition: jsonb('definition').notNull(),
  createdAt: tstzNow('created_at'),
});

/* --------------------------------------------------------------- Auth.js v5 */

/**
 * Adapter tables for Auth.js. They exist because the email provider needs
 * somewhere to keep a one-time token; nothing in the domain layer reads them.
 * `auth_verification_tokens` is reused by the client magic link, which is why
 * the client link needs no table of its own.
 */
export const authAccounts = pgTable(
  'auth_accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
  }),
);

export const authSessions = pgTable('auth_sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: tstz('expires').notNull(),
});

export const authVerificationTokens = pgTable(
  'auth_verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: tstz('expires').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identifier, t.token] }),
  }),
);

export const usersRelations = relations(users, ({ one }) => ({
  organization: one(organizations, {
    fields: [users.orgId],
    references: [organizations.id],
  }),
}));
