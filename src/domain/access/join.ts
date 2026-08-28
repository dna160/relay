/**
 * Writing membership. The only file in the product that does, outside the
 * backfill and the two Phase 9 grant helpers beside it.
 *
 * INV-11 forbids any file outside `src/domain/access/` from naming a membership
 * table, so `redeemInvite()` — which lives in `src/domain/auth/` because it is
 * about a token — cannot write the grant itself. It calls in here. That split
 * is worth more than the indirection costs: the thing that decides an invite is
 * redeemable and the thing that grants access are different files, and the
 * grant takes an already-verified account id as an argument rather than a
 * token.
 *
 * ## The shadow window is the reason this file is longer than it looks
 *
 * Phase 9's exit condition is seven consecutive days at zero disagreements
 * between the shipped v1 checks and `resolveAccess()`. Adding a person to an
 * organization is the first operation in the product that can put the two
 * systems out of step in *both* directions at once, and getting it wrong would
 * show up as a dirty streak that reads like a resolver bug:
 *
 *   - Write only the graph rows and the person is invisible to the running
 *     product. `getSession()` builds an agency session from `users.org_id` and
 *     the assignee picker reads `listAssignableUsers()`, which is every `users`
 *     row in the project's org. They would join an agency and see nothing, and
 *     the ledger would record `assignable_set_differs` on every members read.
 *   - Write only the `users` row and the graph does not have them. Same ledger
 *     entry, other direction.
 *   - Write both, but give an org `member` no project rows, and they are in the
 *     legacy list and absent from the graph's — because ADR-022's D3 says
 *     `member` derives *nothing*. Same ledger entry again.
 *
 * So `joinOrganization()` writes all three: the legacy row, the org membership,
 * and — for the roles that derive nothing — an explicit `project_memberships`
 * row on every non-purged engagement in the org. That last part is the
 * person-shaped mirror of `grantOrgMembersOnCreate()`, which is the
 * project-shaped one, and ADR-023's Decision 1 is the argument for both: the
 * graph has to keep up with the running product, not merely catch up with it
 * once.
 */

import { and, eq, isNull, ne } from 'drizzle-orm';
import { engagements, orgMemberships, projectMemberships, users } from '@/db/schema';
import type { Executor } from '@/db/types';
import { validationFailed } from '../errors';
import { legacyAgencyRoleForOrgRole, type OrgRole, type ProjectRole } from './roles';

export interface JoinOrganizationInput {
  readonly accountId: string;
  /** The v1 row the account maps to. Both halves are written or neither is. */
  readonly legacyUserId: string;
  readonly orgId: string;
  readonly role: OrgRole;
}

export interface JoinResult {
  /** False when the account already held this membership. Nothing was written. */
  readonly granted: boolean;
  /** Explicit project grants written for a role that derives nothing. */
  readonly projectGrants: number;
}

/**
 * Add an account to an organization, in both systems.
 *
 * Idempotent: every insert has a natural key and `ON CONFLICT DO NOTHING`, and
 * a role is never upgraded by a second call. Somebody re-redeeming a second
 * invite to an org they are already in does not get promoted by it.
 *
 * @throws VALIDATION_FAILED when the legacy user already belongs to a
 *   *different* organization. v1's `users.org_id` holds one value and multi-org
 *   membership is ADR-021's migration step 6 — explicitly after the switcher.
 *   Writing the graph row anyway and leaving the legacy row alone would create
 *   an account the graph says is in two orgs and the product says is in one,
 *   which is precisely the disagreement the shadow window exists to count. So
 *   this refuses, loudly, rather than half-succeeding.
 */
export async function joinOrganization(
  exec: Executor,
  input: JoinOrganizationInput,
  now: Date,
): Promise<JoinResult> {
  const legacy = (
    await exec
      .select({ id: users.id, orgId: users.orgId })
      .from(users)
      .where(eq(users.id, input.legacyUserId))
      .limit(1)
  )[0];
  if (!legacy) throw new Error('joinOrganization: no legacy user row');

  if (legacy.orgId !== null && legacy.orgId !== input.orgId) {
    throw validationFailed(
      'That account already belongs to another organisation. Multi-organisation ' +
        'membership arrives with the organisation switcher.',
      { reason: 'already_in_another_organisation' },
    );
  }

  if (legacy.orgId === null) {
    /**
     * `org_id IS NULL` in the predicate, the same guard `onboardOrganization()`
     * uses, so a concurrent join cannot move somebody between agencies.
     */
    await exec
      .update(users)
      .set({ orgId: input.orgId, role: legacyAgencyRoleForOrgRole(input.role) })
      .where(and(eq(users.id, input.legacyUserId), isNull(users.orgId)));
  }

  const written = await exec
    .insert(orgMemberships)
    .values({ accountId: input.accountId, orgId: input.orgId, role: input.role })
    .onConflictDoNothing()
    .returning({ accountId: orgMemberships.accountId });

  const granted = written.length > 0;
  const projectGrants = granted
    ? await grantJoiningMemberOnProjects(exec, input.orgId, input.accountId, input.role, now)
    : 0;

  return { granted, projectGrants };
}

/**
 * The rows a newly joined person needs on projects that already exist.
 *
 * Deliberately narrow, and narrow in exactly the way `grantOrgMembersOnCreate()`
 * is narrow: `owner` and `admin` are skipped because they already reach every
 * project through `resolveAccess()`'s org branch, and writing rows for them
 * would create grants that survive an org-role downgrade — the revocation hole
 * ADR-021 warns about.
 *
 * `contributor` rather than `lead`: the same role the backfill and
 * `grantOrgMembersOnCreate()` write, so that a person who joined yesterday and
 * a person the migration found are indistinguishable in the graph.
 */
export async function grantJoiningMemberOnProjects(
  exec: Executor,
  orgId: string,
  accountId: string,
  role: OrgRole,
  now: Date,
): Promise<number> {
  if (derivesEveryProject(role)) return 0;

  const projects = await exec
    .select({ id: engagements.id })
    .from(engagements)
    .where(and(eq(engagements.orgId, orgId), ne(engagements.status, 'purged')));

  if (projects.length === 0) return 0;

  const written = await exec
    .insert(projectMemberships)
    .values(
      projects.map((p) => ({
        accountId,
        projectId: p.id,
        role: 'contributor' as const,
        backfilledAt: now,
      })),
    )
    .onConflictDoNothing()
    .returning({ accountId: projectMemberships.accountId });

  return written.length;
}

/**
 * Whether this org role already reaches every project by derivation (ADR-022
 * D3), and therefore needs no explicit rows.
 *
 * A `switch`, so a fourth org role is a compile error rather than a silent
 * decision either way. It is not `orgDerivedRole() !== null`: that function
 * also takes the organization's D3 switch, and an org with derivation turned
 * off wants explicit rows for *everybody*, which is a Phase 11 question about a
 * setting no tenant has yet. Answering it here by accident would be worse than
 * leaving it stated.
 */
function derivesEveryProject(role: OrgRole): boolean {
  switch (role) {
    case 'owner':
    case 'admin':
      return true;
    case 'member':
      return false;
  }
}

export interface JoinProjectInput {
  readonly accountId: string;
  readonly projectId: string;
  readonly role: ProjectRole;
}

/**
 * A direct project grant, with no org membership implied (ADR-021 §1: "a
 * project membership does not require an org membership").
 *
 * Reachable from `redeemInvite()` for a `target_kind = 'project'` invite. No
 * route issues one of those today, and that is on purpose rather than by
 * omission — see `issueInvite()`.
 */
export async function joinProject(
  exec: Executor,
  input: JoinProjectInput,
): Promise<JoinResult> {
  const written = await exec
    .insert(projectMemberships)
    .values({ accountId: input.accountId, projectId: input.projectId, role: input.role })
    .onConflictDoNothing()
    .returning({ accountId: projectMemberships.accountId });

  return { granted: written.length > 0, projectGrants: written.length };
}
