/**
 * INV-9 — Business logic lives in `src/domain/`. Route handlers parse input,
 * call a domain function, and serialise output. Nothing else.
 *
 * Structural, live from Phase 0. The lint config states the same rule; this
 * test is the one that fails CI when someone disables the lint rule inline.
 *
 * Never edit this file to make a build pass.
 */

import { describe, expect, it } from 'vitest';
import { linesMatching, sourceFiles, statementsMatching } from './_source';

/** Domain code takes its dependencies as arguments. It does not import them. */
const FORBIDDEN_IN_DOMAIN = [
  /from\s+['"]next(\/|['"])/,
  /from\s+['"]react(-dom)?['"]/,
  /from\s+['"]server-only['"]/,
  /from\s+['"]@\/db\/client['"]/,
  /from\s+['"]@\/lib\/(auth|storage|email|sse)['"]/,
  /from\s+['"]next-auth/,
  /from\s+['"]pg-boss['"]/,
];

/**
 * Every file under `src/app/` that runs on the server and can write. Exported
 * so the negative tests exercise this exact pattern.
 */
export const SERVER_SURFACE_PATTERN = /\/(route|actions|page|layout)\.tsx?$/;

/** A drizzle write through any executor binding, wrapped or not. */
export const APP_LAYER_WRITE = /\b(db|tx|exec|executor)\s*\.\s*(insert|update|delete)\s*\(/;

describe('INV-9 the domain layer is framework-free', () => {
  it('no file in src/domain imports a framework or an infrastructure client', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('domain')) {
      for (const re of FORBIDDEN_IN_DOMAIN) {
        for (const line of linesMatching(file, re)) offenders.push(`${file.path}: ${line}`);
      }
    }
    expect(offenders, 'src/domain reached for infrastructure').toEqual([]);
  });

  it('no file suppresses the domain-purity lint rule inline', () => {
    const offenders = sourceFiles('domain')
      .filter((f) => /eslint-disable[^\n]*no-restricted-imports/.test(f.text))
      .map((f) => f.path);
    expect(offenders, 'domain purity lint rule disabled inline').toEqual([]);
  });

  /**
   * Everything under `src/app/` that runs on the server and can write.
   *
   * Scanning only `route.ts` was the hole: a server action in `actions.ts` and
   * a server component in `page.tsx` reach the database on exactly the same
   * terms as a route handler, and INV-9 is about the boundary, not about a
   * filename. `_lib/` is included for the same reason — a route that moved its
   * insert one directory sideways has not made the layering true again.
   */
  const SERVER_SURFACE = SERVER_SURFACE_PATTERN;

  it('nothing in the app layer writes to the database directly', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('app')) {
      if (!SERVER_SURFACE.test(file.path)) continue;
      // Statements, not lines: `await db\n  .insert(cards)` is the house style
      // and a line-based scan never sees the two halves together.
      for (const stmt of statementsMatching(
        file,
        APP_LAYER_WRITE,
      )) {
        offenders.push(`${file.path}: ${stmt.slice(0, 160)}`);
      }
    }
    expect(offenders, 'the app layer wrote to the database directly').toEqual([]);
  });

  /**
   * The liveness probe. `GET /api/health` runs `select 1` against the pool on
   * purpose — a Next process boots happily with a wrong `DATABASE_URL` and then
   * 500s every request, so the health check has to touch the database or it
   * checks nothing.
   *
   * It is excluded from the raw-SQL scan below, and that exclusion is paid for
   * by the test after it, which pins the probe to a read with no table in it.
   * An exclusion without that second assertion would be a hole shaped exactly
   * like the thing this invariant forbids.
   */
  const LIVENESS_PROBE = 'src/app/api/health/route.ts';

  it('no file in the app layer raw-SQLs its way around the query layer', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('app')) {
      if (!SERVER_SURFACE.test(file.path)) continue;
      if (file.path === LIVENESS_PROBE) continue;
      for (const stmt of statementsMatching(
        file,
        /\b(execute|query)\s*\(\s*sql`|INSERT\s+INTO|UPDATE\s+"?\w+"?\s+SET|DELETE\s+FROM/i,
      )) {
        offenders.push(`${file.path}: ${stmt.slice(0, 160)}`);
      }
    }
    expect(offenders, 'the app layer issued raw SQL').toEqual([]);
  });

  it('the liveness probe reads nothing — that is what buys its exclusion', () => {
    const probe = sourceFiles('app').find((f) => f.path === LIVENESS_PROBE);
    if (!probe) return; // Phase 7 creates it.
    const raw = statementsMatching(probe, /sql`/);
    expect(raw.length, 'the health route grew a second SQL statement').toBe(1);
    expect(
      raw[0],
      'the health probe must stay a table-free liveness check, not a query',
    ).toMatch(/sql`\s*select\s+1\s*`/i);
    expect(probe.text, 'the health route must not write').not.toMatch(
      /\b(insert|update|delete)\s*\(/,
    );
  });
});
