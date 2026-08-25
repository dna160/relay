import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** Suites that require a live Postgres. Run by `npm run test:db`, not `verify`. */
const DB_BACKED = [
  'tests/unit/failure-modes.spec.ts',
  'tests/invariants/inv-07-purge-leaves-certificate.spec.ts',
  'tests/invariants/inv-03-approval-binds-version.db.spec.ts',
  'tests/invariants/inv-11-access-resolution-is-one-function.db.spec.ts',
];

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@tests': fileURLToPath(new URL('./tests', import.meta.url)),
    },
  },
  /**
   * The automatic JSX runtime, so a spec can server-render a primitive.
   *
   * `tsconfig.json` sets `jsx: 'preserve'` — Next owns the transform in the
   * app. esbuild's default here is the *classic* runtime, which emits
   * `React.createElement` and no import, so rendering any `.tsx` primitive
   * throws `React is not defined`. `tests/unit/first-paint.spec.ts` asserts
   * against the bytes the server renderer produces, so it needs the same
   * runtime Next uses rather than a source-level stand-in for it.
   */
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.spec.ts', 'tests/invariants/**/*.spec.ts'],
    /**
     * `npm run verify` is portable by contract — Phase 0's exit condition is
     * that a clean install verifies on a fresh machine, and CLAUDE.md defines
     * it as typecheck + lint + unit + invariants with no infrastructure.
     *
     * The suites in `DB_BACKED` genuinely require a database, and they are
     * written to fail loudly rather than skip when one is absent, which is the
     * right instinct: a failure-mode matrix nobody interrupted proves nothing.
     * So they are excluded from the portable run and executed by
     * `npm run test:db` instead — which CI runs against its Postgres service.
     * The skip is therefore auditable rather than silent.
     *
     * Note which half of INV-11 is *not* here. Its structural scans are
     * portable, live, and run in `verify` from the day the invariant was
     * written; only the resolution matrix needs a database. An invariant that
     * can only be checked where the infrastructure is is an invariant that goes
     * unchecked on most commits.
     */
    exclude: ['tests/e2e/**', ...DB_BACKED],
    reporters: 'default',
  },
});
