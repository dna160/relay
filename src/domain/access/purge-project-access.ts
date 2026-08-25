/**
 * What a purge takes from the permission graph, expressed inside the graph's
 * own domain.
 *
 * ## Why this is not two `delete()` calls in the purge worker
 *
 * It was, briefly, and INV-11's static scan rejected it — correctly. The rule
 * is that no file outside `src/domain/access/` names a membership table,
 * because a file that can reach the graph is a file that can disagree with the
 * resolver. A purge is not a permission decision, but the scan cannot know
 * that, and "the scan cannot know that" is a reason to move the code, not a
 * reason to widen the allowlist. INV-7 needs these rows destroyed and INV-11
 * needs them touched in one place; both are satisfied by putting the delete
 * here and letting the worker call it by name.
 *
 * ## What goes, and what does not
 *
 * `project_memberships` goes: it is the list of exactly who could reach the
 * workspace the certificate says was destroyed. `accounts`, `identities`,
 * `org_memberships`, `teams` and `team_members` stay — the person outlasts the
 * project (DELIVERY-PLAN §IV), and destroying an account would take with it
 * every other project that person is still working on.
 *
 * `access_shadow_disagreements` goes too. It is a diagnostic table, and the
 * temptation is to treat diagnostics as exempt; it carries `project_id`,
 * `account_id`, `legacy_user_id` and a full copy of each decision input, which
 * makes it a per-project record of who tried to reach what. A table that
 * survives a purge holding the ids of a purged project is the kind of thing
 * ADR-022's certificate should never have to explain.
 */

import { eq } from 'drizzle-orm';
import { accessShadowDisagreements, projectMemberships } from '@/db/schema';
import type { Executor } from '@/db/types';

export interface ProjectAccessRowCounts {
  readonly projectMemberships: number;
  readonly accessShadowDisagreements: number;
}

/** For the purge manifest, which is what the certificate's numbers come from. */
export async function countProjectAccessRows(
  exec: Executor,
  projectId: string,
): Promise<ProjectAccessRowCounts> {
  const memberships = await exec
    .select({ accountId: projectMemberships.accountId })
    .from(projectMemberships)
    .where(eq(projectMemberships.projectId, projectId));

  const shadow = await exec
    .select({ id: accessShadowDisagreements.id })
    .from(accessShadowDisagreements)
    .where(eq(accessShadowDisagreements.projectId, projectId));

  return {
    projectMemberships: memberships.length,
    accessShadowDisagreements: shadow.length,
  };
}

/**
 * Destroy this project's edges in the graph. Called from inside the purge's
 * deleting transaction, alongside every other `content` table.
 */
export async function destroyProjectAccess(exec: Executor, projectId: string): Promise<void> {
  await exec.delete(projectMemberships).where(eq(projectMemberships.projectId, projectId));
  await exec
    .delete(accessShadowDisagreements)
    .where(eq(accessShadowDisagreements.projectId, projectId));
}
