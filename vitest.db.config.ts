/**
 * The database-backed suites.
 *
 * Split from `vitest.config.ts` rather than flagged inside it, because
 * `npm run verify` is portable by contract — Phase 0's exit condition is that a
 * clean install verifies on a fresh machine, and CLAUDE.md defines verify as
 * typecheck + lint + unit + invariants with no infrastructure.
 *
 * These two suites require a live Postgres and are written to **fail loudly**
 * rather than skip when one is absent. That instinct is right: a failure-mode
 * matrix nobody interrupted proves nothing, and INV-7 is the one invariant that
 * cannot be proved by reading source. So they keep their teeth, and they run
 * here — `npm run test:db`, which CI runs against its Postgres service.
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
    ],
    // Purge kills backends and reruns; concurrency here is a lie about the
    // system under test, and one database cannot serve two of these at once.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    reporters: 'default',
  },
});
