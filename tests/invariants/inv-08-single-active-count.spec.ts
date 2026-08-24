/**
 * INV-8 — Active-project count is one function, `countActiveEngagements()`.
 * Billing limits and expiry scheduling both call it. They may never diverge.
 *
 * Two implementations of "active" will drift, and the drift will bill someone
 * for a workspace it also deleted (ADR-008).
 *
 * UNSKIPPED IN: Phase 1 — `src/domain/engagement/count-active.ts` landed.
 * Never edit this file to make a build pass.
 */

import { describe, expect, it } from 'vitest';
import { except, linesMatching, sourceFiles } from './_source';
import {
  ACTIVE_WINDOW_DAYS,
  countActiveEngagements,
  isEngagementActive,
} from '@/domain/engagement/count-active';
import { evaluatePlanGate } from '@/domain/plan/gate';
import { selectForArchive } from '@/domain/retention/schedule';
import { EVAL_NOW, EXPECTED_ACTIVE_AT_EVAL_NOW, ORG, activityRows, days } from '@tests/fixtures';

/** The one file permitted to define what "active" means. */
const SOLE_DEFINITION = 'src/domain/engagement/count-active.ts';

describe('INV-8 one definition of active', () => {
  it('exports countActiveEngagements from exactly one file', () => {
    const definers = sourceFiles()
      .filter((f) => /export\s+(async\s+)?function\s+countActiveEngagements\b/.test(f.text))
      .map((f) => f.path);
    expect(definers).toEqual([SOLE_DEFINITION]);
  });

  it('is the only file that spells the active-status predicate', () => {
    // A second file comparing status to 'active' has started keeping its own
    // definition, whatever it calls the variable.
    const offenders: string[] = [];
    for (const file of except(sourceFiles('domain'), SOLE_DEFINITION)) {
      const hits = linesMatching(file, /status\s*[=!]==?\s*['"]active['"]|eq\(\s*\w*\.?status\s*,\s*['"]active['"]/);
      for (const line of hits) offenders.push(`${file.path}: ${line}`);
    }
    expect(offenders, 'a second definition of active').toEqual([]);
  });

  it('is the only file that spells the activity window', () => {
    const offenders: string[] = [];
    for (const file of except(sourceFiles('domain'), SOLE_DEFINITION)) {
      const hits = linesMatching(file, /\b30\s*\*\s*(24|DAY)|ACTIVE_WINDOW_DAYS\s*=/);
      for (const line of hits) offenders.push(`${file.path}: ${line}`);
    }
    expect(offenders, 'the 30-day window redefined outside the counter').toEqual([]);
  });

  it('the plan gate imports the counter rather than re-querying', () => {
    const gate = sourceFiles('domain/plan');
    expect(gate.length, 'src/domain/plan is missing').toBeGreaterThan(0);
    const importsCounter = gate.some((f) => /from\s+['"][^'"]*engagement\/count-active['"]/.test(f.text));
    expect(importsCounter, 'the plan gate must import countActiveEngagements').toBe(true);
  });

  it('the expiry scheduler imports the same counter', () => {
    const retention = sourceFiles('domain/retention');
    expect(retention.length, 'src/domain/retention is missing').toBeGreaterThan(0);
    const importsCounter = retention.some((f) =>
      /from\s+['"][^'"]*engagement\/count-active['"]/.test(f.text),
    );
    expect(importsCounter, 'the retention sweep must import the same predicate').toBe(true);
  });

  it('one fixture, two callers, identical answer', () => {
    const rows = activityRows(ORG.free);
    const fromCounter = countActiveEngagements(rows, EVAL_NOW);
    const fromGate = evaluatePlanGate('free', rows, EVAL_NOW).activeCount;
    expect(fromGate).toBe(fromCounter);
    expect(fromCounter).toBe(EXPECTED_ACTIVE_AT_EVAL_NOW[ORG.free]);
  });

  it('activity older than the window makes an engagement inactive for both callers', () => {
    const rows = activityRows(ORG.free);
    const active = rows.filter((r) => isEngagementActive(r, EVAL_NOW)).map((r) => r.id);
    const sweeping = selectForArchive(rows, EVAL_NOW).map((r) => r.id);

    // No engagement may be both billed for and swept, and the stale one — the
    // row whose status still says active — must be in the second set only.
    expect(active.filter((id) => sweeping.includes(id))).toEqual([]);
    expect(sweeping.length).toBeGreaterThan(0);
    expect(active).toHaveLength(EXPECTED_ACTIVE_AT_EVAL_NOW[ORG.free]!);
  });

  it('the two callers move together when the clock does', () => {
    const rows = activityRows(ORG.free);
    for (const offset of [0, 10, 20, 31, 60]) {
      const now = new Date(EVAL_NOW.getTime() + days(offset));
      const counted = countActiveEngagements(rows, now);
      const swept = selectForArchive(rows, now).length;
      const running = rows.filter((r) => r.status === 'active').length;
      // Every running engagement is either counted or being swept. Never both,
      // never neither — that gap is where a billed-and-deleted workspace lives.
      expect(counted + swept, `at +${offset}d`).toBe(running);
    }
  });

  it('uses the window PRD §5.6 names', () => {
    expect(ACTIVE_WINDOW_DAYS).toBe(30);
  });
});
