/**
 * Who is in an organization — read here, because "is in" is defined by the
 * permission graph and INV-11 says only this directory may read it.
 *
 * The same argument `assignable.ts` makes in its header, applied one level up:
 * a query somewhere else that selected the org's `users` rows and called it
 * "the team" would be a *second* definition of membership, sitting beside
 * `resolveOrgAccess()` and free to disagree with it.
 *
 * ## The shipped population, with the graph's answer attached
 *
 * The roster is driven from `users`, not from `org_memberships`, and that is
 * the shadow window rather than laziness. `users.org_id` is what the running
 * product answers from — `getSession()` builds an agency session from it and
 * `listAssignableUsers()` enumerates it — so it is the population the person
 * reading this page will actually see everywhere else in the product. Driving
 * from the graph instead would mean that on a deployment whose backfill has not
 * run, the team page shows an empty organization while every other screen shows
 * a full one. That is the failure `GET /api/engagements/:id/members` refused to
 * ship, for the same reason.
 *
 * The graph is left-joined on, and where it disagrees the row still appears —
 * with the role the graph gave it when there is one, and the role the person's
 * v1 row implies when there is not.
 *
 * `accountId` is therefore **nullable**, and its null is informative: it means
 * this person has a `users` row and no `accounts` row, which is either somebody
 * the backfill has not reached or a deployment where it has not run. When
 * ADR-021's step 4 lands, this read drives from `org_memberships` and the column
 * stops being nullable.
 */

import { and, eq } from 'drizzle-orm';
import { accounts, orgMemberships, users } from '@/db/schema';
import type { Executor } from '@/db/types';
import { canInviteToOrg, isOrgRole, orgRoleForLegacyAgencyRole, type OrgRole } from './roles';

export interface OrgMember {
  /**
   * The account graph's row, and **not** the id an assignee picker sends —
   * that one is a `users.id`. Null during the shadow window; see the header.
   */
  readonly accountId: string | null;
  readonly name: string | null;
  readonly email: string;
  readonly role: OrgRole;
  readonly joinedAt: string;
  /** Null for someone invited who has never opened Relay. */
  readonly lastSeenAt: string | null;
}

export async function listOrgMembers(exec: Executor, orgId: string): Promise<OrgMember[]> {
  const rows = await exec
    .select({
      accountId: accounts.id,
      legacyName: users.name,
      accountName: accounts.name,
      email: users.email,
      legacyRole: users.role,
      graphRole: orgMemberships.role,
      joinedAt: users.createdAt,
      lastSeenAt: users.lastSeenAt,
    })
    .from(users)
    .leftJoin(accounts, eq(accounts.legacyUserId, users.id))
    .leftJoin(
      orgMemberships,
      and(eq(orgMemberships.accountId, accounts.id), eq(orgMemberships.orgId, orgId)),
    )
    .where(eq(users.orgId, orgId))
    .orderBy(users.createdAt);

  return rows.map((row) => ({
    accountId: row.accountId,
    name: row.accountName ?? row.legacyName,
    email: row.email,
    // The graph's answer when it has one; otherwise what the v1 row implies.
    // Never a default: `orgRoleForLegacyAgencyRole` is total over its input.
    role: isOrgRole(row.graphRole) ? row.graphRole : orgRoleForLegacyAgencyRole(row.legacyRole),
    joinedAt: row.joinedAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  }));
}

/**
 * What this reader may do, rather than what rank they hold.
 *
 * The obvious field for the team page was `viewerRole: OrgRole`, with the page
 * drawing the invite form when it is not `member` — and that is a permission
 * decision made from a role literal in a React component, which is a second
 * place that knows how the roles rank and can therefore disagree with the
 * resolver. INV-11's scan fails it, correctly. So the capability is computed
 * here, once, and the surface renders what it is told.
 *
 * It stays rendering-only: this decides whether the form is drawn, and
 * `resolveInviter()` decides whether an invitation is accepted. A member who
 * reaches the form by other means is refused by the route.
 */
export function viewerCanInvite(legacyRole: string): boolean {
  return canInviteToOrg(orgRoleForLegacyAgencyRole(legacyRole));
}
