/**
 * Opening an engagement: the plan gate and the insert, in one transaction.
 *
 * The gate and the insert cannot be separated. Two people creating the third
 * and fourth engagement on a three-engagement plan at the same moment would
 * otherwise both read "two active" and both be allowed through. The row lock on
 * the organisation is what serialises them.
 */

import { eq } from 'drizzle-orm';
import { engagements, organizations } from '@/db/schema';
import type { Database } from '@/db/types';
import type { TemplateDefinition } from '@/lib/types';
import { grantOrgMembersOnCreate } from '../access/grant-on-create';
import { assertCanOpenEngagement, type PlanGateResult } from '../plan/gate';
import { notVisible } from '../errors';
import { stampTemplate } from '../template/stamp';
import type { StampedGraph } from '../template/apply';
import { createEngagement, type EngagementRow } from './lifecycle';
import type { OrgScopedActivityRow } from './count-active';

export interface OpenEngagementInput {
  orgId: string;
  title: string;
  clientOrgName: string;
  /**
   * The template to stamp, already loaded, already org-scoped, and already
   * parsed — a **value**, not an id to go and fetch.
   *
   * The route resolves it, the same way every other route resolves its subject
   * before calling a domain function (INV-9). That is not only layering: a
   * definition may arrive from somewhere that has no `templates` row behind it
   * at all — Phase 12's confirmed extraction (INV-13) — and an `openEngagement`
   * that took an id could not be given one. `id` is nullable here for exactly
   * that case: a stamped board whose definition was never saved.
   */
  template?: { id: string | null; definition: TemplateDefinition } | null;
  contractedRoundsDefault?: number;
}

export interface OpenEngagementResult {
  engagement: EngagementRow;
  gate: PlanGateResult;
  /** Null when no template was named. Never a partially written board. */
  stamped: { templateId: string | null; laneCount: number; cardCount: number } | null;
}

export async function openEngagement(
  db: Database,
  input: OpenEngagementInput,
  now: Date,
): Promise<OpenEngagementResult> {
  return db.transaction(async (tx) => {
    const orgs = await tx
      .select({ id: organizations.id, plan: organizations.plan })
      .from(organizations)
      .where(eq(organizations.id, input.orgId))
      .for('update')
      .limit(1);
    const org = orgs[0];
    if (!org) throw notVisible('Organisation not found');

    /**
     * Every non-purged engagement, unfiltered by status. The definition of
     * active belongs to `countActiveEngagements()` and to nothing else (INV-8);
     * a `WHERE status = 'active'` here would be a second definition in disguise.
     */
    const rows: OrgScopedActivityRow[] = await tx
      .select({
        status: engagements.status,
        lastActivityAt: engagements.lastActivityAt,
        orgId: engagements.orgId,
      })
      .from(engagements)
      .where(eq(engagements.orgId, input.orgId));

    // The org id is named, not implied by the query above (ADR-021): the plan
    // limit belongs to the organization, and the counter filters to it itself.
    const gate = assertCanOpenEngagement(input.orgId, org.plan, rows, now);

    const template = input.template ?? null;

    /**
     * The template's contracted-rounds default fills the engagement's, but only
     * when the request did not say. Three answers in priority order — the
     * request, the template, the column's `DEFAULT 2` — and never a merge.
     */
    const contractedRoundsDefault =
      input.contractedRoundsDefault ?? template?.definition.contractedRoundsDefault ?? undefined;

    const engagement = await createEngagement(
      tx,
      {
        orgId: input.orgId,
        plan: org.plan,
        title: input.title,
        clientOrgName: input.clientOrgName,
        templateId: template?.id ?? null,
        ...(contractedRoundsDefault === undefined ? {} : { contractedRoundsDefault }),
      },
      now,
    );

    /**
     * Phase 9. Keep the v1.1 permission graph true for a project that did not
     * exist when the backfill ran — see `grantOrgMembersOnCreate`. It grants,
     * it never decides, and it is inside the same transaction as the insert so
     * a project can never exist without the memberships it implies.
     */
    await grantOrgMembersOnCreate(tx, input.orgId, engagement.id, now);

    /**
     * Stamping is inside the same transaction as the insert. A half-stamped
     * board is worse than a failed create: the agency sees a workspace that
     * looks made, is missing three lanes, and gives them nothing to tell them
     * which three. Either the whole workspace exists or none of it does — and
     * because the gate's row lock is still held, it also cannot consume a plan
     * slot on the way to failing.
     */
    let stamped: StampedGraph | null = null;
    if (template) {
      stamped = await stampTemplate(
        tx,
        {
          engagementId: engagement.id,
          definition: template.definition,
          // `createEngagement()` sets `started_at` to `now`; reading it back off
          // the row rather than reusing `now` keeps the relative due dates
          // measured from the engagement's own origin even if that ever stops
          // being true.
          startedAt: engagement.startedAt ?? now,
        },
        now,
      );
    }

    return {
      engagement,
      gate,
      stamped:
        template && stamped
          ? {
              templateId: template.id,
              laneCount: stamped.lanes.length,
              cardCount: stamped.cards.length,
            }
          : null,
    };
  });
}
