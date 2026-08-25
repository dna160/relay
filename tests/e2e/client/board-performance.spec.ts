/**
 * What the client board is, measured on the client board.
 *
 * ## DEFECT-7, and what was removed from this file
 *
 * Every test here used to navigate to `/e/<token>` **with no session**. The
 * client surface takes its engagement from the cookie, so that renders the
 * sign-in form: one heading, one email field, one button. All three tests were
 * therefore measuring the sign-in page and reporting it as the board.
 *
 * The worst of them was an FCP budget. A sign-in form paints faster than a
 * board by a wide margin, so the assertion passed for the wrong reason — which
 * is worse than not having it, because a green gate is read as evidence. It has
 * been **retired rather than repaired**, and the reason is not only the missing
 * session:
 *
 *   - The real gate already exists and is correct.
 *     `.github/scripts/check-fcp-budget.mjs` establishes a verified session out
 *     of band, refuses to record a sample unless the final URL is still
 *     `/board` and a published fixture lane is in the DOM, throttles to Chrome
 *     DevTools' Slow 4G with 4x CPU, and takes the median of five cold
 *     navigations. It is negative-tested: `FCP_BUDGET_MS=400` exits 1.
 *   - It measures a **production build**, and this suite does not. Playwright
 *     runs against a dev server: unminified, unbundled, compiled on demand. A
 *     number measured there is not the number that crosses the link, and a
 *     second budget asserted against it would either be so loose it never fires
 *     or so tight it flakes and gets deleted.
 *
 * Two budgets for one NFR, disagreeing about the build they measure, is how a
 * budget gets quietly relaxed. There is one, and it is the script.
 *
 * The two tests below are the ones that belong in an e2e suite — they are about
 * what the browser did, not about how long it took — and both now sign in
 * first, so they are finally about the board.
 */

import { expect, test } from '@playwright/test';
import { BOARD_MARKER, seedFixtures, signInAsClient, type SeedResult } from '../_helpers';

/**
 * `clientContacts[CONTACT.active].email`, as a literal.
 *
 * Importing it from `@tests/fixtures` would be better and does not work: the
 * fixture barrel reaches `tests/fixtures/possession.json`, and Playwright's ESM
 * loader refuses a JSON import without an import attribute. The vitest suites
 * and `tests/fcp-session.ts` run under different loaders and are fine; the e2e
 * suite is not, which is why `invite-verify-approve.spec.ts` already spells this
 * address out too. Two literals, one address, and a seed that would fail loudly
 * at the first `getByLabel` if it ever moved.
 */
const CONTACT_EMAIL = 'rowan@bellweather.test';

test.describe('the client board', () => {
  let seed: SeedResult;

  test.beforeEach(async ({ page, request }) => {
    seed = await seedFixtures(request);
    await signInAsClient(page, request, seed.engagementToken, CONTACT_EMAIL);
  });

  test('carries no agency route code in its bundle', async ({ page }) => {
    /*
      PHASE-4 EXIT: "the client bundle contains no agency route code." Checked by
      looking at what the page actually downloaded, not at the import graph — an
      import that is tree-shaken is not a leak, and a string inlined into a
      shared chunk is one even though no import points at it.

      The recording starts *after* sign-in, and then the board is reloaded, so
      what is collected is the board's own chunk set rather than the sign-in
      page's. The old version of this test recorded the sign-in page and passed
      because a page with almost no JavaScript on it has almost no way to leak.
    */
    const scripts: string[] = [];
    page.on('response', (response) => {
      const url = response.url();
      if (/\.js(\?|$)/.test(url)) scripts.push(url);
    });

    await page.reload({ waitUntil: 'networkidle' });

    // The proof that what was just recorded is the board and not a redirect to
    // the sign-in form. Without it this test can pass by measuring nothing.
    await expect(page.getByText(BOARD_MARKER)).toBeVisible();
    expect(scripts.length, 'no scripts were recorded; the audit measured nothing').toBeGreaterThan(
      0,
    );

    const agencyChunks = scripts.filter((s) => /portfolio|templates|agency|backstage/i.test(s));
    expect(
      agencyChunks,
      `agency chunks in the client bundle: ${agencyChunks.join(', ')}`,
    ).toEqual([]);
  });

  test('is usable at 360px, the design system floor', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.reload();
    await expect(page.getByText(BOARD_MARKER)).toBeVisible();

    // Nothing may overflow horizontally. A board a client has to pan sideways
    // on their phone is a board they close. Measured on the board itself: the
    // sign-in form is a single narrow column and could never have failed this.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, 'the client board scrolls horizontally at 360px').toBe(false);
  });
});
