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

import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { accounts, identities, organizations, orgMemberships, users } from '@/db/schema';
import type { Executor } from '@/db/types';
import type { VerifiedAddress } from '../auth/signin';
import { orgRoleForLegacyAgencyRole, type OrgRole } from './roles';

/**
 * The provider string for an email-code identity. v1 signed in with an Auth.js
 * magic link and v1.1 with a six-digit code; both prove the same thing about
 * the same address, so both are one provider row rather than two.
 */
export const EMAIL_PROVIDER = 'email';

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
      provider: EMAIL_PROVIDER,
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

/* --------------------------------------------------------------- Phase 10 */

/**
 * A proven address, turned into the rows a session and a membership need.
 *
 * ## The signature is the enforcement
 *
 * It takes a `VerifiedAddress`, and the only thing in this codebase that
 * produces one is `consumeSignin()`. There is no overload taking a bare string,
 * so a caller holding an address it merely read off a request body — or out of
 * an invite — has nothing to pass. ADR-021 §3's linking rule ("a provider login
 * auto-links to an existing account only when the provider asserts a verified
 * address; an unverified one creates a pending link that requires a
 * confirmation") is that same property stated for a provider that does not
 * exist yet: when Google arrives it will not be able to reach this function
 * with an unverified assertion, because it will not be able to construct the
 * argument.
 *
 * ## Why it writes a `users` row
 *
 * Because during Phase 9's shadow window the v1 tables are still the ones that
 * answer. `getSession()` builds an agency session from `users`, and
 * `listAssignableUsers()` reads `users.org_id`. An account with no legacy row is
 * a person the running product cannot see. Phase 11's rename window is where
 * that stops being true; until then, both halves are written together or the
 * two systems describe different populations.
 */
export interface EnsuredAccount {
  readonly accountId: string;
  readonly legacyUserId: string;
  readonly personalOrgId: string;
  /** True when this sign-in created the person rather than finding them. */
  readonly created: boolean;
  /** The v1 org they belong to, or null when they have not joined one. */
  readonly legacyOrgId: string | null;
}

export async function ensureAccountForVerifiedEmail(
  exec: Executor,
  verified: VerifiedAddress,
  name: string | null,
  now: Date,
): Promise<EnsuredAccount> {
  const found = (
    await exec
      .select({
        id: users.id,
        orgId: users.orgId,
        name: users.name,
        role: users.role,
        emailVerified: users.emailVerified,
      })
      .from(users)
      .where(eq(users.email, verified.email))
      .limit(1)
  )[0];

  let legacyUserId: string;
  let legacyOrgId: string | null;
  let legacyRole: string;
  let created = false;

  if (found) {
    legacyUserId = found.id;
    legacyOrgId = found.orgId;
    legacyRole = found.role;
    // Auth.js stamps this on its own verification; ours has to stamp it too, or
    // a person who only ever used the code flow reads as never having proved
    // their address.
    if (found.emailVerified === null) {
      await exec
        .update(users)
        .set({ emailVerified: verified.verifiedAt })
        .where(and(eq(users.id, found.id), isNull(users.emailVerified)));
    }
  } else {
    /**
     * `onConflictDoNothing` on the unique email, then re-read. Two concurrent
     * confirmations of the same fresh address — a double-submitted form, a
     * retried request — would otherwise race to insert and one would 500.
     */
    const inserted = await exec
      .insert(users)
      .values({
        email: verified.email,
        name,
        emailVerified: verified.verifiedAt,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: users.id });

    const row =
      inserted[0] ??
      (
        await exec
          .select({ id: users.id, orgId: users.orgId, role: users.role })
          .from(users)
          .where(eq(users.email, verified.email))
          .limit(1)
      )[0];
    if (!row) throw new Error('ensureAccountForVerifiedEmail: no users row after insert');

    legacyUserId = row.id;
    legacyOrgId = null;
    legacyRole = 'member';
    created = inserted.length > 0;
  }

  const provisioned = await provisionAccountForUser(
    exec,
    {
      legacyUserId,
      email: verified.email,
      name: name ?? found?.name ?? null,
      /**
       * An existing v1 user who already belongs to an agency gets the matching
       * org membership if the backfill never gave them one. Never an upgrade:
       * `provisionAccountForUser` is `ON CONFLICT DO NOTHING` throughout, so a
       * role somebody was deliberately downgraded to is not rewritten by them
       * signing in again.
       */
      orgId: legacyOrgId,
      orgRole: legacyOrgId ? orgRoleForLegacyAgencyRole(legacyRole) : null,
    },
    now,
  );

  /**
   * The verification itself, recorded on the identity rather than only on the
   * session. `provisionAccountForUser` deliberately writes `email_verified:
   * null` — it is not the thing that verified anything — and this is the thing
   * that did.
   */
  await exec
    .update(identities)
    .set({ emailVerified: verified.verifiedAt })
    .where(
      and(
        eq(identities.accountId, provisioned.accountId),
        eq(identities.provider, EMAIL_PROVIDER),
        eq(identities.email, verified.email),
      ),
    );

  return {
    accountId: provisioned.accountId,
    legacyUserId,
    personalOrgId: provisioned.personalOrgId,
    created: created || provisioned.created,
    legacyOrgId,
  };
}

/**
 * Every address this account has actually proved control of.
 *
 * `redeemInvite()`'s address match reads from here and not from
 * `accounts.primary_email`, because a primary email is a display field that
 * nothing verified: it is copied from whatever created the account. An
 * `identities` row with a non-null `email_verified` is the only record in this
 * schema that means "somebody proved this".
 */
export async function verifiedEmailsForAccount(
  exec: Executor,
  accountId: string,
): Promise<string[]> {
  const rows = await exec
    .select({ email: identities.email })
    .from(identities)
    .where(and(eq(identities.accountId, accountId), isNotNull(identities.emailVerified)));
  return rows.map((r) => r.email);
}
