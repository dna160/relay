/**
 * Phase 9 — the identity and tenancy graph (ADR-021, which supersedes ADR-005).
 *
 * An `account` is a person. Membership rows are the only thing that grants
 * access, and they are independent: a project membership does not require an
 * org membership. That single property is what lets a client-side reviewer sit
 * inside a project in your org with no visibility into the org itself.
 *
 * ## Nothing here is live yet
 *
 * Phase 9 ships the graph, the backfill, `resolveAccess()`, and a shadow
 * harness that runs the new resolution alongside every existing check and
 * *returns the old answer*. No user-visible behaviour changes. The old checks
 * are deleted only after seven consecutive days at zero disagreements.
 *
 * ## `project_id` references `engagements`
 *
 * The v1 code says `engagement`, the v2 PRD says `project`, and they are the
 * same object. The rename is a Phase 11 tidy at the earliest (CLAUDE.md), so
 * the *table* stays `engagements` while the new column takes the name the
 * delivery plan gives it. Read one as the other.
 *
 * ## `backfilled_at`
 *
 * Rows written by `src/db/backfill/identity-graph.ts` carry a timestamp; rows
 * written by the running product do not. The backfill's exit condition is that
 * it is idempotent *and reversible*, and this column is what makes the reverse
 * an exact inverse rather than a truncate that also takes live data with it.
 */

import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext, primaryId, tstz, tstzNow } from './_shared';
import { ORG_ROLES, PROJECT_ROLES } from './enums';
import { engagements } from './engagements';
import { organizations, users } from './tenancy';

/**
 * The person. Never owned by an organization, and never deleted by a purge —
 * the person outlasts the project (DELIVERY-PLAN §IV).
 *
 * `legacy_user_id` is migration provenance: exactly one account per pre-v1.1
 * `users` row, which is what makes the backfill re-runnable. It is nullable
 * because every account created after the migration has no legacy row, and it
 * is `ON DELETE SET NULL` because deleting a v1 user must not delete a person.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: primaryId(),
    primaryEmail: citext('primary_email').notNull().unique(),
    name: text('name'),
    createdAt: tstzNow('created_at'),
    legacyUserId: uuid('legacy_user_id')
      .unique()
      .references(() => users.id, { onDelete: 'set null' }),
    /**
     * ADR-021 §2: every account has a personal organization, so there is no
     * orgless project and no nullable `org_id` branch anywhere downstream. It
     * is nullable only for the instant between the two inserts.
     */
    personalOrgId: uuid('personal_org_id')
      .unique()
      .references(() => organizations.id, { onDelete: 'set null' }),
    backfilledAt: tstz('backfilled_at'),
  },
  (t) => ({
    byLegacyUser: index('accounts_legacy_user_idx').on(t.legacyUserId),
  }),
);

/**
 * One row per auth provider (ADR-021 §3). The vendor never owns the user id, so
 * adding SAML later touches this table and nothing in the permission graph.
 *
 * `email_verified` is the account-linking gate: a provider that does not assert
 * a verified address may not auto-link to an existing account.
 */
export const identities = pgTable(
  'identities',
  {
    id: primaryId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerSubject: text('provider_subject').notNull(),
    email: citext('email').notNull(),
    emailVerified: tstz('email_verified'),
    createdAt: tstzNow('created_at'),
    backfilledAt: tstz('backfilled_at'),
  },
  (t) => ({
    oneSubjectPerProvider: uniqueIndex('identities_provider_subject_key').on(
      t.provider,
      t.providerSubject,
    ),
    byAccount: index('identities_account_idx').on(t.accountId),
  }),
);

/**
 * Membership in an organization. `role` decides whether org membership derives
 * project access at all — see `src/domain/access/resolve-access.ts`, which is
 * the only file permitted to answer that question.
 */
export const orgMemberships = pgTable(
  'org_memberships',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ORG_ROLES }).notNull(),
    createdAt: tstzNow('created_at'),
    backfilledAt: tstz('backfilled_at'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.accountId, t.orgId] }),
    /** DELIVERY-PLAN §IV names this one: it is half of `resolveAccess()`. */
    byAccount: index('org_memberships_account_idx').on(t.accountId),
    byOrg: index('org_memberships_org_idx').on(t.orgId),
  }),
);

/**
 * A team is a convenience for granting, **not an authority** (DELIVERY-PLAN
 * §VII). Granting a team to a project expands to individual
 * `project_memberships` rows carrying `granted_via_team_id`. Two authority
 * paths would mean two ways to get revocation wrong, and revocation is the
 * operation that must never fail.
 */
export const teams = pgTable(
  'teams',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: tstzNow('created_at'),
  },
  (t) => ({
    oneNamePerOrg: uniqueIndex('teams_org_name_key').on(t.orgId, t.name),
    byOrg: index('teams_org_idx').on(t.orgId),
  }),
);

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: tstzNow('created_at'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.accountId] }),
    byAccount: index('team_members_account_idx').on(t.accountId),
  }),
);

/**
 * The direct grant, and the only authority table.
 *
 * `granted_via_team_id` is `ON DELETE CASCADE` deliberately: deleting a team is
 * a revocation, and a grant that outlives the team it came from is a grant
 * nobody can find to remove. A row granted directly carries null here and is
 * untouched by any team operation.
 */
export const projectMemberships = pgTable(
  'project_memberships',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** `engagements.id`. Same object, different vocabulary — see the header. */
    projectId: uuid('project_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    role: text('role', { enum: PROJECT_ROLES }).notNull(),
    grantedViaTeamId: uuid('granted_via_team_id').references(() => teams.id, {
      onDelete: 'cascade',
    }),
    createdAt: tstzNow('created_at'),
    backfilledAt: tstz('backfilled_at'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.accountId, t.projectId] }),
    /** DELIVERY-PLAN §IV names this one: it is the other half of the join. */
    byAccount: index('project_memberships_account_idx').on(t.accountId),
    byProject: index('project_memberships_project_idx').on(t.projectId),
    byTeam: index('project_memberships_team_idx').on(t.grantedViaTeamId),
  }),
);

/**
 * The shadow harness's ledger (DELIVERY-PLAN §V).
 *
 * One row per disagreement between the shipped inline check and
 * `resolveAccess()`. Never read by a request path — this table exists to be
 * counted per endpoint per day, and to hit zero for seven consecutive days
 * before the old checks are deleted.
 *
 * `observed_on` is a plain column with a default rather than a generated one so
 * that the per-day index is a btree over a stored date with no expression
 * immutability question attached to it.
 */
export const accessShadowDisagreements = pgTable(
  'access_shadow_disagreements',
  {
    id: primaryId(),
    observedAt: tstzNow('observed_at'),
    observedOn: date('observed_on').notNull(),
    /** `GET /api/engagements/[id]` — the route, not the URL that was hit. */
    endpoint: text('endpoint').notNull(),
    /** Which check inside the endpoint, when an endpoint has more than one. */
    decisionPoint: text('decision_point').notNull(),
    /** Why old and new differ, classified. See `src/domain/access/shadow.ts`. */
    reason: text('reason').notNull(),
    legacyUserId: uuid('legacy_user_id'),
    accountId: uuid('account_id'),
    legacyOrgId: uuid('legacy_org_id'),
    /** No FK: the row must survive long enough to be counted. */
    projectId: uuid('project_id'),
    oldAllowed: boolean('old_allowed').notNull(),
    newAllowed: boolean('new_allowed').notNull(),
    /** Null means deny. Recorded so the log says *what* the new graph decided. */
    newRole: text('new_role'),
    newVia: text('new_via'),
    /** The full input, so a disagreement is reproducible from the log alone. */
    input: jsonb('input').notNull(),
    createdAt: tstzNow('created_at'),
  },
  (t) => ({
    byDayEndpoint: index('access_shadow_day_endpoint_idx').on(t.observedOn, t.endpoint),
    byProject: index('access_shadow_project_idx').on(t.projectId),
  }),
);

export const accountsRelations = relations(accounts, ({ many }) => ({
  identities: many(identities),
  orgMemberships: many(orgMemberships),
  projectMemberships: many(projectMemberships),
}));

export const orgMembershipsRelations = relations(orgMemberships, ({ one }) => ({
  account: one(accounts, { fields: [orgMemberships.accountId], references: [accounts.id] }),
  organization: one(organizations, {
    fields: [orgMemberships.orgId],
    references: [organizations.id],
  }),
}));

export const projectMembershipsRelations = relations(projectMemberships, ({ one }) => ({
  account: one(accounts, { fields: [projectMemberships.accountId], references: [accounts.id] }),
  engagement: one(engagements, {
    fields: [projectMemberships.projectId],
    references: [engagements.id],
  }),
}));
