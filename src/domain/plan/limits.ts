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

/**
 * What an org gets when its `plan` column holds a string this code does not
 * know — a plan renamed in the database ahead of a deploy, an operator's
 * `update organizations set plan = 'solo'`, a row restored from a backup taken
 * on a later version. `organizations.plan` is a bare `text` column with no
 * CHECK, so this is reachable without anybody writing a bug.
 *
 * Without it, `PLAN_LIMITS[plan]` is `undefined` and the very next property
 * read is a `TypeError`. That fails in the worst place available:
 * `retentionDatesFor()` is how an engagement gets its `archive_at` and
 * `purge_at`, so a wrap 500s, the dates are never written, and the engagement
 * silently drops out of the retention timeline for good.
 *
 * The two directions are not symmetrical, so they are chosen separately:
 *
 *   - **Retention fails safe by retaining.** An org we cannot classify has its
 *     content kept, not destroyed. Purge is irreversible (INV-7) and a wrong
 *     guess in the other direction is unrecoverable.
 *   - **Entitlements fail safe by withholding.** The free tier's cap and no
 *     white-labelling, rather than handing out a paid allowance to a row nobody
 *     can price.
 */
const UNKNOWN_PLAN_LIMITS: PlanLimits = {
  activeEngagements: PLAN_LIMITS.free.activeEngagements,
  retainsIndefinitely: true,
  whiteLabel: 'none',
};

export function limitsFor(plan: Plan): PlanLimits {
  const limits = PLAN_LIMITS[plan] as PlanLimits | undefined;
  if (limits) return limits;
  console.warn(
    `[plan] organizations.plan holds an unrecognised value ${JSON.stringify(plan)}; ` +
      'falling back to retain-indefinitely with free-tier entitlements. ' +
      'Nothing will be archived or purged for this org until the value is corrected.',
  );
  return UNKNOWN_PLAN_LIMITS;
}
