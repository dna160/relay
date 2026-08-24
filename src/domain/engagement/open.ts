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
import { assertCanOpenEngagement, type PlanGateResult } from '../plan/gate';
import { notVisible } from '../errors';
import { createEngagement, type EngagementRow } from './lifecycle';
import type { ActivityRow } from './count-active';

export interface OpenEngagementInput {
  orgId: string;
  title: string;
  clientOrgName: string;
  templateId?: string | null;
  contractedRoundsDefault?: number;
}

export interface OpenEngagementResult {
  engagement: EngagementRow;
  gate: PlanGateResult;
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
    const rows: ActivityRow[] = await tx
      .select({ status: engagements.status, lastActivityAt: engagements.lastActivityAt })
      .from(engagements)
      .where(eq(engagements.orgId, input.orgId));

    const gate = assertCanOpenEngagement(org.plan, rows, now);

    const engagement = await createEngagement(
      tx,
      {
        orgId: input.orgId,
        plan: org.plan,
        title: input.title,
        clientOrgName: input.clientOrgName,
        templateId: input.templateId ?? null,
        ...(input.contractedRoundsDefault === undefined
          ? {}
          : { contractedRoundsDefault: input.contractedRoundsDefault }),
      },
      now,
    );

    return { engagement, gate };
  });
}
