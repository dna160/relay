/**
 * The billing gate. Calls `countActiveEngagements()` and does not re-query, and
 * does not carry a `status = 'active'` predicate of its own (INV-8).
 */

import type { Plan } from '@/lib/types';
import {
  countActiveEngagements,
  type ActivityRow,
  type OrgScopedActivityRow,
} from '../engagement/count-active';
import { planLimitReached } from '../errors';
import { limitsFor } from './limits';

export interface PlanGateResult {
  readonly plan: Plan;
  readonly activeCount: number;
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly allowed: boolean;
}

/**
 * The plan limit is a property of the **organization** (ADR-021): an account
 * belonging to five orgs consumes none of its own quota. So the org id is named
 * here and the counting is scoped to it, rather than trusting whatever rows the
 * caller happened to load.
 *
 * The v1 positional form is kept as a deprecated overload for call sites that
 * have not moved yet; it delegates to the counter's own deprecated form, which
 * throws rather than guess if the rows span more than one organization. Both go
 * at ADR-021 step 4.
 */
export function evaluatePlanGate(
  orgId: string,
  plan: Plan,
  rows: readonly OrgScopedActivityRow[],
  now: Date,
): PlanGateResult;
/** @deprecated Phase 9 shim — pass the organization id. Removed at step 4. */
export function evaluatePlanGate(
  plan: Plan,
  rows: readonly ActivityRow[],
  now: Date,
): PlanGateResult;
export function evaluatePlanGate(
  a: string | Plan,
  b: Plan | readonly ActivityRow[],
  c: readonly ActivityRow[] | Date,
  d?: Date,
): PlanGateResult {
  const orgScoped = typeof c !== 'object' || c instanceof Date ? false : true;
  const plan = (orgScoped ? (b as Plan) : (a as Plan)) as Plan;
  const rows = (orgScoped ? (c as readonly ActivityRow[]) : (b as readonly ActivityRow[]));
  const now = (orgScoped ? (d as Date) : (c as Date));

  const { activeEngagements: limit } = limitsFor(plan);
  const activeCount = orgScoped
    ? countActiveEngagements(a as string, rows as readonly OrgScopedActivityRow[], now)
    : countActiveEngagements(rows, now);
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
  orgId: string,
  plan: Plan,
  rows: readonly OrgScopedActivityRow[],
  now: Date,
): PlanGateResult;
/** @deprecated Phase 9 shim — pass the organization id. Removed at step 4. */
export function assertCanOpenEngagement(
  plan: Plan,
  rows: readonly ActivityRow[],
  now: Date,
): PlanGateResult;
export function assertCanOpenEngagement(
  a: string | Plan,
  b: Plan | readonly ActivityRow[],
  c: readonly ActivityRow[] | Date,
  d?: Date,
): PlanGateResult {
  const orgScoped = !(typeof c !== 'object' || c instanceof Date);
  const plan = (orgScoped ? (b as Plan) : (a as Plan)) as Plan;
  const result = orgScoped
    ? evaluatePlanGate(a as string, plan, c as readonly OrgScopedActivityRow[], d as Date)
    : evaluatePlanGate(plan, b as readonly ActivityRow[], c as Date);
  if (!result.allowed) {
    throw planLimitReached(
      `The ${plan} plan allows ${String(result.limit)} active engagements. Wrap one, or upgrade.`,
      { plan: result.plan, limit: result.limit, activeCount: result.activeCount },
    );
  }
  return result;
}
