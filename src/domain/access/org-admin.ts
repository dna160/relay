/**
 * Who may invite somebody into an organization.
 *
 * ## Why this is not simply `resolveOrgAccess()`
 *
 * Because Phase 9's shadow window is still open, and ADR-023's second decision
 * is that the harness has no flag that returns the new answer. A route that
 * asked the graph and *acted* on it would be exactly that flag, written once
 * rather than switched on — and it would fail in a specific, visible way: on a
 * deployment whose backfill has not run, `org_memberships` is empty and nobody
 * in the product could invite anybody, with a 404 and no explanation.
 *
 * So the shipped answer comes from the v1 session, which is what every other
 * permission surface in the product answers from today, and `resolveOrgAccess()`
 * runs beside it and is compared. This is a new endpoint with no old counterpart
 * to preserve, which makes it the *cheapest* place in the codebase to start
 * exercising the org branch of the graph — the branch ADR-022 warns is the
 * tempting one to reason loosely about.
 *
 * When ADR-021's step 4 deletes the old checks, `shippedAnswer` below goes and
 * `resolveOrgAccess()` becomes the decision, which is a deletion rather than a
 * rewrite.
 *
 * ## v1 had no admin distinction at all
 *
 * `users.role` has existed since Phase 1 and nothing has ever read it for
 * authorization — every member of an agency can reach everything in it. So there
 * is no v1 behaviour to preserve here and the rule is chosen rather than
 * inherited: **admins invite.** `onboardOrganization()` makes the founder an
 * admin, everyone joining by invitation is whatever role the invitation offered,
 * and a `member` cannot widen the organization they were let into.
 */

import { eq } from 'drizzle-orm';
import { accessShadowDisagreements, accounts, users } from '@/db/schema';
import type { Executor } from '@/db/types';
import { notVisible } from '../errors';
import { provisionAccountForUser } from './provision-account';
import { resolveOrgAccess } from './resolve-access';
import { canInviteToOrg, orgRoleForLegacyAgencyRole } from './roles';

/** The v1 session, which is the whole of the shipped check's input. */
export interface InvitingActor {
  readonly legacyUserId: string;
  readonly legacyOrgId: string;
  readonly legacyRole: string;
}

export interface InviterResolution {
  /** `invites.invited_by_account_id`. */
  readonly accountId: string;
}

/**
 * The shipped check: you may invite into the organization you belong to, if
 * your v1 role maps to one that can.
 *
 * A 404 rather than a 403 for both failures, as everywhere else in this
 * codebase — `ERROR_CODES` has no 403 at all, deliberately (API-CONTRACT).
 */
function shippedAnswer(actor: InvitingActor, orgId: string): boolean {
  if (actor.legacyOrgId !== orgId) return false;
  return canInviteToOrg(orgRoleForLegacyAgencyRole(actor.legacyRole));
}

/**
 * Decide, and produce the account id the invite row needs.
 *
 * @throws NOT_VISIBLE when the shipped check denies.
 */
export async function resolveInviter(
  exec: Executor,
  actor: InvitingActor,
  orgId: string,
  now: Date,
): Promise<InviterResolution> {
  if (!shippedAnswer(actor, orgId)) throw notVisible('Not found');

  const accountId = await actingAccountFor(exec, actor, now);

  /**
   * The graph's answer, computed and compared and **not returned**. The shipped
   * answer was `true` — we are past the throw — so any disagreement here is the
   * graph denying something the product allows, which during the shadow window
   * is a row in the ledger rather than a refusal.
   *
   * Wrapped so that failing to compute it cannot fail the request. That is
   * ADR-023's rule 2: a harness that can 500 a route gets removed under
   * pressure, which is precisely when it is most needed.
   */
  await recordOrgDisagreement(exec, actor, orgId, accountId).catch(() => undefined);

  return { accountId };
}

const ENDPOINT = 'POST /api/orgs/[id]/invites';

async function recordOrgDisagreement(
  exec: Executor,
  actor: InvitingActor,
  orgId: string,
  accountId: string,
): Promise<void> {
  const graphRole = await resolveOrgAccess(exec, accountId, orgId);
  const newAllowed = graphRole !== null && canInviteToOrg(graphRole);
  if (newAllowed) return;

  const now = new Date();
  await exec.insert(accessShadowDisagreements).values({
    observedAt: now,
    observedOn: now.toISOString().slice(0, 10),
    endpoint: ENDPOINT,
    decisionPoint: 'org_invite',
    reason: 'old_allowed_new_denied',
    legacyUserId: actor.legacyUserId,
    accountId,
    legacyOrgId: actor.legacyOrgId,
    /**
     * Null: this decision is about an organization and there is no project in
     * it. The column is nullable for exactly this, and a purge that walks by
     * project therefore never sees this row — an org-level diagnostic outlives
     * the projects in the org, as `org_memberships` itself does.
     */
    projectId: null,
    oldAllowed: true,
    newAllowed,
    newRole: graphRole,
    newVia: graphRole === null ? null : 'org',
    input: { endpoint: ENDPOINT, decisionPoint: 'org_invite', orgId, legacyRole: actor.legacyRole },
  });
}

/**
 * The account belonging to the person making the request, provisioned if the
 * backfill never reached them.
 *
 * `invites.invited_by_account_id` is `NOT NULL`, so the inviter needs an
 * account row before an invitation can exist. Provisioning it here is the same
 * stopgap `onboardOrganization()` already takes and for the same reason: a
 * person who signed up after the migration would otherwise log
 * `account_not_backfilled` on every request, which is a coverage gap wearing a
 * resolver bug's clothes during the window that counts them.
 *
 * It grants nothing new. `provisionAccountForUser()` is `ON CONFLICT DO
 * NOTHING` throughout and writes the memberships this person's v1 row already
 * implies — never an upgrade, and never a membership in an org they were not
 * already in.
 */
async function actingAccountFor(
  exec: Executor,
  actor: InvitingActor,
  now: Date,
): Promise<string> {
  const existing = (
    await exec
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.legacyUserId, actor.legacyUserId))
      .limit(1)
  )[0]?.id;
  if (existing) return existing;

  const person = (
    await exec
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, actor.legacyUserId))
      .limit(1)
  )[0];
  if (!person) throw notVisible('Not found');

  const provisioned = await provisionAccountForUser(
    exec,
    {
      legacyUserId: actor.legacyUserId,
      email: person.email,
      name: person.name,
      orgId: actor.legacyOrgId,
      orgRole: orgRoleForLegacyAgencyRole(actor.legacyRole),
    },
    now,
  );
  return provisioned.accountId;
}
