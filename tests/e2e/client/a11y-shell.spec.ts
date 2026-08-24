/**
 * The accessibility floor at the client viewport (Pixel 7).
 *
 * Closes two Phase 8 EXIT conditions that were UNPROVEN at the end of round 1 —
 * visible keyboard focus, and `prefers-reduced-motion` — against the real
 * components, per directive Q5 and the design layer's U5 handoff in
 * `docs/design/A11Y-ASSERTIONS.md`.
 *
 * Runs against `/e/<token>/verify`, which renders the full shell and real
 * primitives while touching no database. That is deliberate: this suite does
 * **not** wait on the test-only seed endpoints, so the accessibility floor is
 * checkable while the rest of the e2e suite is still red.
 *
 * The client half carries the stricter target floor. The client is on a phone,
 * they did not ask to be here, and this is the acquisition surface.
 */

import { expect, test } from '@playwright/test';
import { TARGETS, MOTION, REFLOW } from '@/styles/a11y-contract';
import {
  HOSTILE_BRANDS,
  PROBE_ROUTE,
  assertBrandCannotBreakContrast,
  assertContrastOnLivePage,
  assertEveryControlShowsARing,
  assertFocusIsNeverObscured,
  assertInputsAreNotZoomBait,
  assertLockedTokensAreLocked,
  assertNoHorizontalScroll,
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

test.describe('white-label cannot break contrast', () => {
  for (const brand of HOSTILE_BRANDS) {
    test(`--agency stays legible when a tenant sets ${brand}`, async ({ page }) => {
      await assertBrandCannotBreakContrast(page, brand);
    });
  }

  test('a tenant cannot move a locked token', async ({ page }) => {
    await assertLockedTokensAreLocked(page);
  });
});

test.describe('visible focus', () => {
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

test.describe('reduced motion', () => {
  // `emulateMedia` rather than `test.use({ reducedMotion })`: the preference is
  // set on the live page, which means the *same* page can be read before and
  // after, and a token that only collapses on a fresh load would be caught.
  test(`the one duration token is ${MOTION.normal} with no preference set`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(PROBE_ROUTE);
    expect(durationMs(await durationToken(page))).toBe(durationMs(MOTION.normal));
  });

  test(`the one duration token collapses to ${MOTION.reduced} under prefers-reduced-motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(PROBE_ROUTE);
    expect(durationMs(await durationToken(page))).toBe(durationMs(MOTION.reduced));
  });

  test('the preference takes effect without a reload, so it is a media query and not a build flag', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(PROBE_ROUTE);
    expect(durationMs(await durationToken(page))).toBe(durationMs(MOTION.normal));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(durationMs(await durationToken(page))).toBe(durationMs(MOTION.reduced));
  });

  test('nothing on the page animates or transitions under prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(PROBE_ROUTE);
    await assertNothingMoves(page);
  });

  test('nothing animates infinitely, in either preference', async ({ page }) => {
    await assertNoInfiniteAnimation(page);
  });

  test('only the two sanctioned keyframes are ever used', async ({ page }) => {
    await assertOnlySanctionedKeyframes(page);
  });
});

test.describe('targets, text and reflow on a phone', () => {
  test(`every control meets the ${TARGETS.clientFacingPx}px client-facing floor`, async ({ page }) => {
    await assertTargetsMeetTheFloor(page, TARGETS.clientFacingPx);
  });

  test('no text input is below 16px, which is what stops iOS zooming the field away', async ({ page }) => {
    await assertInputsAreNotZoomBait(page);
  });

  test(`the page does not scroll horizontally at ${REFLOW.minWidthPx}px`, async ({ page }) => {
    await page.setViewportSize({ width: REFLOW.minWidthPx, height: 800 });
    await page.goto(PROBE_ROUTE);
    await assertNoHorizontalScroll(page);
  });
});
