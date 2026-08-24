/**
 * PRD §5.8 — one scaling unit: concurrent active engagements. Everything else
 * on the pricing page is a gate or a cap, never a multiplier.
 */

import type { Plan } from '@/lib/types';

export interface PlanLimits {
  /** Null means unlimited. */
  readonly activeEngagements: number | null;
  /** Paid plans null out `archive_at` and `purge_at` entirely. */
  readonly retainsIndefinitely: boolean;
  readonly whiteLabel: 'none' | 'logo_and_colours' | 'custom_domain';
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { activeEngagements: 3, retainsIndefinitely: false, whiteLabel: 'none' },
  pro: { activeEngagements: 15, retainsIndefinitely: true, whiteLabel: 'logo_and_colours' },
  studio: { activeEngagements: null, retainsIndefinitely: true, whiteLabel: 'custom_domain' },
};

export function limitsFor(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan];
}
