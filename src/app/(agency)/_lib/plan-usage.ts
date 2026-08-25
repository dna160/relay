/**
 * What the org has spent of its plan, for the portfolio to state.
 *
 * PRD §9 (§5.8 in v1) makes concurrent active engagements the *single* scaling
 * unit, which makes the count the only number in this product a reader can be
 * surprised by. DESIGN-SYSTEM: a limit is stated, never sprung — finding out at
 * a 402 that the fourth workspace is the one too many is the sprung version.
 *
 * ## Where the number comes from
 *
 * From `GET /api/engagements`, as soon as that route ships a `plan` block —
 * `PortfolioPayload['plan']`, the same shape `POST /api/engagements` already
 * returns, evaluated once on the server that also enforces it.
 *
 * Until it does, this module derives the block on the read path, and the one
 * thing it must not do is decide for itself what "active" means. INV-8: there
 * is one definition, `countActiveEngagements()`, and both the billing gate and
 * the expiry scheduler call it. So the derivation calls `evaluatePlanGate()` —
 * not the count directly and never a `status === 'active'` of its own — which
 * is the *same function* the 402 is thrown from. The portfolio and the button
 * therefore cannot disagree; they are one evaluation run twice.
 *
 * The rows are the portfolio's own rows. `loadPortfolio` and `loadActivityRows`
 * select the same set (everything for the org except `purged`), so the derived
 * count equals the gate's count rather than approximating it.
 *
 * ## Why the plan name costs a second request
 *
 * `EngagementSummary` does not carry it and no agency read returns the
 * organization on its own, so the plan is read off an engagement detail —
 * the one place the API already publishes it (`EngagementDetail.plan`). That is
 * one dependent request on a page whose whole read path is otherwise parallel,
 * which is why it is a stopgap and not an arrangement: **delete this file's
 * `derivePlanUsage` the day the route ships the block.** An org with no
 * engagements gets no plan line at all, which is the other reason.
 *
 * Coordinate before touching the seam: back-end is changing
 * `countActiveEngagements()` to take an org id this round. If this call site
 * stops compiling, that is the change arriving, and the answer is to read the
 * API's block rather than to re-derive it against the new signature.
 */

import { evaluatePlanGate } from '@/domain/plan/gate';
import type { PlanUsage } from '@/lib/api-client.agency';
import { agencyApi } from '@/lib/api-client.agency';
import type { EngagementSummary } from '@/lib/types';
import { serverContext } from './server-context';

/**
 * The narrow row the count takes, built from what the portfolio already read.
 * Structural on purpose — nothing here restates the definition of active.
 */
function activityRows(engagements: readonly EngagementSummary[]) {
  return engagements.map((e) => ({
    status: e.status,
    lastActivityAt: new Date(e.lastActivityAt),
  }));
}

export async function derivePlanUsage(
  engagements: readonly EngagementSummary[],
  now: Date,
): Promise<PlanUsage | null> {
  const first = engagements[0];
  if (!first) return null;

  const detail = await agencyApi.engagement(first.id, await serverContext());
  if (!detail.ok) return null;

  const gate = evaluatePlanGate(detail.data.engagement.plan, activityRows(engagements), now);
  return {
    plan: gate.plan,
    activeCount: gate.activeCount,
    limit: gate.limit,
    remaining: gate.remaining,
  };
}
