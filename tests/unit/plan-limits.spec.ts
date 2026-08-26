/**
 * Plan-limit arithmetic — `src/domain/plan/` and the one counter behind it.
 *
 * Three things are being held down here:
 *
 * 1. The limits table still says what PRD §5.8 says. A silent change to a
 *    number on that table is a pricing change and should fail a test, not ship.
 * 2. The gate is off-by-one correct at exactly the limit. This is the assertion
 *    that stops the product selling a fourth workspace on a three-workspace plan.
 * 3. The gate and the retention sweep agree about what "active" means (INV-8).
 *    They agree here by both calling `countActiveEngagements()`; the invariant
 *    suite asserts that there is only one such function to call.
 */

import { describe, expect, it } from 'vitest';
import {
  ACTIVE_WINDOW_DAYS as DOMAIN_ACTIVE_WINDOW_DAYS,
  countActiveEngagements,
  isEngagementActive,
} from '@/domain/engagement/count-active';
import { PLAN_LIMITS as DOMAIN_LIMITS, limitsFor } from '@/domain/plan/limits';
import { assertCanOpenEngagement, evaluatePlanGate } from '@/domain/plan/gate';
import { isDomainError } from '@/domain/errors';
import { selectForArchive } from '@/domain/retention/schedule';
import {
  ACTIVE_WINDOW_DAYS,
  ENGAGEMENT,
  EVAL_NOW,
  EXPECTED_ACTIVE_AT_EVAL_NOW,
  EXPECTED_DUE_FOR_ARCHIVE,
  ORG,
  PLAN_LIMITS,
  activityRows,
  days,
  engagementById,
  type Plan,
} from '@tests/fixtures';

const PLANS: Plan[] = ['free', 'pro', 'studio'];

describe('the limits table matches PRD §5.8', () => {
  it('scales on one unit: concurrent active engagements', () => {
    expect(limitsFor('free').activeEngagements).toBe(3);
    expect(limitsFor('pro').activeEngagements).toBe(15);
    expect(limitsFor('studio').activeEngagements).toBeNull();
  });

  it('agrees with the fixture table the rest of the suite asserts against', () => {
    for (const plan of PLANS) {
      expect(DOMAIN_LIMITS[plan].activeEngagements, plan).toBe(PLAN_LIMITS[plan].activeEngagements);
      expect(DOMAIN_LIMITS[plan].retainsIndefinitely, plan).toBe(
        PLAN_LIMITS[plan].retentionDays === null,
      );
    }
  });

  it('makes retention the paid boundary, not a longer countdown', () => {
    expect(limitsFor('free').retainsIndefinitely).toBe(false);
    expect(limitsFor('pro').retainsIndefinitely).toBe(true);
    expect(limitsFor('studio').retainsIndefinitely).toBe(true);
  });

  it('gates branding by tier', () => {
    expect(limitsFor('free').whiteLabel).toBe('none');
    expect(limitsFor('pro').whiteLabel).toBe('logo_and_colours');
    expect(limitsFor('studio').whiteLabel).toBe('custom_domain');
  });

  it('never charges per seat, on any plan', () => {
    // PRD §5.8: internal seats are unlimited on every tier, deliberately. A seat
    // cap appearing on this table is a pricing change, not a bug fix.
    for (const plan of PLANS) expect(Object.keys(DOMAIN_LIMITS[plan])).not.toContain('seats');
  });

  it('is monotonic — a higher tier never allows less', () => {
    for (let i = 0; i < PLANS.length - 1; i++) {
      const lower = limitsFor(PLANS[i]!).activeEngagements;
      const higher = limitsFor(PLANS[i + 1]!).activeEngagements;
      if (higher === null) continue; // unlimited beats everything
      expect(lower, `${PLANS[i]} allows more than ${PLANS[i + 1]}`).not.toBeNull();
      expect(lower!).toBeLessThanOrEqual(higher);
    }
  });
});

describe('countActiveEngagements (INV-8)', () => {
  it('uses the window PRD §5.6 names', () => {
    expect(DOMAIN_ACTIVE_WINDOW_DAYS).toBe(ACTIVE_WINDOW_DAYS);
    expect(DOMAIN_ACTIVE_WINDOW_DAYS).toBe(30);
  });

  it('counts each org exactly as the fixture declares', () => {
    for (const [orgId, expected] of Object.entries(EXPECTED_ACTIVE_AT_EVAL_NOW)) {
      expect(countActiveEngagements(orgId, activityRows(), EVAL_NOW), orgId).toBe(expected);
    }
  });

  it('does not count a row that is status-active but idle past the window', () => {
    const stale = engagementById(ENGAGEMENT.stale);
    expect(stale.status).toBe('active');
    expect(
      isEngagementActive({ status: stale.status, lastActivityAt: new Date(stale.lastActivityAt) }, EVAL_NOW),
    ).toBe(false);
  });

  it('does not count draft, archived, or purged engagements', () => {
    for (const id of [ENGAGEMENT.draft, ENGAGEMENT.archived, ENGAGEMENT.purged]) {
      const e = engagementById(id);
      expect(
        isEngagementActive({ status: e.status, lastActivityAt: new Date(e.lastActivityAt) }, EVAL_NOW),
        e.title,
      ).toBe(false);
    }
  });

  it('treats the window boundary as exclusive at exactly 30 days', () => {
    const onTheEdge = { status: 'active' as const, lastActivityAt: new Date(EVAL_NOW.getTime() - days(30)) };
    const justInside = { status: 'active' as const, lastActivityAt: new Date(EVAL_NOW.getTime() - days(30) + 1) };
    expect(isEngagementActive(onTheEdge, EVAL_NOW)).toBe(false);
    expect(isEngagementActive(justInside, EVAL_NOW)).toBe(true);
  });

  it('gives the billing gate and the archive sweep complementary answers', () => {
    // The same predicate, read two ways: the gate counts what is active, the
    // sweep takes what is running and no longer active. No engagement can be
    // both, and none can fall through the gap.
    const rows = activityRows(ORG.free);
    const active = rows.filter((r) => isEngagementActive(r, EVAL_NOW));
    const sweeping = selectForArchive(rows, EVAL_NOW);
    expect(active.some((a) => sweeping.some((s) => s.id === a.id))).toBe(false);
    expect(sweeping.map((s) => s.id)).toEqual([...EXPECTED_DUE_FOR_ARCHIVE]);
  });
});

describe('the plan gate', () => {
  const freeRows = activityRows(ORG.free);
  const proRows = activityRows(ORG.pro);
  const studioRows = activityRows(ORG.studio);

  it('reports the free fixture org as exactly at its limit', () => {
    const gate = evaluatePlanGate(ORG.free, 'free', freeRows, EVAL_NOW);
    expect(gate.activeCount).toBe(3);
    expect(gate.limit).toBe(3);
    expect(gate.remaining).toBe(0);
    expect(gate.allowed).toBe(false);
  });

  it('throws 402 PLAN_LIMIT_REACHED at the limit, not one past it', () => {
    try {
      assertCanOpenEngagement(ORG.free, 'free', freeRows, EVAL_NOW);
      expect.unreachable('the fourth engagement on a three-engagement plan must be refused');
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
      if (!isDomainError(error)) return;
      expect(error.code).toBe('PLAN_LIMIT_REACHED');
      expect(error.status).toBe(402);
    }
  });

  it('allows a create while under the limit', () => {
    const gate = evaluatePlanGate(ORG.pro, 'pro', proRows, EVAL_NOW);
    expect(gate.activeCount).toBe(1);
    expect(gate.remaining).toBe(14);
    expect(gate.allowed).toBe(true);
    expect(() => assertCanOpenEngagement(ORG.pro, 'pro', proRows, EVAL_NOW)).not.toThrow();
  });

  it('treats a null limit as unlimited rather than as zero', () => {
    const gate = evaluatePlanGate(ORG.studio, 'studio', studioRows, EVAL_NOW);
    expect(gate.limit).toBeNull();
    expect(gate.remaining).toBeNull();
    expect(gate.allowed).toBe(true);
    // And still unlimited with a hundred open engagements.
    const many = Array.from({ length: 100 }, () => ({
      orgId: ORG.studio,
      status: 'active' as const,
      lastActivityAt: EVAL_NOW,
    }));
    expect(evaluatePlanGate(ORG.studio, 'studio', many, EVAL_NOW).allowed).toBe(true);
  });

  it('counts only what the counter counts, not every row it is handed', () => {
    // The free org's rows include a stale active, a draft, an archived and a
    // purged engagement. Seven rows in, three counted.
    expect(freeRows).toHaveLength(7);
    expect(evaluatePlanGate(ORG.free, 'free', freeRows, EVAL_NOW).activeCount).toBe(3);
  });

  it('the deprecated positional form refuses rows spanning two organizations', () => {
    // Nothing in `src/` or in these suites calls this form any more — it goes at
    // ADR-021 step 4 with the old permission path. Until it does, it is live
    // code with a safety property worth keeping tested: it counts exactly the
    // rows it is handed, so a caller that loaded two tenants' engagements would
    // otherwise bill one for the other's. It throws rather than guess.
    const mixed = [...activityRows(ORG.free), ...activityRows(ORG.pro)];
    expect(() => countActiveEngagements(mixed, EVAL_NOW)).toThrow(/more than one organization/);
    // One org's rows still count, because that is the shape v1 always passed.
    expect(countActiveEngagements(activityRows(ORG.free), EVAL_NOW)).toBe(3);
  });

  it('frees a slot when an engagement goes quiet, without anyone deleting it', () => {
    const later = new Date(EVAL_NOW.getTime() + days(31));
    const gate = evaluatePlanGate(ORG.free, 'free', freeRows, later);
    expect(gate.activeCount).toBe(0);
    expect(gate.allowed).toBe(true);
  });

  it('names the plan and the limit in the error, because the message is the upsell', () => {
    try {
      assertCanOpenEngagement(ORG.free, 'free', freeRows, EVAL_NOW);
      expect.unreachable('should have thrown');
    } catch (error) {
      if (!isDomainError(error)) throw error;
      expect(error.message).toContain('free');
      expect(error.message).toContain('3');
    }
  });

  it('never reports negative remaining when an org is over its limit', () => {
    // A downgrade puts an org over the cap. It keeps its engagements and simply
    // cannot open another (PRD §5.6 — a downgrade never purges silently).
    const overLimit = Array.from({ length: 8 }, () => ({
      orgId: ORG.free,
      status: 'active' as const,
      lastActivityAt: EVAL_NOW,
    }));
    const gate = evaluatePlanGate(ORG.free, 'free', overLimit, EVAL_NOW);
    expect(gate.activeCount).toBe(8);
    expect(gate.remaining).toBe(0);
    expect(gate.allowed).toBe(false);
  });
});

describe.skip('the branding gate', () => {
  /**
   * UNSKIP IN: Phase 7 — Templates, white-label, plan gates. The theming layer
   * and its token allowlist do not exist yet.
   */

  it('ignores brand tokens on a free org rather than rejecting them', () => {
    expect.fail('Phase 7: a free org may store brand_primary; the theme layer does not apply it');
  });

  it('lets white-label override --agency only', () => {
    expect.fail('Phase 7: --client and --breach are not in the themeable allowlist');
  });

  it('cannot theme away a breach warning', () => {
    expect.fail(
      'Phase 7 EXIT: a tenant must not be able to theme away a warning. A brand token map ' +
        'containing --breach or --client is rejected before it reaches the stylesheet.',
    );
  });

  it('recomputes retention dates on downgrade and warns immediately', () => {
    expect.fail(
      'Phase 7: downgrading pro -> free replaces null archive_at/purge_at with ' +
        'last_activity + 30d / + 60d. If those are already past, warn now — never purge on the ' +
        'same tick as the downgrade.',
    );
  });
});
