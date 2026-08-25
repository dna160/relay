/**
 * Every client surface hydrates cleanly.
 *
 * This is the client half of a guard against one specific fault:
 *
 *   "A tree hydrated but some attributes of the server rendered HTML didn't
 *    match the client properties. This won't be patched up."
 *
 * See `tests/e2e/_console.ts` for why that sentence is worth a test of its own.
 * The short version: React leaves the mismatched subtree unhydrated, so the
 * controls in it are present in the DOM and do nothing, and the way that
 * reaches a person is a link in an email that opens a workspace where nothing
 * is clickable.
 *
 * The client surface gets the guard because it is the one that was reported,
 * it is the acquisition surface, and it is reached on a phone from an email by
 * someone with no second way in. There is no agency twin here for the same
 * reason the a11y specs differ per audience — an agency user has a keyboard, a
 * desktop, and a support channel.
 *
 * **Both kinds of navigation are walked.** A full document load hydrates; a
 * client-side navigation does not, and reuses cached layout segments instead.
 * Those are different failure modes and only one of them is hydration, so
 * covering only one would leave the other to be discovered as a timeout in an
 * unrelated test — which is exactly how the layout staleness in
 * `invite-verify-approve.spec.ts` presented.
 */

import { expect, test } from '@playwright/test';
import { watchConsole } from '../_console';
import { latestClientCode, seedFixtures, type SeedResult } from '../_helpers';

const CONTACT_EMAIL = 'rowan@bellweather.test';
const AWAITING_CARD = 'Key art';

test.describe('the client surface hydrates cleanly', () => {
  let seed: SeedResult;

  test.beforeEach(async ({ request }) => {
    seed = await seedFixtures(request);
  });

  test('no hydration mismatch anywhere a client contact can go', async ({ page, request }) => {
    // Attached before the first navigation: hydration happens once per load and
    // a listener added afterwards has already missed it.
    const console_ = watchConsole(page);
    const token = seed.engagementToken;

    // 1. The two unverified states. Both are reached straight from an email,
    //    and the verify page is rendered with a code already in the URL, which
    //    is a different first render from the empty one.
    await page.goto(`/e/${token}`);
    await expect(page.getByRole('button', { name: /send me a code/i })).toBeVisible();
    console_.assertClean('the client landing page');

    await page.goto(`/e/${token}/verify?code=123456`);
    await expect(page.getByRole('button', { name: /open the workspace/i })).toBeVisible();
    console_.assertClean('the verify page with a code in the URL');

    // 2. Verify for real, through the form rather than around it.
    await page.goto(`/e/${token}`);
    await page.getByLabel(/email/i).fill(CONTACT_EMAIL);
    await page.getByRole('button', { name: /send me a code/i }).click();
    await expect(page.getByLabel(/code/i)).toBeVisible();
    const code = await latestClientCode(request, token, CONTACT_EMAIL);
    await page.getByLabel(/code/i).fill(code);
    await page.getByRole('button', { name: /open the workspace/i }).click();
    await page.waitForURL(/\/board$/);
    await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
    console_.assertClean('the board reached by the verify hand-off');

    // 3. Every verified page, loaded fresh — the path that actually hydrates.
    for (const [name, url] of [
      ['the client board', `/e/${token}/board`],
      ['the decision queue', `/e/${token}/queue`],
      ['a client card page', `/e/${token}/c/${seed.cardId}`],
    ] as const) {
      await page.goto(url);
      await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
      console_.assertClean(`${name} on a full load`);
    }

    // 4. The same pages reached the way a reader actually reaches them. This
    //    does not hydrate, but it is where a stale cached layout shows up, and
    //    the chrome assertion is the one that catches it.
    await page.goto(`/e/${token}/board`);
    await page.getByRole('link', { name: /your decisions/i }).click();
    await expect(page).toHaveURL(/\/queue$/);
    await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();

    await page.getByRole('link', { name: AWAITING_CARD }).click();
    await expect(page).toHaveURL(/\/c\/[^/]+$/);
    await expect(page.getByRole('region', { name: 'Decision' })).toBeVisible();
    console_.assertClean('the client surface after client-side navigation');
  });
});
