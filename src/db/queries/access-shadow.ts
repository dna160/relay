/**
 * The read side of the shadow harness, plus the two unscoped locators it needs.
 *
 * AGENCY / OPERATOR ONLY. Nothing here is reachable from `src/app/api/client/**`
 * and nothing here is allowed to become reachable: the locators below
 * deliberately ignore org scoping, which is safe only because their answers
 * never leave the harness.
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  accessShadowDisagreements,
  assetVersions,
  cards,
  engagements,
} from '@/db/schema';
import type { Executor } from '@/db/types';

/* ---------------------------------------------------------------- locators */

/**
 * The engagement a card belongs to, **without** an access check.
 *
 * The harness has to name the object even when the shipped check denied it —
 * otherwise every denial would be logged as `project_unresolved` and the
 * interesting half of the comparison would be missing. The result is written to
 * the disagreement log and returned to no caller.
 */
export async function projectIdForCard(exec: Executor, cardId: string): Promise<string | null> {
  const rows = await exec
    .select({ engagementId: cards.engagementId })
    .from(cards)
    .where(eq(cards.id, cardId))
    .limit(1);
  return rows[0]?.engagementId ?? null;
}

/** As above, for a version. Same rule: harness-only, never serialised out. */
export async function projectIdForVersion(
  exec: Executor,
  versionId: string,
): Promise<string | null> {
  const rows = await exec
    .select({ engagementId: cards.engagementId })
    .from(assetVersions)
    .innerJoin(cards, eq(cards.id, assetVersions.cardId))
    .where(eq(assetVersions.id, versionId))
    .limit(1);
  return rows[0]?.engagementId ?? null;
}

/** Every non-purged engagement the *shipped* check would show this org. */
export async function legacyVisibleProjectIds(exec: Executor, orgId: string): Promise<string[]> {
  const rows = await exec
    .select({ id: engagements.id })
    .from(engagements)
    .where(eq(engagements.orgId, orgId));
  return rows.map((r) => r.id);
}

/* --------------------------------------------------------------- dashboard */

export interface DisagreementDay {
  readonly day: string;
  readonly endpoint: string;
  readonly reason: string;
  readonly count: number;
}

/**
 * The dashboard DELIVERY-PLAN §V asks for: disagreements per endpoint per day.
 *
 * Grouped by reason as well, because "someone lost access" and "someone gained
 * access" are different incidents and a single number that mixes them is a
 * number nobody can act on.
 */
export async function disagreementsByEndpointPerDay(
  exec: Executor,
  sinceDays = 14,
): Promise<DisagreementDay[]> {
  const rows = await exec
    .select({
      day: accessShadowDisagreements.observedOn,
      endpoint: accessShadowDisagreements.endpoint,
      reason: accessShadowDisagreements.reason,
      count: sql<number>`count(*)::int`,
    })
    .from(accessShadowDisagreements)
    .where(
      gte(
        accessShadowDisagreements.observedOn,
        sql`(current_date - ${sql.raw(String(Math.trunc(sinceDays)))} * interval '1 day')::date`,
      ),
    )
    .groupBy(
      accessShadowDisagreements.observedOn,
      accessShadowDisagreements.endpoint,
      accessShadowDisagreements.reason,
    )
    .orderBy(desc(accessShadowDisagreements.observedOn), accessShadowDisagreements.endpoint);

  return rows.map((r) => ({
    day: String(r.day),
    endpoint: r.endpoint,
    reason: r.reason,
    count: r.count,
  }));
}

/**
 * How many whole days, ending yesterday, carry zero disagreements.
 *
 * Today is excluded because it is still accumulating and a partial day at zero
 * is not a day at zero. Counts backwards and stops at the first day that has a
 * row, so a clean streak cannot be manufactured by a quiet weekend in the
 * middle of a noisy fortnight.
 */
export async function cleanDayStreak(exec: Executor, lookbackDays = 60): Promise<number> {
  const rows = await exec
    .select({ day: accessShadowDisagreements.observedOn })
    .from(accessShadowDisagreements)
    .where(
      gte(
        accessShadowDisagreements.observedOn,
        sql`(current_date - ${sql.raw(String(Math.trunc(lookbackDays)))} * interval '1 day')::date`,
      ),
    )
    .groupBy(accessShadowDisagreements.observedOn)
    .orderBy(desc(accessShadowDisagreements.observedOn));

  const dirty = new Set(rows.map((r) => String(r.day)));
  const today = new Date();
  let streak = 0;
  for (let back = 1; back <= lookbackDays; back += 1) {
    const day = new Date(today.getTime() - back * 86_400_000).toISOString().slice(0, 10);
    if (dirty.has(day)) break;
    streak += 1;
  }
  return streak;
}

/** Full rows for one endpoint, newest first — the "now go and read them" view. */
export async function recentDisagreements(
  exec: Executor,
  endpoint: string | null,
  limit = 50,
): Promise<Array<Record<string, unknown>>> {
  const base = exec
    .select({
      observedAt: accessShadowDisagreements.observedAt,
      endpoint: accessShadowDisagreements.endpoint,
      decisionPoint: accessShadowDisagreements.decisionPoint,
      reason: accessShadowDisagreements.reason,
      oldAllowed: accessShadowDisagreements.oldAllowed,
      newAllowed: accessShadowDisagreements.newAllowed,
      newRole: accessShadowDisagreements.newRole,
      newVia: accessShadowDisagreements.newVia,
      projectId: accessShadowDisagreements.projectId,
      input: accessShadowDisagreements.input,
    })
    .from(accessShadowDisagreements);

  const rows = await (endpoint
    ? base.where(and(eq(accessShadowDisagreements.endpoint, endpoint)))
    : base
  )
    .orderBy(desc(accessShadowDisagreements.observedAt))
    .limit(limit);

  return rows as Array<Record<string, unknown>>;
}
