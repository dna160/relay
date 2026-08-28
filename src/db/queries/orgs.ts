/**
 * Display reads about an organization. Names, for an email.
 *
 * Nothing here decides anything. It is a query file, so INV-11 forbids it from
 * naming a membership table, and it does not need to: who may invite is
 * `resolveInviter()`'s question and has already been answered by the time this
 * runs.
 */

import { eq } from 'drizzle-orm';
import { organizations, users } from '@/db/schema';
import type { Executor } from '@/db/types';
import { notVisible } from '@/domain/errors';

export interface InviteContext {
  readonly orgName: string;
  /** The inviter's name, or their address when they have not set one. */
  readonly inviterLabel: string;
}

export async function loadInviteContext(
  exec: Executor,
  orgId: string,
  legacyUserId: string,
): Promise<InviteContext> {
  const org = (
    await exec
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1)
  )[0];
  if (!org) throw notVisible('Not found');

  const inviter = (
    await exec
      .select({ name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, legacyUserId))
      .limit(1)
  )[0];
  if (!inviter) throw notVisible('Not found');

  return { orgName: org.name, inviterLabel: inviter.name ?? inviter.email };
}

export interface OrgSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly plan: string;
}

/** The organization's own row. Not a permission decision; the route made that. */
export async function loadOrgSummary(exec: Executor, orgId: string): Promise<OrgSummary> {
  const row = (
    await exec
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        plan: organizations.plan,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1)
  )[0];
  if (!row) throw notVisible('Not found');
  return row;
}
