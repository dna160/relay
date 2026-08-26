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
import {
  clientImportGraph,
  except,
  sourceFiles,
  statements,
  statementsMatching,
} from './_source';
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

/**
 * The predicate written as **SQL**: a query asking the database which
 * engagements are active.
 *
 * Exported so `tests/unit/invariant-scans-are-not-escapable.spec.ts` can plant
 * violations against it. Read as statements rather than lines, because
 * `and(\n  eq(engagements.orgId, orgId),\n  eq(engagements.status, 'active'),\n)`
 * is what prettier writes and none of it shares a physical line — the DEFECT-3
 * escape, still open in this file until this round.
 */
export const SQL_ACTIVE_PREDICATE: readonly RegExp[] = [
  // The trailing comma is not decoration: prettier writes
  //   eq(
  //     engagements.status,
  //     'active',
  //   )
  // and the collapsed statement then reads `eq( engagements.status, 'active', )`.
  // Requiring `'active')` missed it, and the planted case in
  // `invariant-scans-are-not-escapable.spec.ts` is what said so.
  /eq\(\s*\w*\.?status\s*,\s*['"`]active['"`]\s*,?\s*\)/,
  /inArray\(\s*\w*\.?status\s*,\s*\[[^\]]*['"`]active['"`]/,
  /status\s*(=|<>|!=)\s*'active'/,
];

/** The predicate written as JavaScript, against a row already loaded. */
export const JS_ACTIVE_PREDICATE = /status\s*[=!]==?\s*['"`]active['"`]/;

/**
 * `src/db/queries/attention.ts` — three SQL predicates on
 * `engagements.status = 'active'`.
 *
 * **A sanctioned exclusion, not an endorsement.** See DEFECT-16. What it means
 * there is `isRunning()` — "not archived, not purged" — which is a real and
 * different question from PRD §5.6's *active*, and an attention list scoped the
 * other way would hide exactly the engagement that has gone quiet. So the
 * behaviour is defensible and the spelling is not: `src/db/queries/retention.ts`
 * asks the same question and deliberately writes no such predicate, loading
 * rows and asking the counter instead.
 *
 * The exclusion is paid for by two tests below, not by this comment, and
 * following DEFECT-6's lesson the payment does not iterate this same array —
 * an entry renamed to a path that no longer exists would otherwise make both
 * the exclusion and its payment vacuous at once.
 */
const SANCTIONED_SQL_PREDICATE: readonly string[] = ['src/db/queries/attention.ts'];

/**
 * Plan-gate call sites still on the deprecated positional form (ADR-021 step 4).
 *
 * A burn-down list, asserted by equality rather than by count: a **new**
 * caller on the old form fails the build, which is the point — Phase 7 adds
 * callers, and the org-scoped form is the one that filters to the organisation
 * itself rather than trusting the rows it was handed.
 */
const POSITIONAL_PLAN_GATE_CALLERS: readonly string[] = ['src/app/(agency)/_lib/plan-usage.ts'];

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
      const hits = statementsMatching(file, JS_ACTIVE_PREDICATE);
      for (const line of hits) offenders.push(`${file.path}: ${line}`);
    }
    expect(offenders, 'a second definition of active').toEqual([]);
  });

  it('is the only file that spells the activity window', () => {
    const offenders: string[] = [];
    for (const file of except(sourceFiles('domain'), SOLE_DEFINITION)) {
      const hits = statementsMatching(file, /\b30\s*\*\s*(24|DAY)|ACTIVE_WINDOW_DAYS\s*=/);
      for (const line of hits) offenders.push(`${file.path}: ${line}`);
    }
    expect(offenders, 'the 30-day window redefined outside the counter').toEqual([]);
  });

  /* ---------------------------------------------------------------------- */
  /* The scan's reach, widened. Phase 7 is why.                              */
  /*                                                                          */
  /* Until this round the two scans above read `sourceFiles('domain')` and    */
  /* nothing else, so the invariant claimed "one definition of active in this  */
  /* codebase" while looking at one eighth of it. `src/db/queries/`,          */
  /* `src/workers/` and `src/app/api/` were all invisible — and a definition   */
  /* of active that matters to billing is far more likely to be written as a   */
  /* `WHERE` clause in a query file than as a comparison in the domain.        */
  /*                                                                          */
  /* Phase 7 makes it urgent rather than theoretical: stamping creates an      */
  /* engagement, so it passes through `assertCanOpenEngagement`, and the       */
  /* templates surface adds a query file and two routes to a layer no scan was */
  /* reading. Widening it found one pre-existing offender (DEFECT-16).        */
  /* ---------------------------------------------------------------------- */

  it('no query anywhere in src asks the database which engagements are active', () => {
    const offenders: string[] = [];
    for (const file of except(sourceFiles(), SOLE_DEFINITION, ...SANCTIONED_SQL_PREDICATE)) {
      for (const re of SQL_ACTIVE_PREDICATE) {
        for (const hit of statementsMatching(file, re)) offenders.push(`${file.path}: ${hit}`);
      }
    }
    expect(
      offenders,
      'a SQL predicate on engagement status is a second definition of active, ' +
        'whatever the surrounding function is called. Load the rows and ask ' +
        'countActiveEngagements() — src/db/queries/retention.ts is the worked example.',
    ).toEqual([]);
  });

  it('every sanctioned exclusion names a file that exists', () => {
    // DEFECT-6: an exclusion list that names a renamed file goes on excluding a
    // path nobody has, and the scan is quietly narrower than it reads.
    const paths = new Set(sourceFiles().map((f) => f.path));
    for (const path of SANCTIONED_SQL_PREDICATE) {
      expect(paths.has(path), `${path} is excluded from the INV-8 scan and does not exist`).toBe(
        true,
      );
    }
  });

  it('the sanctioned exclusion cannot reach the billing gate or the sweep', () => {
    // The payment for the exclusion, and deliberately by *reachability* rather
    // than by spelling — spelling is the half that can be renamed. Whatever
    // `attention.ts` means by active, it may never become the number the plan
    // limit is checked against or the set the retention sweep archives.
    const { modules } = clientImportGraph(['domain/plan', 'domain/retention']);
    for (const path of SANCTIONED_SQL_PREDICATE) {
      expect(
        [...modules.keys()],
        `${path} is reachable from the billing or retention path; its predicate is no longer local`,
      ).not.toContain(path);
    }
  });

  it('every plan-gate call site names the organisation', () => {
    // ADR-021: the plan limit belongs to the organization, not to the person.
    // The deprecated positional form counts exactly the rows it is handed, so a
    // mis-scoped query bills one tenant for another's workspaces — it throws
    // rather than guess when the rows span two orgs, which is a floor and not a
    // fix. Phase 7 adds a caller; this is what stops it landing on the old form.
    const positional: string[] = [];
    for (const file of sourceFiles()) {
      if (file.path.startsWith('src/domain/plan/')) continue; // the overloads themselves
      for (const statement of statements(file)) {
        for (const match of statement.matchAll(
          /\b(assertCanOpenEngagement|evaluatePlanGate)\s*\(/g,
        )) {
          const args = topLevelArgs(statement, match.index + match[0].length - 1);
          if (args !== null && args.length === 3) positional.push(file.path);
        }
      }
    }
    expect([...new Set(positional)].sort(), 'a new caller on the deprecated positional form').toEqual(
      [...POSITIONAL_PLAN_GATE_CALLERS].sort(),
    );
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
    const fromCounter = countActiveEngagements(ORG.free, rows, EVAL_NOW);
    const fromGate = evaluatePlanGate(ORG.free, 'free', rows, EVAL_NOW).activeCount;
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
      const counted = countActiveEngagements(ORG.free, rows, now);
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

/** The top-level arguments of a call whose `(` is at `open`, or null if unbalanced. */
function topLevelArgs(text: string, open: number): string[] | null {
  let depth = 0;
  let start = open + 1;
  const args: string[] = [];
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const tail = text.slice(start, i).trim();
        if (tail !== '' || args.length > 0) args.push(tail);
        return args;
      }
    } else if (ch === ',' && depth === 1) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  return null;
}
