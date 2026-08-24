/**
 * The accessibility floor at the agency viewport (Desktop Chrome).
 *
 * The twin of `tests/e2e/client/a11y-shell.spec.ts`. `A11Y-ASSERTIONS.md`
 * recommends a copy in each Playwright project because a phone and a desktop
 * are genuinely different grounds — different rendered sizes, different
 * `prefers-reduced-motion` defaults on some platforms, different reflow.
 *
 * Deliberately narrower than the client twin: the target floor here is the
 * WCAG 2.5.8 minimum rather than the stronger client-facing one, and the 360px
 * reflow case belongs to the phone.
 *
 * It navigates to the same shell probe route. That is not an audience claim —
 * these assertions are about the shell, and no agency route is asserted or
 * denied here. `invite-verify-approve.spec.ts` owns the audience claim, at the
 * request level, with `RouteRecorder`.
 */

import { expect, test } from '@playwright/test';
import { MOTION, TARGETS } from '@/styles/a11y-contract';
import {
  PROBE_ROUTE,
  assertContrastOnLivePage,
  assertEveryControlShowsARing,
  assertFocusIsNeverObscured,
  assertLockedTokensAreLocked,
  assertNoInfiniteAnimation,
  assertNoPositiveTabindex,
  assertNothingMoves,
  assertOnlySanctionedKeyframes,
  assertShellLoaded,
  assertTargetsMeetTheFloor,
  assertTokensResolve,
  durationMs,
  durationToken,
} from '../_a11y';

test.beforeEach(async ({ page }) => {
  await page.goto(PROBE_ROUTE);
  await assertShellLoaded(page);
});

for (const mode of ['light', 'dark'] as const) {
  test.describe(`tokens — ${mode}`, () => {
    test.use({ colorScheme: mode });

    test(`every token resolves to its shipped value in ${mode}`, async ({ page }) => {
      await page.goto(PROBE_ROUTE);
      await assertTokensResolve(page, mode);
    });

    test(`every contrast pair holds against the live page in ${mode}`, async ({ page }) => {
      await page.goto(PROBE_ROUTE);
      await assertContrastOnLivePage(page, mode);
    });
  });
}

test('a tenant cannot move a locked token', async ({ page }) => {
  await assertLockedTokensAreLocked(page);
});

test.describe('visible focus at desktop width', () => {
  test('every interactive element shows a 2px ring at 2px offset', async ({ page }) => {
    await assertEveryControlShowsARing(page);
  });

  test('focus order follows DOM order, with no positive tabindex', async ({ page }) => {
    await assertNoPositiveTabindex(page);
  });

  test('a focused control is never covered by a sticky surface', async ({ page }) => {
    await assertFocusIsNeverObscured(page);
  });
});

test.describe('reduced motion at desktop width', () => {
  test(`the one duration token collapses to ${MOTION.reduced}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(PROBE_ROUTE);
    expect(durationMs(await durationToken(page))).toBe(durationMs(MOTION.reduced));
  });

  test('nothing on the page animates or transitions', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(PROBE_ROUTE);
    await assertNothingMoves(page);
  });

  test('nothing animates infinitely', async ({ page }) => {
    await assertNoInfiniteAnimation(page);
  });

  test('only the two sanctioned keyframes are ever used', async ({ page }) => {
    await assertOnlySanctionedKeyframes(page);
  });
});

test(`every control meets the WCAG 2.5.8 ${TARGETS.minPx}px minimum`, async ({ page }) => {
  await assertTargetsMeetTheFloor(page, TARGETS.minPx);
});
