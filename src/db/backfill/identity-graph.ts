/**
 * Phase 9, step 2 of ADR-021's migration order: fill the permission graph from
 * the system that is already running.
 *
 * Separate from the migration on purpose. A migration is forward-only and
 * applied exactly once (CLAUDE.md); this has to be **idempotent and
 * reversible**, which is Phase 9's exit condition and cannot be both of those
 * things and also a one-shot DDL step.
 *
 * ## What it writes, and why that shape
 *
 * | v1 fact | v1.1 rows |
 * |---|---|
 * | a `users` row | one `accounts` row (`legacy_user_id` links them) |
 * | its email | one `identities` row, provider `email` |
 * | any `auth_accounts` row | one `identities` row for that provider |
 * | every account | one personal `organizations` row, owned by it |
 * | `users.org_id` | one `org_memberships` row |
 * | `users.role = 'admin'` | org role `owner` (first) or `admin` |
 * | `users.role = 'member'` | org role `member` **plus** a `project_memberships` row on every live engagement in that org |
 *
 * That last row is the whole argument of the phase. In v1, being in an
 * organization *is* access to every engagement in it. Under ADR-022's D3 an
 * `owner` or `admin` reproduces that by derivation and needs no row; a `member`
 * derives nothing, so without an explicit grant every non-admin in every agency
 * would silently lose their board on the day the old checks are deleted.
 *
 * Writing explicit rows only for the roles that need them is deliberate. The
 * alternative — a row for everybody — would make the shadow harness agree
 * trivially and prove nothing about the org-derived branch, which is the branch
 * ADR-022 warns is the tempting one to reason loosely about.
 *
 * ## Idempotent
 *
 * Every insert has a natural key and `ON CONFLICT DO NOTHING`. A second run
 * writes zero rows and changes nothing; `runBackfill` returns the counts so
 * that is checkable rather than assumed.
 *
 * ## Reversible
 *
 * Rows written here carry `backfilled_at`. Rows written by the running product
 * do not. `rollbackBackfill()` deletes exactly the first set, which is why the
 * reverse is an inverse rather than a truncate that also takes live data.
 */

import { and, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  accounts,
  authAccounts,
  engagements,
  identities,
  organizations,
  orgMemberships,
  projectMemberships,
  users,
} from '@/db/schema';
import type { Executor } from '@/db/types';
import { personalOrgSlug } from '@/domain/access/provision-account';
import type { OrgRole } from '@/domain/access/roles';

export interface BackfillCounts {
  readonly accounts: number;
  readonly identities: number;
  readonly personalOrgs: number;
  readonly orgMemberships: number;
  readonly projectMemberships: number;
}

export const NO_ROWS: BackfillCounts = {
  accounts: 0,
  identities: 0,
  personalOrgs: 0,
  orgMemberships: 0,
  projectMemberships: 0,
};

function total(counts: BackfillCounts): number {
  return (
    counts.accounts +
    counts.identities +
    counts.personalOrgs +
    counts.orgMemberships +
    counts.projectMemberships
  );
}

export function isEmpty(counts: BackfillCounts): boolean {
  return total(counts) === 0;
}

/**
 * Re-exported, not redefined. `src/domain/access/provision-account.ts` owns the
 * slug because the request path also creates personal orgs, and two rules for
 * naming the same row is how the migration and the product end up disagreeing
 * about which org a person already has.
 */
export { personalOrgSlug } from '@/domain/access/provision-account';

/* ------------------------------------------------------------------ mapping */

/**
 * v1 agency role → v1.1 org role.
 *
 * v1 has two roles and v1.1 has three. The org's first admin becomes its
 * `owner`; later admins become `admin`. Both derive project access under D3, so
 * the distinction changes no permission today — it exists so that Phase 11 has
 * somewhere to hang "the last owner cannot be removed" without a second
 * migration.
 */
export function orgRoleFor(v1Role: string, isFirstAdmin: boolean): OrgRole {
  if (v1Role !== 'admin') return 'member';
  return isFirstAdmin ? 'owner' : 'admin';
}

/* ---------------------------------------------------------------- the steps */

interface LegacyUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: Date | null;
  orgId: string | null;
  role: string;
}

async function legacyUsers(exec: Executor): Promise<LegacyUser[]> {
  return exec
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      emailVerified: users.emailVerified,
      orgId: users.orgId,
      role: users.role,
    })
    .from(users)
    .orderBy(users.createdAt, users.id);
}

/** One account per `users` row. */
async function backfillAccounts(exec: Executor, now: Date): Promise<number> {
  const rows = await exec
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .leftJoin(accounts, eq(accounts.legacyUserId, users.id))
    .where(isNull(accounts.id));

  if (rows.length === 0) return 0;

  const inserted = await exec
    .insert(accounts)
    .values(
      rows.map((u) => ({
        id: uuidv7(),
        primaryEmail: u.email,
        name: u.name,
        legacyUserId: u.id,
        backfilledAt: now,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: accounts.id });

  return inserted.length;
}

/**
 * One identity per provider the person already has.
 *
 * The `email` provider row is synthesised from the address itself: v1 signs in
 * with an Auth.js email magic link, so the address *is* the provider subject.
 * `auth_accounts` rows (there are none in v1 — the config carries only Resend)
 * are copied verbatim so that adding Google later does not have to guess.
 */
async function backfillIdentities(exec: Executor, now: Date): Promise<number> {
  let written = 0;

  const emailRows = await exec
    .select({
      accountId: accounts.id,
      email: accounts.primaryEmail,
      emailVerified: users.emailVerified,
    })
    .from(accounts)
    .innerJoin(users, eq(users.id, accounts.legacyUserId))
    .leftJoin(
      identities,
      and(eq(identities.accountId, accounts.id), eq(identities.provider, 'email')),
    )
    .where(isNull(identities.id));

  if (emailRows.length > 0) {
    const inserted = await exec
      .insert(identities)
      .values(
        emailRows.map((r) => ({
          id: uuidv7(),
          accountId: r.accountId,
          provider: 'email',
          providerSubject: r.email,
          email: r.email,
          emailVerified: r.emailVerified,
          backfilledAt: now,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: identities.id });
    written += inserted.length;
  }

  const oauthRows = await exec
    .select({
      accountId: accounts.id,
      email: accounts.primaryEmail,
      provider: authAccounts.provider,
      subject: authAccounts.providerAccountId,
    })
    .from(authAccounts)
    .innerJoin(accounts, eq(accounts.legacyUserId, authAccounts.userId));

  if (oauthRows.length > 0) {
    const inserted = await exec
      .insert(identities)
      .values(
        oauthRows.map((r) => ({
          id: uuidv7(),
          accountId: r.accountId,
          provider: r.provider,
          providerSubject: r.subject,
          email: r.email,
          // An OAuth subject copied from a v1 adapter row carries no assertion
          // about the address. ADR-021's linking rule needs a *verified* one,
          // so this stays null and the next sign-in is what fills it in.
          emailVerified: null,
          backfilledAt: now,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: identities.id });
    written += inserted.length;
  }

  return written;
}

/** One personal organization per account, and the account's own membership in it. */
async function backfillPersonalOrgs(exec: Executor, now: Date): Promise<number> {
  const rows = await exec
    .select({ id: accounts.id, name: accounts.name, email: accounts.primaryEmail })
    .from(accounts)
    .where(isNull(accounts.personalOrgId));

  let written = 0;
  for (const account of rows) {
    const orgId = uuidv7();
    const inserted = await exec
      .insert(organizations)
      .values({
        id: orgId,
        name: account.name ?? account.email,
        slug: personalOrgSlug(account.id),
        plan: 'free',
        kind: 'personal',
        backfilledAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: organizations.id });

    // A rerun after a partial failure finds the org already there; adopt it
    // rather than leaving the account pointing at nothing.
    const existing =
      inserted[0]?.id ??
      (
        await exec
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.slug, personalOrgSlug(account.id)))
          .limit(1)
      )[0]?.id;

    if (!existing) continue;
    await exec
      .update(accounts)
      .set({ personalOrgId: existing })
      .where(and(eq(accounts.id, account.id), isNull(accounts.personalOrgId)));
    written += inserted.length;
  }

  return written;
}

/** Membership in the personal org, and in the agency org the v1 user belonged to. */
async function backfillOrgMemberships(exec: Executor, now: Date): Promise<number> {
  const values: Array<{
    accountId: string;
    orgId: string;
    role: OrgRole;
    backfilledAt: Date;
  }> = [];

  const personal = await exec
    .select({ accountId: accounts.id, orgId: accounts.personalOrgId })
    .from(accounts)
    .where(isNotNull(accounts.personalOrgId));

  for (const row of personal) {
    if (row.orgId) values.push({ accountId: row.accountId, orgId: row.orgId, role: 'owner', backfilledAt: now });
  }

  const legacy = await legacyUsers(exec);
  const accountByUser = await accountIdsByLegacyUser(exec);
  const firstAdminOfOrg = new Map<string, string>();
  for (const user of legacy) {
    if (user.orgId && user.role === 'admin' && !firstAdminOfOrg.has(user.orgId)) {
      firstAdminOfOrg.set(user.orgId, user.id);
    }
  }

  for (const user of legacy) {
    if (!user.orgId) continue;
    const accountId = accountByUser.get(user.id);
    if (!accountId) continue;
    values.push({
      accountId,
      orgId: user.orgId,
      role: orgRoleFor(user.role, firstAdminOfOrg.get(user.orgId) === user.id),
      backfilledAt: now,
    });
  }

  if (values.length === 0) return 0;
  const inserted = await exec
    .insert(orgMemberships)
    .values(values)
    .onConflictDoNothing()
    .returning({ accountId: orgMemberships.accountId });
  return inserted.length;
}

/**
 * The rows that keep v1's behaviour true for people whose org role derives
 * nothing. See the header — this is the step the phase exists for.
 */
async function backfillProjectMemberships(exec: Executor, now: Date): Promise<number> {
  const legacy = (await legacyUsers(exec)).filter((u) => u.orgId !== null && u.role !== 'admin');
  if (legacy.length === 0) return 0;

  const accountByUser = await accountIdsByLegacyUser(exec);
  const orgIds = [...new Set(legacy.map((u) => u.orgId as string))];

  const live = await exec
    .select({ id: engagements.id, orgId: engagements.orgId })
    .from(engagements)
    .where(and(inArray(engagements.orgId, orgIds), ne(engagements.status, 'purged')));

  const byOrg = new Map<string, string[]>();
  for (const row of live) {
    const list = byOrg.get(row.orgId) ?? [];
    list.push(row.id);
    byOrg.set(row.orgId, list);
  }

  const values: Array<{
    accountId: string;
    projectId: string;
    role: 'contributor';
    backfilledAt: Date;
  }> = [];

  for (const user of legacy) {
    const accountId = accountByUser.get(user.id);
    if (!accountId || !user.orgId) continue;
    for (const projectId of byOrg.get(user.orgId) ?? []) {
      values.push({ accountId, projectId, role: 'contributor', backfilledAt: now });
    }
  }

  if (values.length === 0) return 0;
  const inserted = await exec
    .insert(projectMemberships)
    .values(values)
    .onConflictDoNothing()
    .returning({ accountId: projectMemberships.accountId });
  return inserted.length;
}

async function accountIdsByLegacyUser(exec: Executor): Promise<Map<string, string>> {
  const rows = await exec
    .select({ id: accounts.id, legacyUserId: accounts.legacyUserId })
    .from(accounts)
    .where(isNotNull(accounts.legacyUserId));
  const map = new Map<string, string>();
  for (const row of rows) if (row.legacyUserId) map.set(row.legacyUserId, row.id);
  return map;
}

/* ------------------------------------------------------------------- public */

/**
 * Run every step. Caller supplies the executor; the CLI wraps it in one
 * transaction so that a failure halfway leaves the graph exactly as it was.
 */
export async function runBackfill(exec: Executor, now = new Date()): Promise<BackfillCounts> {
  const accountsWritten = await backfillAccounts(exec, now);
  const identitiesWritten = await backfillIdentities(exec, now);
  const personalOrgsWritten = await backfillPersonalOrgs(exec, now);
  const orgMembershipsWritten = await backfillOrgMemberships(exec, now);
  const projectMembershipsWritten = await backfillProjectMemberships(exec, now);

  return {
    accounts: accountsWritten,
    identities: identitiesWritten,
    personalOrgs: personalOrgsWritten,
    orgMemberships: orgMembershipsWritten,
    projectMemberships: projectMembershipsWritten,
  };
}

/**
 * The exact inverse. Deletes only rows carrying `backfilled_at`, so anything
 * the running product wrote after the backfill survives.
 *
 * Order is FK-safe without relying on cascades to be correct, because a cascade
 * that fires further than intended is precisely the failure this has to not
 * have.
 */
export async function rollbackBackfill(exec: Executor): Promise<BackfillCounts> {
  const projectMembershipsDeleted = await exec
    .delete(projectMemberships)
    .where(isNotNull(projectMemberships.backfilledAt))
    .returning({ accountId: projectMemberships.accountId });

  const orgMembershipsDeleted = await exec
    .delete(orgMemberships)
    .where(isNotNull(orgMemberships.backfilledAt))
    .returning({ accountId: orgMemberships.accountId });

  const identitiesDeleted = await exec
    .delete(identities)
    .where(isNotNull(identities.backfilledAt))
    .returning({ id: identities.id });

  // Release the FK before the org goes, rather than leaning on ON DELETE SET
  // NULL: the point of a reversal is that it does only what it says.
  await exec
    .update(accounts)
    .set({ personalOrgId: null })
    .where(
      sql`${accounts.personalOrgId} IN (
        SELECT ${organizations.id} FROM ${organizations}
        WHERE ${organizations.kind} = 'personal' AND ${organizations.backfilledAt} IS NOT NULL
      )`,
    );

  const accountsDeleted = await exec
    .delete(accounts)
    .where(isNotNull(accounts.backfilledAt))
    .returning({ id: accounts.id });

  const personalOrgsDeleted = await exec
    .delete(organizations)
    .where(and(eq(organizations.kind, 'personal'), isNotNull(organizations.backfilledAt)))
    .returning({ id: organizations.id });

  return {
    accounts: accountsDeleted.length,
    identities: identitiesDeleted.length,
    personalOrgs: personalOrgsDeleted.length,
    orgMemberships: orgMembershipsDeleted.length,
    projectMemberships: projectMembershipsDeleted.length,
  };
}

/**
 * What a run *would* write, without writing it. Every destructive job in this
 * product is dry-runnable and prints a manifest first (DELIVERY-PLAN §I), and
 * the reversal is the destructive one.
 */
export interface BackfillPlan {
  readonly toWrite: BackfillCounts;
  readonly existing: BackfillCounts;
}

export async function planBackfill(exec: Executor): Promise<BackfillPlan> {
  const [
    usersWithoutAccount,
    accountRows,
    identityRows,
    personalOrgRows,
    orgMembershipRows,
    projectMembershipRows,
  ] = await Promise.all([
    exec
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .leftJoin(accounts, eq(accounts.legacyUserId, users.id))
      .where(isNull(accounts.id)),
    exec.select({ n: sql<number>`count(*)::int` }).from(accounts),
    exec.select({ n: sql<number>`count(*)::int` }).from(identities),
    exec
      .select({ n: sql<number>`count(*)::int` })
      .from(organizations)
      .where(eq(organizations.kind, 'personal')),
    exec.select({ n: sql<number>`count(*)::int` }).from(orgMemberships),
    exec.select({ n: sql<number>`count(*)::int` }).from(projectMemberships),
  ]);

  return {
    toWrite: { ...NO_ROWS, accounts: usersWithoutAccount[0]?.n ?? 0 },
    existing: {
      accounts: accountRows[0]?.n ?? 0,
      identities: identityRows[0]?.n ?? 0,
      personalOrgs: personalOrgRows[0]?.n ?? 0,
      orgMemberships: orgMembershipRows[0]?.n ?? 0,
      projectMemberships: projectMembershipRows[0]?.n ?? 0,
    },
  };
}
