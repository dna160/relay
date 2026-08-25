/**
 * PHASE-4 EXIT — "a Playwright run completes invite -> verify -> approve without
 * ever touching an agency route."
 *
 * The interesting half of that sentence is the second half. A flow that reaches
 * an approval has proved the feature works; a flow that reaches an approval
 * *and* provably never requested an agency route has proved the bundle split is
 * real. So this test records every same-origin request the page makes and
 * asserts on the whole set at the end — the route-level claim, not the outcome.
 *
 * Runs on `client-mobile` (Pixel 7). The client opens this link on a phone.
 */

import { expect, test, type Page } from '@playwright/test';
import { RouteRecorder, latestClientCode, seedFixtures, type SeedResult } from '../_helpers';

// The invite is issued by the agency out of band; the client's flow starts at
// the link in their inbox. The token comes back from the seed endpoint.
const CONTACT_EMAIL = 'rowan@bellweather.test';

/**
 * The fixture card that is the client's move — the one the queue lists and the
 * one carrying a published version a decision can bind to. Named rather than
 * addressed by uuid, per `tests/e2e/_helpers.ts`.
 */
const AWAITING_CARD = 'Key art';

/**
 * Everything up to a verified session sitting on the board.
 *
 * Four tests need this and none of them are about it. It also carries the one
 * assertion that has to hold before any of them can do anything: that the
 * workspace chrome is really there after the verify hand-off. See below.
 */
async function verifyAndLandOnTheBoard(
  page: Page,
  request: Parameters<typeof latestClientCode>[0],
  seed: SeedResult,
): Promise<void> {
  await page.goto(`/e/${seed.engagementToken}`);
  await page.getByLabel(/email/i).fill(CONTACT_EMAIL);
  await page.getByRole('button', { name: /send me a code/i }).click();

  // Wait for the form to reach the code step before reading the code out of
  // band. `click()` resolves when the click dispatches, not when the request
  // it fires resolves — reading the capture immediately is a race the suite
  // loses roughly always.
  await expect(page.getByLabel(/code/i)).toBeVisible();

  const code = await latestClientCode(request, seed.engagementToken, CONTACT_EMAIL);
  await page.getByLabel(/code/i).fill(code);
  await page.getByRole('button', { name: /open the workspace/i }).click();
  // Verify hands off to a client-side `router.replace` to the board. Waiting
  // on the URL rather than on the first thing the board happens to render
  // keeps the assertions below about the board, not about the navigation.
  await page.waitForURL(/\/board$/);

  /**
   * REGRESSION GUARD — the workspace chrome survives the verify hand-off.
   *
   * `/e/[token]/layout.tsx` renders its children bare when the board read
   * fails, which is exactly what the *unverified* reader on the landing page
   * gets. Verifying then navigates client-side to a child of that same layout
   * segment, and the App Router reuses the layout it already has rather than
   * asking the server for it again — so the board painted with no title, no
   * countdown, no export and no tabs, indefinitely, until something forced a
   * full document load. The nav was in the server HTML the whole time, which
   * is what made it look like a hydration fault rather than a cache one.
   *
   * This is asserted here, in the shared path, rather than in one test,
   * because every test below reaches its subject through a link in that
   * chrome. Without it they fail thirty seconds later as timeouts on whatever
   * they clicked next, and the cause is not in the failure.
   */
  await expect(
    page.getByRole('navigation', { name: 'Workspace' }),
    'the workspace nav is missing after verify: the layout is stale in the Router Cache',
  ).toBeVisible();
}

/**
 * From the board to the decision controls for the awaiting card.
 *
 * The queue lists what needs the client and links into each card; the decision
 * itself is made on the card, bound to one named version, because that is the
 * only place the version being approved is on screen (ADR-004, INV-3). A test
 * that looked for `Approve` on the queue would be asking the product to put an
 * unbound decision in front of someone.
 */
async function openTheDecision(page: Page) {
  await page.getByRole('link', { name: /your decisions/i }).click();
  await page.getByRole('link', { name: AWAITING_CARD }).click();
  await page.waitForURL(/\/c\/[^/]+$/);

  // Scoped to the labelled region. Both decision controls deliberately keep
  // their name through the flow — the design system's rule is that an action
  // is called the same thing when it opens and when it commits — so an
  // unscoped match is ambiguous by design, not by accident.
  return page.getByRole('region', { name: 'Decision' }).first();
}

test.describe('the client completes a decision without agency chrome', () => {
  let seed: SeedResult;

  test.beforeEach(async ({ request }) => {
    seed = await seedFixtures(request);
  });

  test('invite -> verify -> approve, touching no agency route', async ({ page, request, baseURL }) => {
    expect(baseURL, 'baseURL must be configured').toBeTruthy();
    const recorder = new RouteRecorder(page, baseURL!);

    // 1. The link, 2. verify. No account, no password, no signup (ADR-005);
    //    the session is scoped to one engagement (INV-6).
    await verifyAndLandOnTheBoard(page, request, seed);

    // 3. The board. Published lanes only — the private lane must not be here,
    //    and neither must the draft card or the unpublished third version.
    await expect(page.getByRole('heading', { name: 'Deliverables' })).toBeVisible();
    await expect(page.getByText('Internal QA')).toHaveCount(0);
    await expect(page.getByText('Unstarted deliverable')).toHaveCount(0);
    await expect(page.getByText('key-art-v3-WIP-DO-NOT-SEND.png')).toHaveCount(0);

    // 4. The decision queue, the card, then the decision itself.
    const decision = await openTheDecision(page);

    // Approve is confirmed, not fired: it is the most consequential control in
    // the product and it is one click away from a scroll gesture. The second
    // press is the one that commits, and it carries the same name as the
    // first on purpose.
    await decision.getByRole('button', { name: /^approve$/i }).click();
    await decision.getByRole('button', { name: /^approve$/i }).click();

    // 5. The card is approved and no longer awaits the client.
    await expect(page.getByText(/approved/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^approve$/i })).toHaveCount(0);

    // The exit condition, asserted at the route level.
    expect(
      recorder.agencyPaths(),
      `client flow touched agency routes. All paths: ${recorder.unique().join(', ')}`,
    ).toEqual([]);
  });

  test('requesting changes needs a note and the button stays disabled without one', async ({
    page,
    request,
  }) => {
    await verifyAndLandOnTheBoard(page, request, seed);
    const decision = await openTheDecision(page);

    await decision.getByRole('button', { name: /^request changes$/i }).click();

    // DESIGN-SYSTEM: "disabled until the note has content". Opening the form
    // replaces the control that opened it, so this still matches exactly one
    // button inside the region — now the one that commits.
    const submit = decision.getByRole('button', { name: /^request changes$/i });
    await expect(submit).toBeDisabled();
    await decision.getByRole('textbox', { name: /what needs to change/i }).fill('The logo reads too small.');
    await expect(submit).toBeEnabled();
  });

  test('a client session for one engagement cannot reach another (INV-6)', async ({
    page,
    request,
    baseURL,
  }) => {
    await verifyAndLandOnTheBoard(page, request, seed);

    // The same person, a different engagement, and a session that must not widen.
    const response = await page.request.get(`${baseURL}/e/${seed.otherEngagementToken}`, {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    // Either a 404 or a fresh verify prompt. Never the second board, and never
    // a 403 — a 403 confirms the engagement exists (API-CONTRACT).
    //
    // 307 is in this list because that is the code Next.js `redirect()` returns
    // from a Server Component on a GET; it is the same "go and verify" answer
    // 302 would be, and the assertion below is what actually holds the line.
    expect(response.status(), 'a 403 leaks the existence of the other engagement').not.toBe(403);
    expect([200, 302, 307, 404]).toContain(response.status());

    // Whatever the status, the second engagement's content is never served.
    // Redirects are followed here deliberately: a redirect that lands on the
    // other board would satisfy the status check above and still be the leak
    // this test exists to catch.
    const landed = await page.request.get(`${baseURL}/e/${seed.otherEngagementToken}`, {
      failOnStatusCode: false,
    });
    expect(await landed.text()).not.toContain('Packaging refresh');
  });

  test('the free export is reachable and never paywalled', async ({ page, request }) => {
    // PRD §5.6: the client's export is free, on every plan, always. It is the
    // thing that makes the purge safe to ship.
    await verifyAndLandOnTheBoard(page, request, seed);

    const exportLink = page.getByRole('link', { name: /export/i });
    await expect(exportLink).toBeVisible();
    const response = await page.request.get('/api/client/export', { failOnStatusCode: false });
    expect(response.status(), 'the client export must never return 402').not.toBe(402);
  });
});
