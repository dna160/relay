/**
 * The negative control's config. Not part of `verify` and not part of `test:db`.
 *
 * `.github/scripts/check-template-determinism-control.mjs` plants a defect in a
 * copy of `src/domain/template/apply.ts`, points `PLANTED` at it, and requires
 * `tests/unit/template-determinism.spec.ts` to go red. Aliasing one module is
 * the whole reason this file exists: the spec under test is the real one,
 * unedited, and only the function beneath it is swapped.
 *
 * A guard that cannot be made to fail on demand has not been shown to work —
 * the standard `check-chunk-purity.mjs --negative-control` is already held to.
 * This one earned it: run against eleven planted defects, the determinism suite
 * caught eight and missed three, and all three were the same shape — a stamp
 * that is wrong the *same way twice* satisfies a comparison between two stamps
 * perfectly. The five assertions in `the stamped graph is what the definition
 * described` exist because of that run.
 *
 * `PLANTED` unset resolves the alias to the empty string, which fails to
 * resolve rather than silently falling through to the real module. That is
 * deliberate: a control that quietly measured the healthy code would report
 * every defect as "survived" and read as a catastrophe, or — with the
 * comparison inverted — as a clean sweep. Neither is a thing anyone should have
 * to debug at 3am.
 */

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/domain\/template\/apply$/, replacement: process.env.PLANTED ?? '' },
      { find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) },
      { find: /^@tests\//, replacement: fileURLToPath(new URL('./tests/', import.meta.url)) },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/unit/template-determinism.spec.ts'],
    reporters: 'default',
  },
});
