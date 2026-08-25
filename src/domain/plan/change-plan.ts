/**
 * Changing an agency's plan, and what that does to the retention clock.
 *
 * Paid plans null out `archive_at` and `purge_at` entirely (DATA-MODEL). The
 * upgrade direction is uneventful: two columns become null and nothing is ever
 * due again. The **downgrade** direction is the one with a data-loss failure
 * mode, and PHASE-6 states the requirement in one sentence — *a downgrade never
 * purges silently*.
 *
 * Three things make that true, and all three are here rather than in the worker:
 *
 *  1. The recomputed window is **clamped** (`downgradeWindow`). An engagement
 *     quiet for a year would otherwise get a purge date in the past and be
 *     destroyed by the next sweep, minutes after the downgrade, having received
 *     none of its four notices.
 *  2. The downgrade **warns immediately** — the offset-0 notice is written and
 *     due right now, for every affected engagement, to both sides.
 *  3. The purge guard counts four warnings before it destroys anything, so even
 *     if 1 and 2 were both wrong, the purge would refuse rather than proceed.
 *
 * This returns the work to be done rather than doing it: the sends are
 * infrastructure and the domain layer does not reach for a mail client (INV-9).
 */

import { eq } from 'drizzle-orm';
import { engagements, organizations, auditLog } from '@/db/schema';
import type { Executor } from '@/db/types';
import type { Plan } from '@/lib/types';
import { validationFailed } from '../errors';
import {
  DEFAULT_RETENTION,
  downgradeWindow,
  isDowngrade,
  retentionWindow,
  type RetentionPolicy,
} from '../retention/schedule';

export interface PlanChangeRow {
  readonly id: string;
  readonly status: string;
  readonly lastActivityAt: Date;
}

export interface PlanChangeResult {
  readonly from: Plan;
  readonly to: Plan;
  readonly downgraded: boolean;
  /** Engagements whose countdown was written, and where it now lands. */
  readonly rescheduled: readonly {
    engagementId: string;
    archiveAt: Date | null;
    purgeAt: Date | null;
  }[];
  /**
   * Engagements that must be warned **now**, before this function's caller
   * returns. Non-empty only on a downgrade.
   */
  readonly warnNow: readonly string[];
}

/**
 * @throws VALIDATION_FAILED when the plan is unchanged — a no-op that rewrites
 * every retention date is not a no-op, and calling it twice by accident should
 * not move a customer's purge dates.
 */
export async function changePlan(
  exec: Executor,
  input: { orgId: string; to: Plan; actor: string },
  now: Date,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): Promise<PlanChangeResult> {
  const orgRows = await exec
    .select({ plan: organizations.plan })
    .from(organizations)
    .where(eq(organizations.id, input.orgId))
    .limit(1);
  const org = orgRows[0];
  if (!org) throw validationFailed('Organization not found');

  const from = org.plan;
  const to = input.to;
  if (from === to) throw validationFailed(`Already on the ${to} plan`);

  const downgraded = isDowngrade(from, to);

  await exec.update(organizations).set({ plan: to }).where(eq(organizations.id, input.orgId));

  const rows = await exec
    .select({
      id: engagements.id,
      status: engagements.status,
      lastActivityAt: engagements.lastActivityAt,
    })
    .from(engagements)
    .where(eq(engagements.orgId, input.orgId));

  const rescheduled: { engagementId: string; archiveAt: Date | null; purgeAt: Date | null }[] = [];
  const warnNow: string[] = [];

  for (const row of rows) {
    // A purged engagement has no future to schedule; a tombstone is not revived
    // by a billing event.
    if (row.status === 'purged') continue;

    const window = downgraded
      ? downgradeWindow(to, row.lastActivityAt, now, policy)
      : retentionWindow(to, row.lastActivityAt, policy);

    await exec
      .update(engagements)
      .set({ archiveAt: window.archiveAt, purgeAt: window.purgeAt })
      .where(eq(engagements.id, row.id));

    rescheduled.push({
      engagementId: row.id,
      archiveAt: window.archiveAt,
      purgeAt: window.purgeAt,
    });
    if (downgraded && window.purgeAt !== null) warnNow.push(row.id);
  }

  await exec.insert(auditLog).values({
    orgId: input.orgId,
    engagementId: null,
    actor: input.actor,
    action: downgraded ? 'plan.downgraded' : 'plan.changed',
    subjectType: 'organization',
    subjectId: input.orgId,
    metadata: { from, to, rescheduled: rescheduled.length },
    occurredAt: now,
  });

  return { from, to, downgraded, rescheduled, warnNow };
}
