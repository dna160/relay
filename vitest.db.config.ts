/**
 * The database-backed suites.
 *
 * Split from `vitest.config.ts` rather than flagged inside it, because
 * `npm run verify` is portable by contract — Phase 0's exit condition is that a
 * clean install verifies on a fresh machine, and CLAUDE.md defines verify as
 * typecheck + lint + unit + invariants with no infrastructure.
 *
 * These suites require a live Postgres and are written to **fail loudly**
 * rather than skip when one is absent. That instinct is right: a failure-mode
 * matrix nobody interrupted proves nothing, and INV-7 is the one invariant that
 * cannot be proved by reading source. So they keep their teeth, and they run
 * here — `npm run test:db`, which CI runs against its Postgres service.
 *
 * INV-11's matrix is the exception that proves the rule, and it is a different
 * kind of skip: it is `describe.skip` in the file, deferred to Phase 9's EXIT
 * because the shadow harness still returns the old permission answer, and
 * `check-invariant-skips.mjs` gates the unskip at Phase 10. It is listed here
 * so that unskipping it is one word rather than one word plus remembering to
 * register the file.
 *
 * The skip is therefore auditable: it is a named config, not a silent branch
 * inside a test that would pass either way.
 */

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@tests': fileURLToPath(new URL('./tests', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: [
      'tests/unit/failure-modes.spec.ts',
      'tests/invariants/inv-07-purge-leaves-certificate.spec.ts',
      'tests/invariants/inv-03-approval-binds-version.db.spec.ts',
      'tests/invariants/inv-11-access-resolution-is-one-function.db.spec.ts',
      'tests/unit/template-stamping.db.spec.ts',
    ],
    /**
     * A database of this run's own, created and dropped by `db-isolation.ts`.
     * Sharing one with the e2e suite meant a seed's TRUNCATE could land between
     * a purge's checkpoints, and the resulting failure looked like a purge bug
     * rather than like two suites in one database.
     */
    globalSetup: ['tests/db-isolation.ts'],
    // Purge kills backends and reruns; concurrency here is a lie about the
    // system under test, and one database cannot serve two of these at once.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: 'default',
  },
});
