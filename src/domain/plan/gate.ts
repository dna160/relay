/**
 * The billing gate. Calls `countActiveEngagements()` and does not re-query, and
 * does not carry a `status = 'active'` predicate of its own (INV-8).
 */

import type { Plan } from '@/lib/types';
import { countActiveEngagements, type ActivityRow } from '../engagement/count-active';
import { planLimitReached } from '../errors';
import { limitsFor } from './limits';

export interface PlanGateResult {
  readonly plan: Plan;
  readonly activeCount: number;
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly allowed: boolean;
}

export function evaluatePlanGate(
  plan: Plan,
  rows: readonly ActivityRow[],
  now: Date,
): PlanGateResult {
  const { activeEngagements: limit } = limitsFor(plan);
  const activeCount = countActiveEngagements(rows, now);
  if (limit === null) {
    return { plan, activeCount, limit: null, remaining: null, allowed: true };
  }
  return {
    plan,
    activeCount,
    limit,
    remaining: Math.max(0, limit - activeCount),
    allowed: activeCount < limit,
  };
}

/** Throws `PLAN_LIMIT_REACHED` (402) when the cap is already met. */
export function assertCanOpenEngagement(
  plan: Plan,
  rows: readonly ActivityRow[],
  now: Date,
): PlanGateResult {
  const result = evaluatePlanGate(plan, rows, now);
  if (!result.allowed) {
    throw planLimitReached(
      `The ${plan} plan allows ${String(result.limit)} active engagements. Wrap one, or upgrade.`,
      { plan: result.plan, limit: result.limit, activeCount: result.activeCount },
    );
  }
  return result;
}
