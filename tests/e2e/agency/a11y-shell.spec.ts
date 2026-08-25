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
import { MOTION, TARGETS, UNTENANTED_AGENCY } from '@/styles/a11y-contract';
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
  assertExplicitThemeWins,
  assertRootAndBodyAgree,
  assertShellLoaded,
  assertUntenantedAgency,
  assertUntenantedTint,
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

test.describe('the untenanted default is the published colour', () => {
  /**
   * ROUND 2 DEFECT. `--agency` resolves down two paths — the published literal
   * with no tenant, the OKLCH clamp with one — and the clamp used to swallow
   * the default: `var(--brand-agency, #1f4e46)` made the tenant branch valid
   * with no tenant, and in dark mode the chroma lift re-lifted a colour that
   * was already lifted.
   *
   * The browser painted rgb(0, 163, 144) while every document published
   * #499D8F, and **every ratio assertion in this suite passed the whole time**
   * — 5.690:1 clears 4.5 as comfortably as 5.571:1 does. A contrast check is
   * structurally incapable of catching a colour that is wrong but legible. This
   * is the assertion that catches it, and it has to be against the painted
   * value, which is why it lives here and not in the vitest half.
   */
  for (const mode of ['light', 'dark'] as const) {
    test(`--agency is exactly ${UNTENANTED_AGENCY[mode]} in ${mode} with no tenant`, async ({ page }) => {
      await assertUntenantedAgency(page, mode);
    });
  }

  for (const mode of ['light', 'dark'] as const) {
    test(`--tint-agency in ${mode} is mixed from the published colour, not a computed one`, async ({ page }) => {
      await assertUntenantedTint(page, mode);
    });
  }
});

test.describe('an explicit theme choice reaches the body', () => {
  /**
   * THE SECOND ROUND 2 DEFECT, and the one no colour assertion could have
   * caught: both palettes were internally valid and the *selector* was wrong.
   * `data-theme` is on `<html>`, `data-relay-root` on `<body>`, and the dark
   * rule was satisfied by any element lacking `data-theme` — which `<body>`
   * always does. A reader on a dark system who explicitly chose light was
   * still served dark.
   *
   * Both system-preference states are exercised, because the failure only
   * appears when the choice disagrees with the preference.
   */
  for (const system of ['light', 'dark'] as const) {
    for (const choice of ['light', 'dark'] as const) {
      test(`data-theme="${choice}" wins on a ${system} system`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: system });
        await page.goto(PROBE_ROUTE);
        await assertExplicitThemeWins(page, choice);
      });
    }
  }

  test('the choice that disagrees with the system is the one that used to be ignored', async ({ page }) => {
    // Named separately so a regression reads as the original bug rather than as
    // "a theme test failed".
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(PROBE_ROUTE);
    await assertExplicitThemeWins(page, 'light');
  });

  for (const choice of ['light', 'dark', null] as const) {
    test(`<html> and <body> resolve the same palette with data-theme=${choice ?? 'unset'}`, async ({ page }) => {
      await assertRootAndBodyAgree(page, choice);
    });
  }
});
