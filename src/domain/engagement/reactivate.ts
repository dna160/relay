/**
 * Reactivation — taking an archived engagement back out of the countdown.
 *
 * An archive is read-only, not dead. "We wrapped on Friday and the client came
 * back in March" is a normal thing for an agency, and the product's answer to it
 * has to be one button rather than a support ticket.
 *
 * ## The paywall is a flag, deliberately
 *
 * **PRD §9's reactivation pricing is unresolved** and PHASE-6 says to build the
 * path and leave the paywall behind a flag. `REACTIVATION_PAYWALL` is that flag.
 * It is a constant here rather than an environment variable on purpose: an env
 * var would have to be registered in `.env.example`, the runbook's env table and
 * the deploy topology, which would make an unresolved product question look like
 * a shipped operational lever. When the decision lands, one boolean moves.
 *
 * The plan **limit** still applies either way. That is not the paywall — an
 * agency on a three-workspace plan cannot have four active workspaces however
 * they got there — and `assertCanOpenEngagement` is the one gate that says so
 * (INV-8).
 */

import { eq } from 'drizzle-orm';
import { auditLog, engagements } from '@/db/schema';
import type { Executor } from '@/db/types';
import { isRunning } from './count-active';
import type { Plan } from '@/lib/types';
import { planLimitReached, validationFailed } from '../errors';
import { assertCanOpenEngagement } from '../plan/gate';
import type { ActivityRow } from './count-active';
import { retentionWindow, type RetentionPolicy, DEFAULT_RETENTION } from '../retention/schedule';
import { assertWritable, loadForOrg, type EngagementRow } from './lifecycle';

/**
 * PRD §9, unresolved. `false` ships the reactivation path with no charge; `true`
 * refuses reactivation with a 402 carrying a machine-readable reason, which is
 * the shape a billing flow would hang off.
 */
export const REACTIVATION_PAYWALL = false;

export interface ReactivateInput {
  readonly engagementId: string;
  readonly orgId: string;
  readonly plan: Plan;
  /** For the plan gate. The same rows the billing gate reads (INV-8). */
  readonly activityRows: readonly ActivityRow[];
  readonly actor: string;
}

/**
 * @throws ENGAGEMENT_PURGED (410) when the content is already gone. There is
 * nothing to reactivate: the certificate is the only thing left, and offering a
 * button that appears to undo a purge would be the cruellest affordance in the
 * product.
 */
export async function reactivateEngagement(
  exec: Executor,
  input: ReactivateInput,
  now: Date,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): Promise<EngagementRow> {
  const current = await loadForOrg(exec, input.engagementId, input.orgId);

  if (current.status === 'purged') {
    // `assertWritable` already distinguishes 410 from 423; reuse it rather than
    // spelling the codes a second time.
    assertWritable(current);
  }
  // INV-8: `isRunning` is the one place the active-status predicate is spelled.
  // A second `status === 'active'` here would be a second definition, and two
  // definitions of active drift — which is how a workspace gets billed for and
  // deleted by the same system (ADR-008).
  if (isRunning(current)) {
    throw validationFailed('This engagement is already active');
  }

  if (REACTIVATION_PAYWALL) {
    throw planLimitReached('Reactivating an archived engagement requires a paid reactivation.', {
      reason: 'reactivation_paywall',
      engagementId: input.engagementId,
    });
  }

  // Reactivating consumes a slot from the moment it happens, so the gate the
  // caller would have passed to create it applies here too.
  assertCanOpenEngagement(input.plan, input.activityRows, now);

  const { archiveAt, purgeAt } = retentionWindow(input.plan, now, policy);

  const updated = await exec
    .update(engagements)
    .set({ status: 'active', lastActivityAt: now, archiveAt, purgeAt })
    .where(eq(engagements.id, input.engagementId))
    .returning();

  const row = updated[0];
  if (!row) throw validationFailed('Engagement not found');

  await exec.insert(auditLog).values({
    orgId: input.orgId,
    engagementId: input.engagementId,
    actor: input.actor,
    action: 'engagement.reactivated',
    subjectType: 'engagement',
    subjectId: input.engagementId,
    metadata: { from: current.status },
    occurredAt: now,
  });

  return row;
}
