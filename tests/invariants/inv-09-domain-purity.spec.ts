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
import { linesMatching, sourceFiles } from './_source';

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

  it('route handlers stay thin — no route file declares business rules', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('app')) {
      if (!/\/route\.tsx?$/.test(file.path)) continue;
      // A route reaching drizzle directly has skipped the domain and the query layer.
      for (const line of linesMatching(file, /\b(db|tx)\s*\.\s*(insert|update|delete)\s*\(/)) {
        offenders.push(`${file.path}: ${line}`);
      }
    }
    expect(offenders, 'route handler wrote to the database directly').toEqual([]);
  });
});
