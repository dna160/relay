import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** Suites that require a live Postgres. Run by `npm run test:db`, not `verify`. */
const DB_BACKED = [
  'tests/unit/failure-modes.spec.ts',
  'tests/invariants/inv-07-purge-leaves-certificate.spec.ts',
];

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@tests': fileURLToPath(new URL('./tests', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.spec.ts', 'tests/invariants/**/*.spec.ts'],
    /**
     * `npm run verify` is portable by contract — Phase 0's exit condition is
     * that a clean install verifies on a fresh machine, and CLAUDE.md defines
     * it as typecheck + lint + unit + invariants with no infrastructure.
     *
     * These two suites genuinely require a database, and they are written to
     * fail loudly rather than skip when one is absent, which is the right
     * instinct: a failure-mode matrix nobody interrupted proves nothing. So
     * they are excluded from the portable run and executed by `npm run test:db`
     * instead — which CI runs against its Postgres service. The skip is
     * therefore auditable rather than silent.
     */
    exclude: ['tests/e2e/**', ...DB_BACKED],
    reporters: 'default',
  },
});
