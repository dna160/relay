/**
 * Giving one person their rows in the permission graph, on a request path.
 *
 * ## Why this is not `runBackfill()`
 *
 * It was, for about ten minutes. `onboardOrganization()` called the backfill so
 * that somebody signing up after the migration would not spend the shadow
 * window logging `account_not_backfilled` on every request — a dirty streak
 * caused by a coverage gap rather than by a resolver bug, which is the most
 * expensive kind of false signal to have during a migration window.
 *
 * It also made the backfill reachable from `src/app/`, and INV-11's allowlist
 * lets `src/db/backfill/` name membership tables *specifically* because nothing
 * serves it. QA's word for what the backfill does is "writes memberships
 * wholesale, which is correct for a migration script and catastrophic on a
 * request", and the static scan only checks direct imports — so it passed, and
 * it was still wrong. A rule that holds only because the check is shallow is
 * not a rule.
 *
 * So the request path gets a function scoped to one person, in the access
 * domain where membership writes belong, and the bulk script stays a script.
 *
 * ## One shape, two writers
 *
 * The backfill imports `personalOrgSlug` from here and produces rows with the
 * same columns and the same roles. They are two implementations of the same
 * shape — set-based for the migration, row-based for the request — and that is
 * a real cost. It is paid because the alternative is either a per-row loop over
 * every user in the estate or a wholesale write inside an HTTP handler, and
 * both of those are worse in ways that show up in production rather than in
 * review.
 *
 * ## Idempotent
 *
 * Every insert has a natural key and `ON CONFLICT DO NOTHING`. Calling it twice
 * for the same person writes nothing the second time, and it never *upgrades* a
 * role: a membership someone was deliberately given, or deliberately downgraded
 * to, is not rewritten by somebody signing in again.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { accounts, identities, organizations, orgMemberships } from '@/db/schema';
import type { Executor } from '@/db/types';
import type { OrgRole } from './roles';

/**
 * The slug a personal organization gets.
 *
 * Derived from the account id rather than the person's name because
 * `organizations.slug` is globally unique and two people called Sam would
 * otherwise collide on the second one. It is ugly and it is invisible — a
 * personal org has no UI until someone is invited into it (ADR-021 §2) — and
 * Phase 11 owns making it presentable when the switcher lands.
 */
export function personalOrgSlug(accountId: string): string {
  return `personal-${accountId}`;
}

export interface ProvisionAccountInput {
  /** The v1 `users` row this person already has. */
  readonly legacyUserId: string;
  readonly email: string;
  readonly name: string | null;
  /** The agency org they belong to, and in what role. Null before onboarding. */
  readonly orgId: string | null;
  readonly orgRole: OrgRole | null;
}

export interface ProvisionedAccount {
  readonly accountId: string;
  readonly personalOrgId: string;
  readonly created: boolean;
}

export async function provisionAccountForUser(
  exec: Executor,
  input: ProvisionAccountInput,
  now: Date,
): Promise<ProvisionedAccount> {
  const inserted = await exec
    .insert(accounts)
    .values({
      id: uuidv7(),
      primaryEmail: input.email,
      name: input.name,
      legacyUserId: input.legacyUserId,
      backfilledAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: accounts.id });

  const existing =
    inserted[0]?.id ??
    (
      await exec
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.legacyUserId, input.legacyUserId))
        .limit(1)
    )[0]?.id;

  if (!existing) throw new Error('provisionAccountForUser: no account row after insert');
  const accountId = existing;

  // v1 signs in with an Auth.js email magic link, so the address is the
  // provider subject. `email_verified` stays null: this function is not the
  // thing that verified anything, and ADR-021's linking rule needs a real
  // assertion rather than an assumption made during provisioning.
  await exec
    .insert(identities)
    .values({
      id: uuidv7(),
      accountId,
      provider: 'email',
      providerSubject: input.email,
      email: input.email,
      emailVerified: null,
      backfilledAt: now,
    })
    .onConflictDoNothing();

  const personalOrgId = await ensurePersonalOrg(exec, accountId, input.name ?? input.email, now);

  await exec
    .insert(orgMemberships)
    .values({ accountId, orgId: personalOrgId, role: 'owner', backfilledAt: now })
    .onConflictDoNothing();

  if (input.orgId && input.orgRole) {
    await exec
      .insert(orgMemberships)
      .values({ accountId, orgId: input.orgId, role: input.orgRole, backfilledAt: now })
      .onConflictDoNothing();
  }

  return { accountId, personalOrgId, created: inserted.length > 0 };
}

async function ensurePersonalOrg(
  exec: Executor,
  accountId: string,
  name: string,
  now: Date,
): Promise<string> {
  const current = (
    await exec
      .select({ id: accounts.personalOrgId })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1)
  )[0]?.id;
  if (current) return current;

  const slug = personalOrgSlug(accountId);
  const inserted = await exec
    .insert(organizations)
    .values({ id: uuidv7(), name, slug, plan: 'free', kind: 'personal', backfilledAt: now })
    .onConflictDoNothing()
    .returning({ id: organizations.id });

  // A rerun after a partial failure finds the org already there; adopt it
  // rather than leaving the account pointing at nothing.
  const orgId =
    inserted[0]?.id ??
    (
      await exec
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .limit(1)
    )[0]?.id;

  if (!orgId) throw new Error('provisionAccountForUser: no personal org after insert');

  await exec
    .update(accounts)
    .set({ personalOrgId: orgId })
    .where(and(eq(accounts.id, accountId), isNull(accounts.personalOrgId)));

  return orgId;
}
