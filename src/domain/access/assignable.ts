/**
 * Who can be handed a card on this project — read out of the permission graph,
 * because the graph is where "belongs to this project" is defined (INV-11).
 *
 * ## Why this is not a query file
 *
 * It reads `project_memberships` and `org_memberships`, and INV-11 says only
 * `src/domain/access/` may. That is not a technicality to be routed around: the
 * alternative shape — a query somewhere else that selects the org's users and
 * calls it "the team" — is a *second* definition of who belongs to a project,
 * sitting next to `resolveAccess()` and free to disagree with it. Assignability
 * follows from membership or it is a fiction the picker maintains on its own.
 *
 * ## Not a permission check
 *
 * Nothing here decides whether the *caller* may do anything. The route has
 * already resolved that. This answers a different question — who are the
 * candidates — and it answers it with the same arithmetic, `resolveAccessFrom`,
 * so that the list cannot contain somebody `resolveAccess()` would deny or omit
 * somebody it would allow.
 *
 * ## `legacyUserId`, and why it is on the way out
 *
 * `cards.assignee_id` references `users`, the v1 table. The account graph is
 * Phase 9's and is not the authority yet, so an account is only assignable
 * today if the backfill gave it a `legacy_user_id` to point at. That is
 * migration debt with a scheduled end: when `cards.assignee_id` moves to
 * `accounts` (Phase 11's rename window at the earliest), this projection drops
 * the column and nothing else here changes.
 */

import { and, eq, isNotNull, or, sql } from 'drizzle-orm';
import {
  accounts,
  engagements,
  organizations,
  orgMemberships,
  projectMemberships,
} from '@/db/schema';
import type { Executor } from '@/db/types';
import { notVisible } from '../errors';
import { resolveAccessFrom } from './resolve-access';
import { canHoldAssignment, isOrgRole, isProjectRole, type AccessVia, type ProjectRole } from './roles';

export interface AssignableAccount {
  readonly accountId: string;
  /** Null for an account created after the migration. Not assignable yet. */
  readonly legacyUserId: string | null;
  readonly name: string | null;
  readonly email: string;
  readonly role: ProjectRole;
  readonly via: AccessVia;
}

/**
 * Every account the graph says can be handed a card on this project.
 *
 * Two statements rather than one. The org id and the D3 switch have to come
 * from the project being asked about — never from a session (ADR-021 §4) — and
 * driving the second statement from `accounts` is what lets both membership
 * lookups ride their `account_id` indexes instead of a scan.
 */
export async function listAssignableAccounts(
  exec: Executor,
  projectId: string,
): Promise<AssignableAccount[]> {
  const projectRows = await exec
    .select({
      orgId: engagements.orgId,
      derives: organizations.orgRolesDeriveProjectAccess,
    })
    .from(engagements)
    .innerJoin(organizations, eq(organizations.id, engagements.orgId))
    .where(eq(engagements.id, projectId))
    .limit(1);

  const project = projectRows[0];
  // A project that does not exist and one the caller cannot see are the same
  // answer everywhere else in this directory; they are the same answer here.
  if (!project) throw notVisible('Engagement not found');

  const rows = await exec
    .select({
      accountId: accounts.id,
      legacyUserId: accounts.legacyUserId,
      name: accounts.name,
      email: accounts.primaryEmail,
      projectRole: projectMemberships.role,
      orgRole: orgMemberships.role,
    })
    .from(accounts)
    .leftJoin(
      projectMemberships,
      and(
        eq(projectMemberships.accountId, accounts.id),
        eq(projectMemberships.projectId, projectId),
      ),
    )
    .leftJoin(
      orgMemberships,
      and(eq(orgMemberships.accountId, accounts.id), eq(orgMemberships.orgId, project.orgId)),
    )
    .where(
      or(
        isNotNull(projectMemberships.accountId),
        isNotNull(orgMemberships.accountId),
      ),
    )
    .orderBy(sql`lower(coalesce(${accounts.name}, ${accounts.primaryEmail}))`);

  const out: AssignableAccount[] = [];
  for (const row of rows) {
    const resolved = resolveAccessFrom(
      isProjectRole(row.projectRole) ? row.projectRole : null,
      isOrgRole(row.orgRole) ? row.orgRole : null,
      project.derives,
    );
    // Deny is deny. A null role never becomes a candidate, and there is no
    // branch below that could give it one (ADR-022).
    if (resolved.role === null || resolved.via === null) continue;
    if (!canHoldAssignment(resolved.role)) continue;

    out.push({
      accountId: row.accountId,
      legacyUserId: row.legacyUserId,
      name: row.name,
      email: row.email,
      role: resolved.role,
      via: resolved.via,
    });
  }
  return out;
}
