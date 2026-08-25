/**
 * Keeping the graph true for projects created *after* the backfill.
 *
 * The backfill reproduces v1's behaviour for everything that already exists:
 * an `owner` or `admin` derives access to every project in their organization
 * (ADR-022 D3), and a `member`, who derives nothing, is given an explicit
 * `project_memberships` row on every live engagement in their org.
 *
 * A project opened tomorrow has no such row, so without this the graph would
 * start disagreeing with production the first time anyone created an
 * engagement — and the shadow harness would report a growing count that looked
 * like a bug in `resolveAccess()` and was in fact a bug in the backfill's
 * coverage. The seven-day streak has to be measurable, which means the graph
 * has to keep up with the running product, not just catch up with it once.
 *
 * ## Not a permission check
 *
 * This writes membership; it decides nothing. `resolveAccess()` remains the
 * only thing that reads the graph to answer a question about access (INV-11).
 *
 * ## Roles are not upgraded
 *
 * `ON CONFLICT DO NOTHING`: an existing grant is never overwritten by this. A
 * membership someone was deliberately given — or deliberately downgraded to —
 * is not silently rewritten by the act of somebody else opening a project.
 */

import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { accounts, orgMemberships, projectMemberships } from '@/db/schema';
import type { Executor } from '@/db/types';

/**
 * Grant every account whose org role derives nothing an explicit membership on
 * a newly created project.
 *
 * Deliberately narrow: `owner` and `admin` are skipped because they already
 * reach the project through `resolveAccess()`'s org branch, and writing rows
 * for them would create grants that survive an org-role downgrade — the exact
 * revocation hole ADR-021 warns about.
 *
 * @returns the number of rows written, for the caller's log.
 */
export async function grantOrgMembersOnCreate(
  exec: Executor,
  orgId: string,
  projectId: string,
  now: Date,
): Promise<number> {
  const members = await exec
    .select({ accountId: orgMemberships.accountId })
    .from(orgMemberships)
    .innerJoin(accounts, eq(accounts.id, orgMemberships.accountId))
    .where(
      and(
        eq(orgMemberships.orgId, orgId),
        inArray(orgMemberships.role, ['member']),
        // Only accounts that map back to a v1 user. During the shadow window
        // the two systems must describe the same population, and an account
        // with no legacy user is one the old check cannot see either.
        isNotNull(accounts.legacyUserId),
      ),
    );

  if (members.length === 0) return 0;

  const written = await exec
    .insert(projectMemberships)
    .values(
      members.map((m) => ({
        accountId: m.accountId,
        projectId,
        role: 'contributor' as const,
        backfilledAt: now,
      })),
    )
    .onConflictDoNothing()
    .returning({ accountId: projectMemberships.accountId });

  return written.length;
}
